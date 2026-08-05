import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

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
  /** 未稅合計（多數單據以未稅計價，優先用此欄核對） */
  total_amount_ex_tax: number | null;
  /** 含稅總計 */
  total_amount_inc_tax: number | null;
  items: RecognizedInvoiceItem[];
}

/** 發票紙張在照片中的範圍（0–1000 標準化座標，x0,y0 左上、x1,y1 右下） */
export interface RecognizedCropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 各欄位在照片中的概略範圍（0–1000 標準化座標）；模型給的是大概位置，使用時請外擴 padding */
export interface RecognizedFieldBoxes {
  invoice_number?: RecognizedCropBox | null;
  invoice_date?: RecognizedCropBox | null;
  seller_name?: RecognizedCropBox | null;
  seller_tax_id?: RecognizedCropBox | null;
  buyer_tax_id?: RecognizedCropBox | null;
  amount_ex_tax?: RecognizedCropBox | null;
  tax_amount?: RecognizedCropBox | null;
  amount_inc_tax?: RecognizedCropBox | null;
}

/** 統一發票辨識結果（會計發票模組審核用，doc_type=tax_invoice） */
export interface RecognizedTaxInvoice {
  /** 發票號碼：2 碼英文＋8 碼數字 */
  invoice_number: string | null;
  invoice_date: string | null;
  /** 賣方（開立發票方）名稱 */
  seller_name: string | null;
  /** 賣方統一編號（8 碼數字） */
  seller_tax_id: string | null;
  /** 買方統一編號（二聯式通常沒有） */
  buyer_tax_id: string | null;
  /** 銷售額（未稅） */
  amount_ex_tax: number | null;
  /** 營業稅額 */
  tax_amount: number | null;
  /** 總計（含稅） */
  amount_inc_tax: number | null;
  /** 發票紙張範圍，審核畫面自動聚焦放大用；PDF、佔滿畫面或舊資料為 null／缺欄 */
  crop_box?: RecognizedCropBox | null;
  /** 需人工核對欄位（號碼／日期／統編／名稱／金額）所在範圍，審核畫面紅框標示用 */
  fields_box?: RecognizedCropBox | null;
  /** 字軌期別（發票開頭「115年07-08月」）：民國年；未印或無法辨識為 null／缺欄（舊資料） */
  period_roc_year?: number | null;
  /** 字軌期別起月（1–12） */
  period_start_month?: number | null;
  /** 字軌期別迄月（1–12） */
  period_end_month?: number | null;
  /** 進項憑證格式代號：25 三聯收銀機／電子發票、21 手開三聯式、22 二聯收銀機（內含稅）；無法判斷 null */
  format_code?: "21" | "22" | "25" | null;
  /** 各欄位概略範圍，審核畫面欄位級高亮／放大裁切用；無法定位或 PDF 為 null／缺欄（舊資料） */
  field_boxes?: RecognizedFieldBoxes | null;
}

/** 單一欄位範圍的 Claude JSON Schema（可為 null） */
function claudeBoxSchema(desc: string) {
  return {
    type: ["object", "null"],
    description: `${desc}在照片中的範圍（0–1000 標準化座標）；找不到則 null`,
    additionalProperties: false,
    required: ["x0", "y0", "x1", "y1"],
    properties: {
      x0: { type: "number" },
      y0: { type: "number" },
      x1: { type: "number" },
      y1: { type: "number" },
    },
  };
}

/** 單一欄位範圍的 Gemini responseSchema（可為 null） */
function geminiBoxSchema(desc: string) {
  return {
    type: "OBJECT",
    nullable: true,
    description: `${desc}在照片中的範圍（0–1000 標準化座標）；找不到則 null`,
    required: ["x0", "y0", "x1", "y1"],
    properties: {
      x0: { type: "NUMBER" },
      y0: { type: "NUMBER" },
      x1: { type: "NUMBER" },
      y1: { type: "NUMBER" },
    },
  };
}

const FIELD_BOX_KEYS = [
  "invoice_number",
  "invoice_date",
  "seller_name",
  "seller_tax_id",
  "buyer_tax_id",
  "amount_ex_tax",
  "tax_amount",
  "amount_inc_tax",
] as const;

