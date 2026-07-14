import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

/** 辨識結果單一品項 */
export interface RecognizedInvoiceItem {
  name: string;
  spec: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
}

/** 請款單辨識結果（回傳給前端審核） */
export interface RecognizedInvoice {
  vendor_name: string | null;
  invoice_date: string | null;
  /** 單價是否含稅；無法判斷時為 null */
  prices_tax_inclusive: boolean | null;
  /** 請款單上的總金額（供前端核對明細加總） */
  total_amount: number | null;
  items: RecognizedInvoiceItem[];
}

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

const RECOGNITION_PROMPT = `這是一張廠商傳來的請款單（或出貨單／對帳單／發票明細）。請仔細辨識並擷取以下資訊：

- 廠商名稱（開立此單據的公司）
- 單據日期（民國年請換算為西元年，輸出 YYYY-MM-DD）
- 每一行品項：品名（照原文抄錄，不要翻譯或改寫）、規格、數量、單位、單價、金額
- 總金額（有含稅總計時優先使用）
- 單價是含稅或未稅（單據上有「含稅」「未稅」「稅外加」等字樣時據以判斷，否則為 null）

注意：
- 運費、稅額等非商品行若列為獨立品項，也照抄輸出為一行品項
- 手寫或模糊不清的欄位，盡力辨識；完全無法辨識的欄位輸出 null
- 金額請輸出數字（去除逗號與貨幣符號）`;

/** Claude structured outputs 用 JSON Schema */
const CLAUDE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor_name", "invoice_date", "prices_tax_inclusive", "total_amount", "items"],
  properties: {
    vendor_name: { type: ["string", "null"], description: "開立請款單的廠商名稱" },
    invoice_date: { type: ["string", "null"], description: "請款單日期，YYYY-MM-DD；民國年請換算為西元年" },
    prices_tax_inclusive: { type: ["boolean", "null"], description: "單價是否為含稅價；文件未標示則為 null" },
    total_amount: { type: ["number", "null"], description: "請款單總金額（含稅優先）" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "spec", "quantity", "unit", "unit_price", "amount"],
        properties: {
          name: { type: "string", description: "品名（照原文抄錄）" },
          spec: { type: ["string", "null"], description: "規格／尺寸等補充說明" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"], description: "單位，如：個、支、才、組" },
          unit_price: { type: ["number", "null"] },
          amount: { type: ["number", "null"], description: "該行金額（小計）" },
        },
      },
    },
  },
} as const;

/** Gemini responseSchema（OpenAPI 子集，nullable 以 nullable: true 表示） */
const GEMINI_OUTPUT_SCHEMA = {
  type: "OBJECT",
  required: ["vendor_name", "invoice_date", "prices_tax_inclusive", "total_amount", "items"],
  properties: {
    vendor_name: { type: "STRING", nullable: true, description: "開立請款單的廠商名稱" },
    invoice_date: { type: "STRING", nullable: true, description: "請款單日期，YYYY-MM-DD；民國年請換算為西元年" },
    prices_tax_inclusive: { type: "BOOLEAN", nullable: true, description: "單價是否為含稅價；文件未標示則為 null" },
    total_amount: { type: "NUMBER", nullable: true, description: "請款單總金額（含稅優先）" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "spec", "quantity", "unit", "unit_price", "amount"],
        properties: {
          name: { type: "STRING", description: "品名（照原文抄錄）" },
          spec: { type: "STRING", nullable: true, description: "規格／尺寸等補充說明" },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true, description: "單位，如：個、支、才、組" },
          unit_price: { type: "NUMBER", nullable: true },
          amount: { type: "NUMBER", nullable: true, description: "該行金額（小計）" },
        },
      },
    },
  },
} as const;

type RecognitionOutcome =
  | { ok: true; result: RecognizedInvoice }
  | { ok: false; status: number; error: string };

function parseRecognizedInvoice(text: string): RecognitionOutcome {
  try {
    const parsed = JSON.parse(text) as RecognizedInvoice;
    if (!Array.isArray(parsed.items)) {
      return { ok: false, status: 502, error: "辨識結果格式異常，請重試或改用手動輸入" };
    }
    return { ok: true, result: parsed };
  } catch {
    return { ok: false, status: 502, error: "辨識結果無法解析，請重試或改用手動輸入" };
  }
}

