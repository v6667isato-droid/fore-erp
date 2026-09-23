import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { MAX_PROMPT_RULES } from "@/lib/intake-learning";

/**
 * 貼上建立（解析／學習修正）API 共用：登入驗證、呼叫 AI 取得 JSON、讀取已學到的規則。
 * 僅供伺服器端 route 使用。優先用 Claude，未設 ANTHROPIC_API_KEY 時退用 Gemini
 * （與發票辨識、日誌翻譯同一套雙路設計）。
 */

export interface AiJsonOutcome {
  ok: boolean;
  status: number;
  json?: unknown;
  error?: string;
}

/**
 * 此類端點會消耗 AI 額度，僅放行已登入的 ERP 使用者（前端帶 Supabase access token）。
 * 成功時回傳以該使用者身分查詢的 client（套用 RLS）。
 */
export async function authenticateIntakeRequest(
  request: NextRequest
): Promise<{ supabase: SupabaseClient<Database> } | { response: NextResponse }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { response: NextResponse.json({ error: "未登入" }, { status: 401 }) };
  }
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return { response: NextResponse.json({ error: "登入已失效，請重新登入" }, { status: 401 }) };
  }
  return { supabase };
}

/** 使用中的學習規則（新→舊，最多 MAX_PROMPT_RULES 條）；讀取失敗不影響解析 */
export async function fetchActiveIntakeRules(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase
    .from("intake_learning_rules")
    .select("rule")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_PROMPT_RULES);
  if (error) {
    console.error("intake rules load error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.rule);
}

function parseJson(text: string, action: string): AiJsonOutcome {
  try {
    return { ok: true, status: 200, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: 502, error: `${action}結果無法讀取，請重試` };
  }
}

/** Claude Opus 5 拒答時由伺服器端改用此模型重跑（同一次請求內完成） */
const CLAUDE_REFUSAL_FALLBACK_MODEL = "claude-opus-4-8";

async function runClaude(apiKey: string, prompt: string, schema: object, action: string): Promise<AiJsonOutcome> {
  const client = new Anthropic({ apiKey });
  const model = process.env.CUSTOMER_INTAKE_AI_MODEL || "claude-opus-5";

  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // 單純擷取欄位／整理規則，低 effort 回應較快、用量較少
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: schema as Record<string, unknown> },
      },
      ...(model !== CLAUDE_REFUSAL_FALLBACK_MODEL
        ? {
            betas: ["server-side-fallback-2026-06-01"],
            fallbacks: [{ model: CLAUDE_REFUSAL_FALLBACK_MODEL }],
          }
        : {}),
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, status: 502, error: "AI 拒絕處理此內容，請調整文字後重試" };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, status: 502, error: "內容太長，AI 無法一次處理完，請分段貼上" };
    }

    const out = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseJson(out, action);
  } catch (err) {
    console.error(`customer intake ${action} (claude) error:`, err);
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, status: 502, error: "ANTHROPIC_API_KEY 無效，請確認 key 是否正確" };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, status: 502, error: "Claude 額度或速率不足，請稍後再試" };
    }
    const message = err instanceof Anthropic.APIError ? err.message : `${action}失敗，請稍後再試`;
    return { ok: false, status: 502, error: message };
  }
}

async function runGemini(
  apiKey: string,
  prompt: string,
  schema: object,
  action: string,
  modelOverride?: string
): Promise<AiJsonOutcome> {
  const model = modelOverride || process.env.CUSTOMER_INTAKE_GEMINI_MODEL || "gemini-3.5-flash";
  const fallback = process.env.CUSTOMER_INTAKE_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
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
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const apiMessage: string | undefined = body?.error?.message;
      console.error(`customer intake ${action} (gemini) error:`, model, res.status, apiMessage);
      if (!modelOverride && (res.status === 429 || res.status === 503) && fallback !== model) {
        return runGemini(apiKey, prompt, schema, action, fallback);
      }
      if (res.status === 400 || res.status === 403) {
        return { ok: false, status: 502, error: "GEMINI_API_KEY 無效或無權限，請確認 key 是否正確" };
      }
      if (res.status === 429) {
        return { ok: false, status: 502, error: "Gemini 免費額度暫時用完，請稍後再試" };
      }
      return { ok: false, status: 502, error: apiMessage || `${action}失敗，請稍後再試` };
    }

    const body = await res.json();
    const parts: { text?: string }[] = body?.candidates?.[0]?.content?.parts ?? [];
    const out = parts.map((p) => p.text ?? "").join("");
    if (!out) {
      const finishReason = body?.candidates?.[0]?.finishReason;
      return {
        ok: false,
        status: 502,
        error: finishReason === "SAFETY" ? "AI 拒絕處理此內容，請調整文字後重試" : `${action}結果為空，請重試`,
      };
    }
    return parseJson(out, action);
  } catch (err) {
    console.error(`customer intake ${action} (gemini) error:`, model, err);
    const isTimeout =
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
      /timeout|aborted/i.test(err instanceof Error ? err.message : "");
    if (!modelOverride && isTimeout && fallback !== model) {
      return runGemini(apiKey, prompt, schema, action, fallback);
    }
    return { ok: false, status: 502, error: `${action}逾時，請稍後再試` };
  }
}

/** 依設定的 key 呼叫 Claude 或 Gemini，回傳符合 schema 的 JSON；action 用於錯誤訊息（「解析」「學習」） */
export async function runIntakeAi(
  prompt: string,
  schemas: { claude: object; gemini: object },
  action: string
): Promise<AiJsonOutcome> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    return {
      ok: false,
      status: 500,
      error:
        "尚未設定 AI key。請在 .env.local 與 Vercel 環境變數加入 ANTHROPIC_API_KEY（Claude）或 GEMINI_API_KEY（Gemini）其中之一。",
    };
  }
  return anthropicKey
    ? runClaude(anthropicKey, prompt, schemas.claude, action)
    : runGemini(geminiKey!, prompt, schemas.gemini, action);
}