const FIELD_BOX_LABELS: Record<(typeof FIELD_BOX_KEYS)[number], string> = {
  invoice_number: "發票號碼",
  invoice_date: "發票日期",
  seller_name: "賣方名稱",
  seller_tax_id: "賣方統編",
  buyer_tax_id: "買方統編",
  amount_ex_tax: "銷售額（未稅）",
  tax_amount: "營業稅額",
  amount_inc_tax: "總計（含稅）",
};

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

const RECOGNITION_PROMPT = `這是一張廠商傳來的請款單（或出貨單／對帳單／發票明細）。請仔細辨識並擷取以下資訊：

- 廠商名稱（開立此單據的公司）
- 單據日期，輸出 YYYY-MM-DD
- 每一行品項：品名（照原文抄錄，不要翻譯或改寫）、規格、數量、單位、單價、金額
- 未稅合計與含稅總計（單據上有哪個就填哪個，兩個都有就都填）
- 單價是含稅或未稅（單據上有「含稅」「未稅」「稅外加」等字樣時據以判斷，否則為 null）

日期特別注意：
- 台灣單據常用民國紀年，民國年＝西元年－1911。兩、三位數的年份幾乎都是民國年，
  例如「115/07/10」「115.7.10」＝西元 2026-07-10，「113年3月5日」＝2024-03-05
- 四位數年份（如 2026）才是西元年，直接使用

其他注意：
- 運費、稅額等非商品行若列為獨立品項，也照抄輸出為一行品項
- 手寫或模糊不清的欄位，盡力辨識；完全無法辨識的欄位輸出 null
- 金額請輸出數字（去除逗號與貨幣符號）`;