async function recognizeWithClaude(
  apiKey: string,
  fileBase64: string,
  mediaType: string,
  isPdf: boolean,
): Promise<RecognitionOutcome> {
  const client = new Anthropic({ apiKey });
  const model = process.env.INVOICE_AI_MODEL || "claude-opus-4-8";

  const fileBlock: Anthropic.ContentBlockParam = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as SupportedImageType,
          data: fileBase64,
        },
      };

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
          content: [fileBlock, { type: "text", text: RECOGNITION_PROMPT }],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, status: 502, error: "AI 拒絕處理此文件，請改用手動輸入" };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseRecognizedInvoice(text);
  } catch (err) {
    console.error("invoice-recognition (claude) error:", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, status: 502, error: "ANTHROPIC_API_KEY 無效，請確認 key 是否正確" };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, status: 502, error: "Claude 額度或速率不足，請稍後再試" };
    }
    const message = err instanceof Anthropic.APIError ? err.message : "辨識失敗，請稍後再試";
    return { ok: false, status: 502, error: message };
  }
}

async function recognizeWithGemini(
  apiKey: string,
  fileBase64: string,
  mediaType: string,
): Promise<RecognitionOutcome> {
  const model = process.env.INVOICE_GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mediaType, data: fileBase64 } },
              { text: RECOGNITION_PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_OUTPUT_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const apiMessage: string | undefined = body?.error?.message;
      console.error("invoice-recognition (gemini) error:", res.status, apiMessage);
      if (res.status === 400 || res.status === 403) {
        return { ok: false, status: 502, error: "GEMINI_API_KEY 無效或無權限，請確認 key 是否正確" };
      }
      if (res.status === 429) {
        return { ok: false, status: 502, error: "Gemini 免費額度暫時用完（每分鐘／每日有上限），請稍後再試" };
      }
      return { ok: false, status: 502, error: apiMessage || "辨識失敗，請稍後再試" };
    }

    const body = await res.json();
    const parts: { text?: string }[] = body?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    if (!text) {
      const finishReason = body?.candidates?.[0]?.finishReason;
      return {
        ok: false,
        status: 502,
        error: finishReason === "SAFETY" ? "AI 拒絕處理此文件，請改用手動輸入" : "辨識結果為空，請重試或改用手動輸入",
      };
    }
    return parseRecognizedInvoice(text);
  } catch (err) {
    console.error("invoice-recognition (gemini) error:", err);
    return { ok: false, status: 502, error: "辨識失敗，請稍後再試" };
  }
}

export async function POST(request: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "尚未設定 AI 辨識 key。請在 .env.local 與 Vercel 環境變數加入 ANTHROPIC_API_KEY（Claude）或 GEMINI_API_KEY（Gemini，可用 aistudio.google.com 免費 key）其中之一。",
        not_configured: true,
      },
      { status: 501 },
    );
  }

  const body = await request.json().catch(() => null);
  const fileBase64 = typeof body?.file_base64 === "string" ? body.file_base64 : "";
  const mediaType = typeof body?.media_type === "string" ? body.media_type : "";

  if (!fileBase64 || !mediaType) {
    return NextResponse.json(
      { success: false, error: "缺少檔案內容（file_base64 / media_type）" },
      { status: 400 },
    );
  }

  const isPdf = mediaType === "application/pdf";
  const isImage = (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType);
  if (!isPdf && !isImage) {
    return NextResponse.json(
      { success: false, error: `不支援的檔案格式：${mediaType}（請使用 JPG/PNG/WebP 圖片或 PDF）` },
      { status: 400 },
    );
  }

  // 有 Anthropic key 優先用 Claude（辨識品質較佳）；否則退用 Gemini 免費額度
  const outcome = anthropicKey
    ? await recognizeWithClaude(anthropicKey, fileBase64, mediaType, isPdf)
    : await recognizeWithGemini(geminiKey!, fileBase64, mediaType);

  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ success: true, result: outcome.result });
}
