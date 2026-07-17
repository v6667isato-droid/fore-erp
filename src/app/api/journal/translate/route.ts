import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

/**
 * 日誌中翻英：接收字串段落陣列，回傳等長的英文翻譯陣列。
 * 僅供 ERP 內部使用（需 Supabase 登入 token），優先用 Claude，
 * 未設 ANTHROPIC_API_KEY 時退用 Gemini（與發票辨識同一套雙路設計）。
 */

interface TranslateOutcome {
  ok: boolean;
  status: number;
  translations?: string[];
  error?: string;
}

const TRANSLATE_PROMPT = `你是 FØRE Furniture（台南的木家具設計工作室）官網的中翻英譯者。以下是官網日誌文章的段落（JSON 字串陣列，依序為標題、摘要、內文段落與圖說）。

請把每一段翻成自然、溫暖、有手作職人氣質的英文，供官網刊登：
- 語氣貼近原文，不要生硬直譯，也不要自行增刪內容
- 品牌名 FØRE、人名、地名保持原樣；「木節」譯 knot；日文專有名詞用通行的羅馬字
- 空字串直接輸出空字串
- 輸出的 translations 陣列長度必須與輸入段落數相同，順序一一對應

段落如下：
`;

const CLAUDE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["translations"],
  properties: {
    translations: {
      type: "array",
      description: "與輸入段落等長、順序對應的英文翻譯",
      items: { type: "string" },
    },
  },
} as const;

const GEMINI_OUTPUT_SCHEMA = {
  type: "OBJECT",
  required: ["translations"],
  properties: {
    translations: { type: "ARRAY", items: { type: "STRING" } },
  },
} as const;

function parseTranslations(text: string, expectedLength: number): TranslateOutcome {
  try {
    const parsed = JSON.parse(text);
    const translations = parsed?.translations;
    if (
      !Array.isArray(translations) ||
      translations.length !== expectedLength ||
      translations.some((t) => typeof t !== "string")
    ) {
      return { ok: false, status: 502, error: "翻譯結果格式不符，請重試" };
    }
    return { ok: true, status: 200, translations };
  } catch {
    return { ok: false, status: 502, error: "翻譯結果無法解析，請重試" };
  }
}

async function translateWithClaude(apiKey: string, segments: string[]): Promise<TranslateOutcome> {
  const client = new Anthropic({ apiKey });
  const model = process.env.TRANSLATE_AI_MODEL || "claude-opus-4-8";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        format: { type: "json_schema", schema: CLAUDE_OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: TRANSLATE_PROMPT + JSON.stringify(segments),
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, status: 502, error: "AI 拒絕處理此內容，請調整文字後重試" };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseTranslations(text, segments.length);
  } catch (err) {
    console.error("journal translate (claude) error:", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, status: 502, error: "ANTHROPIC_API_KEY 無效，請確認 key 是否正確" };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, status: 502, error: "Claude 額度或速率不足，請稍後再試" };
    }
    const message = err instanceof Anthropic.APIError ? err.message : "翻譯失敗，請稍後再試";
    return { ok: false, status: 502, error: message };
  }
}

async function translateWithGemini(
  apiKey: string,
  segments: string[],
  modelOverride?: string,
): Promise<TranslateOutcome> {
  const model = modelOverride || process.env.TRANSLATE_GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const res = await fetch(url, {
      // 主模型 35 秒未回應即中止改打備援；備援 45 秒（Vercel 上限 60 秒）
      signal: AbortSignal.timeout(modelOverride ? 45000 : 35000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: TRANSLATE_PROMPT + JSON.stringify(segments) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_OUTPUT_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const apiMessage: string | undefined = body?.error?.message;
      console.error("journal translate (gemini) error:", model, res.status, apiMessage);
      const fallback = process.env.TRANSLATE_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
      if (!modelOverride && (res.status === 429 || res.status === 503) && fallback !== model) {
        return translateWithGemini(apiKey, segments, fallback);
      }
      if (res.status === 400 || res.status === 403) {
        return { ok: false, status: 502, error: "GEMINI_API_KEY 無效或無權限，請確認 key 是否正確" };
      }
      if (res.status === 429) {
        return { ok: false, status: 502, error: "Gemini 免費額度暫時用完，請稍後再試" };
      }
      return { ok: false, status: 502, error: apiMessage || "翻譯失敗，請稍後再試" };
    }

    const body = await res.json();
    const parts: { text?: string }[] = body?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    if (!text) {
      const finishReason = body?.candidates?.[0]?.finishReason;
      return {
        ok: false,
        status: 502,
        error: finishReason === "SAFETY" ? "AI 拒絕處理此內容，請調整文字後重試" : "翻譯結果為空，請重試",
      };
    }
    return parseTranslations(text, segments.length);
  } catch (err) {
    console.error("journal translate (gemini) error:", model, err);
    const isTimeout =
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
      /timeout|aborted/i.test(err instanceof Error ? err.message : "");
    const fallback = process.env.TRANSLATE_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
    if (!modelOverride && isTimeout && fallback !== model) {
      return translateWithGemini(apiKey, segments, fallback);
    }
    return { ok: false, status: 502, error: "翻譯逾時，請稍後再試" };
  }
}

export async function POST(request: NextRequest) {
  // 此端點會消耗 AI 額度，僅放行已登入的 ERP 使用者（前端帶 Supabase access token）
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return NextResponse.json({ error: "登入已失效，請重新登入" }, { status: 401 });
  }

  let segments: string[];
  try {
    const body = await request.json();
    if (
      !Array.isArray(body?.segments) ||
      body.segments.length === 0 ||
      body.segments.length > 200 ||
      body.segments.some((s: unknown) => typeof s !== "string") ||
      body.segments.join("").length > 50000
    ) {
      return NextResponse.json({ error: "翻譯內容格式不正確" }, { status: 400 });
    }
    segments = body.segments;
  } catch {
    return NextResponse.json({ error: "翻譯內容格式不正確" }, { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    return NextResponse.json(
      { error: "尚未設定 AI 翻譯 key。請在 .env.local 與 Vercel 環境變數加入 ANTHROPIC_API_KEY（Claude）或 GEMINI_API_KEY（Gemini）其中之一。" },
      { status: 500 }
    );
  }

  const outcome = anthropicKey
    ? await translateWithClaude(anthropicKey, segments)
    : await translateWithGemini(geminiKey!, segments);

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ translations: outcome.translations });
}