/** Claude structured outputs 用 JSON Schema */
const CLAUDE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor_name", "invoice_date", "prices_tax_inclusive", "total_amount_ex_tax", "total_amount_inc_tax", "items"],
  properties: {
    vendor_name: { type: ["string", "null"], description: "開立請款單的廠商名稱" },
    invoice_date: { type: ["string", "null"], description: "請款單日期，YYYY-MM-DD；民國年＝西元年－1911" },
    prices_tax_inclusive: { type: ["boolean", "null"], description: "單價是否為含稅價；文件未標示則為 null" },
    total_amount_ex_tax: { type: ["number", "null"], description: "未稅合計；單據未列則為 null" },
    total_amount_inc_tax: { type: ["number", "null"], description: "含稅總計；單據未列則為 null" },
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
  required: ["vendor_name", "invoice_date", "prices_tax_inclusive", "total_amount_ex_tax", "total_amount_inc_tax", "items"],
  properties: {
    vendor_name: { type: "STRING", nullable: true, description: "開立請款單的廠商名稱" },
    invoice_date: { type: "STRING", nullable: true, description: "請款單日期，YYYY-MM-DD；民國年＝西元年－1911" },
    prices_tax_inclusive: { type: "BOOLEAN", nullable: true, description: "單價是否為含稅價；文件未標示則為 null" },
    total_amount_ex_tax: { type: "NUMBER", nullable: true, description: "未稅合計；單據未列則為 null" },
    total_amount_inc_tax: { type: "NUMBER", nullable: true, description: "含稅總計；單據未列則為 null" },
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

const TAX_RECOGNITION_PROMPT = `這是一張台灣的統一發票（可能是三聯式、二聯式、收銀機發票或電子發票證明聯）。請仔細辨識並擷取以下資訊：

- 發票號碼：2 碼英文字母＋8 碼數字（如 AB12345678），輸出時去除空白與「-」
- 發票日期，輸出 YYYY-MM-DD
- 賣方（開立發票的公司）名稱與統一編號（8 碼數字）
- 買方統一編號（8 碼數字；二聯式發票通常沒有，輸出 null）
- 銷售額（未稅）、營業稅額、總計（含稅）：發票上有哪個就填哪個
- crop_box：發票紙張本體在整張照片中的範圍，0–1000 標準化座標（x0,y0＝左上角、x1,y1＝右下角）。
  照片常含桌面等背景，請框住整張發票紙，寧可框大一點也不要切到任何文字；
  發票已幾乎佔滿整張畫面、或檔案是 PDF 時輸出 null
- fields_box：包住所有需人工核對欄位（發票號碼、日期、賣方名稱與統編、買方統編、
  未稅／稅額／總計金額）的最小範圍，同樣 0–1000 標準化座標；
  寧可框大一點也不要切到這些欄位；無法判斷或是 PDF 時輸出 null
- 字軌期別：發票標題附近常印「115年07-08月」這類期別，請拆成
  period_roc_year（民國年，如 115）、period_start_month（起月，如 7）、period_end_month（迄月，如 8）；
  沒印期別或無法辨識時三個都輸出 null。注意這是期別區間，不是發票日期
- format_code（進項憑證格式代號）依票面型式判斷：
  「25」＝電子發票證明聯（57mm 熱感紙、下方有兩個 QR code＋一維條碼、標題印「電子發票證明聯」），
  　　　　或「有印買方統編」的傳統收銀機發票（＝三聯式收銀機）；
  「21」＝手開／手寫發票：欄位為手寫字跡、表格式票面、常有複寫痕跡；
  「22」＝「沒有」買方統編的傳統收銀機發票（二聯式、內含稅）：長條型紙卷、常為粉紅／黃等有色紙、
  　　　　整張機器列印、沒有 QR code；
  收銀機發票的買方統編常印成「統編:12345678」「買:12345678」等字樣（多在票面上緣、日期附近），
  請特別檢查——有找到就同時填入 buyer_tax_id 並將 format_code 判為 25；
  無法判斷時輸出 null
- field_boxes：上述每個欄位各自在照片中的範圍（0–1000 標準化座標），
  給審核畫面做欄位級放大核對用；寧可框大一點也不要切到該欄位的文字；
  某欄位在發票上不存在、無法定位或是 PDF 時該欄輸出 null

日期特別注意：
- 台灣發票常用民國紀年，民國年＝西元年－1911。兩、三位數的年份幾乎都是民國年，
  例如「115年07-08月」取月份區間首月、「115/07/10」＝西元 2026-07-10
- 四位數年份（如 2026）才是西元年，直接使用

其他注意：
- 收銀機發票或電子發票證明聯可能只印含稅總計，此時未稅與稅額輸出 null
- 金額請輸出數字（去除逗號與貨幣符號）
- 手寫或模糊不清的欄位，盡力辨識；完全無法辨識的欄位輸出 null`;

const CLAUDE_TAX_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "invoice_number",
    "invoice_date",
    "seller_name",
    "seller_tax_id",
    "buyer_tax_id",
    "amount_ex_tax",
    "tax_amount",
    "amount_inc_tax",
    "crop_box",
    "fields_box",
    "period_roc_year",
    "period_start_month",
    "period_end_month",
    "format_code",
    "field_boxes",
  ],
  properties: {
    invoice_number: { type: ["string", "null"], description: "發票號碼：2 碼英文＋8 碼數字，去除空白與連字號" },
    invoice_date: { type: ["string", "null"], description: "發票日期，YYYY-MM-DD；民國年＝西元年－1911" },
    seller_name: { type: ["string", "null"], description: "賣方（開立發票方）名稱" },
    seller_tax_id: { type: ["string", "null"], description: "賣方統一編號（8 碼數字）" },
    buyer_tax_id: { type: ["string", "null"], description: "買方統一編號（8 碼數字；無則 null）" },
    amount_ex_tax: { type: ["number", "null"], description: "銷售額（未稅）；未列則 null" },
    tax_amount: { type: ["number", "null"], description: "營業稅額；未列則 null" },
    amount_inc_tax: { type: ["number", "null"], description: "總計（含稅）；未列則 null" },
    crop_box: {
      type: ["object", "null"],
      description: "發票紙張在照片中的範圍（0–1000 標準化座標）；發票已佔滿畫面或 PDF 則 null",
      additionalProperties: false,
      required: ["x0", "y0", "x1", "y1"],
      properties: {
        x0: { type: "number", description: "左上角 X（0–1000）" },
        y0: { type: "number", description: "左上角 Y（0–1000）" },
        x1: { type: "number", description: "右下角 X（0–1000）" },
        y1: { type: "number", description: "右下角 Y（0–1000）" },
      },
    },
    fields_box: {
      type: ["object", "null"],
      description: "包住發票號碼／日期／統編／名稱／金額等需人工核對欄位的範圍（0–1000 標準化座標）；無法判斷或 PDF 則 null",
      additionalProperties: false,
      required: ["x0", "y0", "x1", "y1"],
      properties: {
        x0: { type: "number", description: "左上角 X（0–1000）" },
        y0: { type: "number", description: "左上角 Y（0–1000）" },
        x1: { type: "number", description: "右下角 X（0–1000）" },
        y1: { type: "number", description: "右下角 Y（0–1000）" },
      },
    },
    period_roc_year: { type: ["number", "null"], description: "字軌期別民國年（如 115）；未印則 null" },
    period_start_month: { type: ["number", "null"], description: "字軌期別起月（1–12）；未印則 null" },
    period_end_month: { type: ["number", "null"], description: "字軌期別迄月（1–12）；未印則 null" },
    format_code: {
      type: ["string", "null"],
      description:
        "格式代號：25＝電子發票證明聯或有買方統編的收銀機發票（三聯式）、21＝手開／手寫發票、22＝無買方統編的收銀機發票（二聯式）；無法判斷 null",
    },
    field_boxes: {
      type: ["object", "null"],
      description: "各欄位在照片中的概略範圍；完全無法定位或 PDF 則整個 null",
      additionalProperties: false,
      required: [...FIELD_BOX_KEYS],
      properties: Object.fromEntries(FIELD_BOX_KEYS.map((k) => [k, claudeBoxSchema(FIELD_BOX_LABELS[k])])),
    },
  },
} as const;

