import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database.types";
import type { RecognizedTaxInvoice } from "@/app/api/invoice-recognition/route";
import { blobToBase64 } from "@/lib/invoice-scan";

/** pending=待辨識 / ready=待審核 / failed=辨識失敗 / confirmed=已審核存檔 */
export type AccountingInvoiceStatus = "pending" | "ready" | "failed" | "confirmed";

/** 已存檔發票關聯的採購單摘要（巢狀 select） */
export interface AccountingInvoicePo {
  id: string;
  po_number: string;
  purchase_date: string;
  vendor_name: string | null;
}

/** 進項憑證格式代號（報稅媒體檔用） */
export type InvoiceFormatCode = "21" | "22" | "25";

/** 發票來源：manual=手動輸入 / upload=手動上傳 / gmail=Gmail 自動抓取 */
export type AccountingInvoiceSource = "manual" | "upload" | "gmail";

export const SOURCE_LABELS: Record<AccountingInvoiceSource, string> = {
  manual: "手動輸入",
  upload: "手動上傳",
  gmail: "Gmail",
};

export interface AccountingInvoiceRow {
  id: string;
  file_path: string;
  file_url: string;
  file_name: string | null;
  media_type: string | null;
  status: AccountingInvoiceStatus;
  source: AccountingInvoiceSource;
  gmail_message_id: string | null;
  gmail_subject: string | null;
  gmail_from: string | null;
  recognized: RecognizedTaxInvoice | null;
  error: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  seller_tax_id: string | null;
  buyer_tax_id: string | null;
  amount_ex_tax: number | null;
  tax_amount: number | null;
  amount_inc_tax: number | null;
  format_code: InvoiceFormatCode;
  deduction_code: number;
  tax_type: number;
  exported_at: string | null;
  purchase_order_id: string | null;
  notes: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  purchase_orders?: AccountingInvoicePo | null;
}

export const ACCOUNTING_INVOICE_FIELDS =
  "id, file_path, file_url, file_name, media_type, status, source, gmail_message_id, gmail_subject, gmail_from, recognized, error, invoice_number, invoice_date, seller_name, seller_tax_id, buyer_tax_id, amount_ex_tax, tax_amount, amount_inc_tax, format_code, deduction_code, tax_type, exported_at, purchase_order_id, notes, created_at, reviewed_at";

/** 格式代號選項（進項；報稅媒體申報） */
export const FORMAT_CODE_OPTIONS: { value: InvoiceFormatCode; label: string }[] = [
  { value: "25", label: "25 三聯式收銀機／電子發票" },
  { value: "21", label: "21 手開三聯式發票" },
  { value: "22", label: "22 二聯式收銀機發票（內含稅）" },
];

/** 扣抵代號：1/2 可扣抵、3/4 不可扣抵 */
export const DEDUCTION_CODE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 進貨及費用（可扣抵）" },
  { value: 2, label: "2 固定資產（可扣抵）" },
  { value: 3, label: "3 進貨及費用（不可扣抵）" },
  { value: 4, label: "4 固定資產（不可扣抵）" },
];

/** 課稅別 */
export const TAX_TYPE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 應稅" },
  { value: 2, label: "2 零稅率" },
  { value: 3, label: "3 免稅" },
];

/** 發票號碼正規化：去空白／連字號、轉大寫；符合 2 英 8 數則存為 XX-12345678 */
export function normalizeInvoiceNumber(raw: string): string {
  const s = raw.replace(/[\s-]+/g, "").toUpperCase();
  const m = s.match(/^([A-Z]{2})(\d{8})$/);
  return m ? `${m[1]}-${m[2]}` : raw.trim().toUpperCase();
}

/** 是否為合法統一發票號碼格式（正規化後 XX-12345678） */
export function isValidInvoiceNumber(value: string): boolean {
  return /^[A-Z]{2}-\d{8}$/.test(value);
}

/**
 * 歸檔路徑：archive/{YYYY-MM}/{發票號碼}_{日期}.{ext}
 * 檔名即發票號碼＋日期、依月份分資料夾，未來可整月打包下載封存
 */
export function accountingArchivePath(
  invoiceNumber: string,
  invoiceDate: string,
  rowId: string,
  ext: string,
): string {
  const number = normalizeInvoiceNumber(invoiceNumber) || rowId;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? invoiceDate : "";
  const month = date ? date.slice(0, 7) : "未指定日期";
  return `archive/${month}/${number}${date ? `_${date}` : ""}.${ext}`;
}

/** 歸檔後的顯示／下載檔名（同 storage 檔名） */
export function accountingArchiveFileName(invoiceNumber: string, invoiceDate: string, ext: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? `_${invoiceDate}` : "";
  return `${normalizeInvoiceNumber(invoiceNumber)}${date}.${ext}`;
}

/** 佇列（未存檔）發票，依上傳時間排序 */
export async function fetchInvoiceQueue(): Promise<AccountingInvoiceRow[]> {
  const { data, error } = await supabase
    .from("accounting_invoices")
    .select(ACCOUNTING_INVOICE_FIELDS)
    .is("deleted_at", null)
    .neq("status", "confirmed")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("待審發票讀取失敗:", error.message);
    return [];
  }
  return (data ?? []) as unknown as AccountingInvoiceRow[];
}

