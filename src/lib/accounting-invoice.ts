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

export interface AccountingInvoiceRow {
  id: string;
  file_path: string;
  file_url: string;
  file_name: string | null;
  media_type: string | null;
  status: AccountingInvoiceStatus;
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
  purchase_order_id: string | null;
  notes: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  purchase_orders?: AccountingInvoicePo | null;
}

export const ACCOUNTING_INVOICE_FIELDS =
  "id, file_path, file_url, file_name, media_type, status, recognized, error, invoice_number, invoice_date, seller_name, seller_tax_id, buyer_tax_id, amount_ex_tax, tax_amount, amount_inc_tax, purchase_order_id, notes, created_at, reviewed_at";

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
    const base64 = await blobToBase64(blob);
    const res = await fetch("/api/invoice-recognition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