const GEMINI_TAX_OUTPUT_SCHEMA = {
  type: "OBJECT",
  required: [
    "invoice_number",
    "invoice_date",
    "seller_name",
    "seller_tax_id",
    "buyer_tax_id",
    "amount_ex_tax",
    "tax_amount",
    "amount_inc_tax",
    "crop_box",
    "fields_box",
    "period_roc_year",
    "period_start_month",
    "period_end_month",
    "format_code",
    "field_boxes",
  ],
  properties: {
    invoice_number: { type: "STRING", nullable: true, description: "發票號碼：2 碼英文＋8 碼數字，去除空白與連字號" },
    invoice_date: { type: "STRING", nullable: true, description: "發票日期，YYYY-MM-DD；民國年＝西元年－1911" },
    seller_name: { type: "STRING", nullable: true, description: "賣方（開立發票方）名稱" },
    seller_tax_id: { type: "STRING", nullable: true, description: "賣方統一編號（8 碼數字）" },
    buyer_tax_id: { type: "STRING", nullable: true, description: "買方統一編號（8 碼數字；無則 null）" },
    amount_ex_tax: { type: "NUMBER", nullable: true, description: "銷售額（未稅）；未列則 null" },
    tax_amount: { type: "NUMBER", nullable: true, description: "營業稅額；未列則 null" },
    amount_inc_tax: { type: "NUMBER", nullable: true, description: "總計（含稅）；未列則 null" },
    crop_box: {
      type: "OBJECT",
      nullable: true,
      description: "發票紙張在照片中的範圍（0–1000 標準化座標）；發票已佔滿畫面或 PDF 則 null",
      required: ["x0", "y0", "x1", "y1"],
      properties: {
        x0: { type: "NUMBER", description: "左上角 X（0–1000）" },
        y0: { type: "NUMBER", description: "左上角 Y（0–1000）" },
        x1: { type: "NUMBER", description: "右下角 X（0–1000）" },
        y1: { type: "NUMBER", description: "右下角 Y（0–1000）" },
      },
    },
    fields_box: {
      type: "OBJECT",
      nullable: true,
      description: "包住發票號碼／日期／統編／名稱／金額等需人工核對欄位的範圍（0–1000 標準化座標）；無法判斷或 PDF 則 null",
      required: ["x0", "y0", "x1", "y1"],
      properties: {
        x0: { type: "NUMBER", description: "左上角 X（0–1000）" },
        y0: { type: "NUMBER", description: "左上角 Y（0–1000）" },
        x1: { type: "NUMBER", description: "右下角 X（0–1000）" },
        y1: { type: "NUMBER", description: "右下角 Y（0–1000）" },
      },
    },
    period_roc_year: { type: "NUMBER", nullable: true, description: "字軌期別民國年（如 115）；未印則 null" },
    period_start_month: { type: "NUMBER", nullable: true, description: "字軌期別起月（1–12）；未印則 null" },
    period_end_month: { type: "NUMBER", nullable: true, description: "字軌期別迄月（1–12）；未印則 null" },
    format_code: {
      type: "STRING",
      nullable: true,
      description:
        "格式代號：25＝電子發票證明聯或有買方統編的收銀機發票（三聯式）、21＝手開／手寫發票、22＝無買方統編的收銀機發票（二聯式）；無法判斷 null",
    },
    field_boxes: {
      type: "OBJECT",
      nullable: true,
      description: "各欄位在照片中的概略範圍；完全無法定位或 PDF 則整個 null",
      required: [...FIELD_BOX_KEYS],
      properties: Object.fromEntries(FIELD_BOX_KEYS.map((k) => [k, geminiBoxSchema(FIELD_BOX_LABELS[k])])),
    },
  },
} as const;