/** 已審核存檔的發票（含對應採購單摘要），依發票日期新→舊 */
export async function fetchConfirmedInvoices(): Promise<AccountingInvoiceRow[]> {
  const { data, error } = await supabase
    .from("accounting_invoices")
    .select(`${ACCOUNTING_INVOICE_FIELDS}, purchase_orders (id, po_number, purchase_date, vendor_name)`)
    .is("deleted_at", null)
    .eq("status", "confirmed")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("發票清單讀取失敗:", error.message);
    return [];
  }
  return (data ?? []) as unknown as AccountingInvoiceRow[];
}

export interface GmailImportResult {
  ok: boolean;
  /** 新匯入的張數 */
  imported: number;
  /** 已匯入過而略過的信件數 */
  skipped: number;
  /** 內容重複（如轉寄信）而略過的附件數 */
  duplicates: number;
  /** 沒有可用附件的信件數 */
  noAttachment: number;
  /** 因單次處理上限而尚未匯入的新信件數（再按一次即可續匯） */
  remaining: number;
  /** 本次成功貼上「ERP已匯入」標籤的信件數 */
  labeled: number;
  /** Gmail 授權仍為唯讀、無法貼標籤（需重新授權 gmail.modify） */
  labelingUnavailable: boolean;
  /** 新建佇列紀錄的 id（前端接著跑辨識） */
  ids: string[];
  error?: string;
  notConfigured?: boolean;
}

const GMAIL_IMPORT_FAILURE: Omit<GmailImportResult, "error"> = {
  ok: false,
  imported: 0,
  skipped: 0,
  duplicates: 0,
  noAttachment: 0,
  remaining: 0,
  labeled: 0,
  labelingUnavailable: false,
  ids: [],
};

/** 呼叫 Gmail 匯入 API：撈發票信件附件進佇列（source=gmail） */
export async function importInvoicesFromGmail(): Promise<GmailImportResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ...GMAIL_IMPORT_FAILURE, error: "尚未登入，請重新登入後再試" };
  try {
    const res = await fetch("/api/gmail-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      return {
        ok: true,
        imported: json.imported ?? 0,
        skipped: json.skipped ?? 0,
        duplicates: json.duplicates ?? 0,
        noAttachment: json.no_attachment ?? 0,
        remaining: json.remaining ?? 0,
        labeled: json.labeled ?? 0,
        labelingUnavailable: Boolean(json.labeling_unavailable),
        ids: Array.isArray(json.ids) ? json.ids : [],
      };
    }
    return {
      ...GMAIL_IMPORT_FAILURE,
      error: json?.error || "Gmail 匯入失敗，請稍後再試",
      notConfigured: Boolean(json?.not_configured),
    };
  } catch (err) {
    console.error(err);
    return { ...GMAIL_IMPORT_FAILURE, error: err instanceof Error ? err.message : "Gmail 匯入失敗" };
  }
}

export type TaxRecognitionOutcome =
  | { ok: true; recognized: RecognizedTaxInvoice }
  | { ok: false; error: string; notConfigured?: boolean };

/** 呼叫辨識 API（doc_type=tax_invoice）並把結果寫回發票紀錄（status → ready / failed） */
export async function recognizeAccountingInvoice(
  invoiceId: string,
  blob: Blob,
  mediaType: string,
): Promise<TaxRecognitionOutcome> {
  let outcome: TaxRecognitionOutcome;
  try {
    // 辨識 API 需登入 token 才放行（避免 AI 額度被盜用）
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { ok: false, error: "登入已失效，請重新登入" };

    const base64 = await blobToBase64(blob);
    const res = await fetch("/api/invoice-recognition", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file_base64: base64, media_type: mediaType, doc_type: "tax_invoice" }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      outcome = { ok: true, recognized: json.result as RecognizedTaxInvoice };
    } else {
      outcome = {
        ok: false,
        error: json?.error || "辨識失敗，請稍後再試",
        notConfigured: Boolean(json?.not_configured),
      };
    }
  } catch (err) {
    console.error(err);
    outcome = { ok: false, error: err instanceof Error ? err.message : "辨識失敗" };
  }

  const patch = outcome.ok
    ? { status: "ready", recognized: outcome.recognized as unknown as Json, error: null }
    : { status: "failed", error: outcome.error };
  const { error: updErr } = await supabase.from("accounting_invoices").update(patch).eq("id", invoiceId);
  if (updErr) console.error("發票狀態更新失敗:", updErr.message);
  return outcome;
}

/** 從 storage 重新抓檔並辨識（佇列中的「重新辨識」） */
export async function recognizeAccountingInvoiceFromUrl(
  row: AccountingInvoiceRow,
): Promise<TaxRecognitionOutcome> {
  try {
    const res = await fetch(row.file_url);
    if (!res.ok) return { ok: false, error: "附件下載失敗，無法重新辨識" };
    const blob = await res.blob();
    const mediaType = row.media_type || blob.type || "image/jpeg";
    return await recognizeAccountingInvoice(row.id, blob, mediaType);
  } catch (err) {
    console.error(err);
    return { ok: false, error: err instanceof Error ? err.message : "重新辨識失敗" };
  }
}