/** 依文件類型選 prompt 與 schema：billing=廠商請款單（預設）、tax_invoice=統一發票 */
type DocType = "billing" | "tax_invoice";

interface DocConfig {
  prompt: string;
  claudeSchema: Record<string, unknown>;
  geminiSchema: Record<string, unknown>;
  /** 解析後的結果健檢（避免模型輸出缺欄位） */
  validate: (parsed: unknown) => boolean;
}

const DOC_CONFIGS: Record<DocType, DocConfig> = {
  billing: {
    prompt: RECOGNITION_PROMPT,
    claudeSchema: CLAUDE_OUTPUT_SCHEMA,
    geminiSchema: GEMINI_OUTPUT_SCHEMA,
    validate: (parsed) => Array.isArray((parsed as RecognizedInvoice | null)?.items),
  },
  tax_invoice: {
    prompt: TAX_RECOGNITION_PROMPT,
    claudeSchema: CLAUDE_TAX_OUTPUT_SCHEMA,
    geminiSchema: GEMINI_TAX_OUTPUT_SCHEMA,
    validate: (parsed) =>
      parsed != null && typeof parsed === "object" && "invoice_number" in parsed && "amount_inc_tax" in parsed,
  },
};

type RecognitionOutcome =
  | { ok: true; result: RecognizedInvoice | RecognizedTaxInvoice }
  | { ok: false; status: number; error: string };

function parseRecognizedInvoice(text: string, config: DocConfig): RecognitionOutcome {
  try {
    const parsed = JSON.parse(text);
    if (!config.validate(parsed)) {
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
  config: DocConfig,
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
        format: { type: "json_schema", schema: config.claudeSchema },
      },
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: config.prompt }],
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
    return parseRecognizedInvoice(text, config);
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
  config: DocConfig,
  modelOverride?: string,
): Promise<RecognitionOutcome> {
  const model = modelOverride || process.env.INVOICE_GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      // 主模型 35 秒未回應即中止改打備援；備援 45 秒（Vercel 上限 60 秒）
      signal: AbortSignal.timeout(modelOverride ? 45000 : 35000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mediaType, data: fileBase64 } },
              { text: config.prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: config.geminiSchema,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const apiMessage: string | undefined = body?.error?.message;
      console.error("invoice-recognition (gemini) error:", model, res.status, apiMessage);
      // 主模型過載或限流時，自動退用較輕量的備援模型重試一次
      const fallback = process.env.INVOICE_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
      if (!modelOverride && (res.status === 429 || res.status === 503) && fallback !== model) {
        return recognizeWithGemini(apiKey, fileBase64, mediaType, config, fallback);
      }
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
    return parseRecognizedInvoice(text, config);
  } catch (err) {
    console.error("invoice-recognition (gemini) error:", model, err);
    const isTimeout =
      (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
      /timeout|aborted/i.test(err instanceof Error ? err.message : "");
    const fallback = process.env.INVOICE_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
    if (!modelOverride && isTimeout && fallback !== model) {
      return recognizeWithGemini(apiKey, fileBase64, mediaType, config, fallback);
    }
    return {
      ok: false,
      status: 502,
      error: isTimeout ? "AI 服務回應逾時（上游壅塞），請稍後再試" : "辨識失敗，請稍後再試",
    };
  }
}

export async function POST(request: NextRequest) {
  // 此端點會消耗 AI 額度，僅放行已登入的 ERP 使用者（前端帶 Supabase access token）
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ success: false, error: "未登入" }, { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return NextResponse.json({ success: false, error: "登入已失效，請重新登入" }, { status: 401 });
  }

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
  const docType: DocType = body?.doc_type === "tax_invoice" ? "tax_invoice" : "billing";
  const config = DOC_CONFIGS[docType];

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
    ? await recognizeWithClaude(anthropicKey, fileBase64, mediaType, isPdf, config)
    : await recognizeWithGemini(geminiKey!, fileBase64, mediaType, config);

  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ success: true, result: outcome.result });
}
