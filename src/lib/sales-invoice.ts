import { supabase } from "@/lib/supabase";

/** draft=草稿（未取號）/ issued=已開立 / voided=已作廢 */
export type SalesInvoiceStatus = "draft" | "issued" | "voided";

/** B2B=買方有統編 / B2C=一般消費者 */
export type SalesInvoiceType = "B2B" | "B2C";

/** 光賀同步狀態：none=手開登記未送 / pending=待送 / sent=已送出 / confirmed=成功 / failed=失敗 */
export type SalesInvoiceSyncStatus = "none" | "pending" | "sent" | "confirmed" | "failed";

export const SALES_STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  draft: "草稿",
  issued: "已開立",
  voided: "已作廢",
};

export const SYNC_STATUS_LABELS: Record<SalesInvoiceSyncStatus, string> = {
  none: "手開登記",
  pending: "待送光賀",
  sent: "已送光賀",
  confirmed: "光賀已確認",
  failed: "傳送失敗",
};

/** B2C 載具類別（電子發票常用） */
export const CARRIER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "無載具" },
  { value: "3J0002", label: "手機條碼" },
  { value: "CQ0001", label: "自然人憑證" },
  { value: "EGUI", label: "會員載具" },
];

export interface SalesInvoiceOrderSummary {
  id: string;
  order_number: string;
}

export interface SalesInvoiceRow {
  id: string;
  order_id: string | null;
  invoice_type: SalesInvoiceType;
  invoice_number: string | null;
  invoice_date: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_email: string | null;
  carrier_type: string | null;
  carrier_id: string | null;
  donation_code: string | null;
  print_flag: boolean;
  tax_type: number;
  amount_ex_tax: number | null;
  tax_amount: number | null;
  amount_inc_tax: number | null;
  status: SalesInvoiceStatus;
  issued_at: string | null;
  void_date: string | null;
  void_reason: string | null;
  sync_status: SalesInvoiceSyncStatus;
  external_id: string | null;
  synced_at: string | null;
  sync_error: string | null;
  exported_at: string | null;
  notes: string | null;
  created_at: string | null;
  orders?: SalesInvoiceOrderSummary | null;
  /** 折讓單（未刪除） */
  sales_allowances?: SalesAllowanceRow[];
}

export interface SalesInvoiceItemRow {
  id: string;
  invoice_id: string;
  order_item_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  sort_order: number;
}

export interface SalesAllowanceRow {
  id: string;
  invoice_id: string;
  allowance_number: string | null;
  allowance_date: string | null;
  amount_ex_tax: number | null;
  tax_amount: number | null;
  amount_inc_tax: number | null;
  reason: string | null;
  status: SalesInvoiceStatus;
  deleted_at?: string | null;
}

export const SALES_INVOICE_FIELDS =
  "id, order_id, invoice_type, invoice_number, invoice_date, buyer_name, buyer_tax_id, buyer_email, carrier_type, carrier_id, donation_code, print_flag, tax_type, amount_ex_tax, tax_amount, amount_inc_tax, status, issued_at, void_date, void_reason, sync_status, external_id, synced_at, sync_error, exported_at, notes, created_at";

/** 全部銷項發票（含訂單摘要與折讓單），依發票日期新→舊 */
export async function fetchSalesInvoices(): Promise<SalesInvoiceRow[]> {
  const { data, error } = await supabase
    .from("sales_invoices")
    .select(
      `${SALES_INVOICE_FIELDS}, orders (id, order_number), sales_allowances (id, invoice_id, allowance_number, allowance_date, amount_ex_tax, tax_amount, amount_inc_tax, reason, status, deleted_at)`,
    )
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("銷項發票讀取失敗:", error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as SalesInvoiceRow[];
  for (const r of rows) {
    r.sales_allowances = (r.sales_allowances ?? []).filter((a) => a.deleted_at == null);
  }
  return rows;
}

/** 單張發票的明細列 */
export async function fetchSalesInvoiceItems(invoiceId: string): Promise<SalesInvoiceItemRow[]> {
  const { data, error } = await supabase
    .from("sales_invoice_items")
    .select("id, invoice_id, order_item_id, description, quantity, unit, unit_price, amount, sort_order")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("發票明細讀取失敗:", error.message);
    return [];
  }
  return (data ?? []) as unknown as SalesInvoiceItemRow[];
}

/** 各訂單已開發票統計（訂單列表顯示開票狀態用）：order_id → 未作廢張數 */
export async function fetchOrderInvoiceCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("sales_invoices")
    .select("order_id, status")
    .is("deleted_at", null)
    .not("order_id", "is", null);
  if (error) {
    console.error("訂單開票統計讀取失敗:", error.message);
    return {};
  }
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { order_id: string | null; status: string }[]) {
    if (!r.order_id || r.status === "voided") continue;
    map[r.order_id] = (map[r.order_id] ?? 0) + 1;
  }
  return map;
}

/** 光賀 API 呼叫結果：ok=false 時 error 為可顯示訊息 */
export type AmegoResult<T> = ({ ok: true; environment: "test" | "production" } & T) | { ok: false; error: string };

/** 呼叫後端光賀 API route（需登入）；網路錯誤與 API 錯誤都收斂成 ok:false */
async function callAmegoApi<T>(payload: Record<string, unknown>): Promise<AmegoResult<T>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: "尚未登入，請重新登入後再試" };
  try {
    const res = await fetch("/api/amego", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: typeof json.error === "string" ? json.error : `光賀操作失敗（HTTP ${res.status}）` };
    }
    return { ok: true, ...(json as T & { environment: "test" | "production" }) };
  } catch {
    return { ok: false, error: "無法連線伺服器，請稍後再試" };
  }
}

/** 光賀開立發票（自動配號）：發票需已存成草稿（無號碼） */
export function amegoIssueInvoice(invoiceId: string) {
  return callAmegoApi<{ invoice_number: string; invoice_date: string; random_number: string }>({
    action: "issue",
    invoice_id: invoiceId,
  });
}

/** 光賀作廢發票（限當期；跨期請開折讓） */
export function amegoVoidInvoice(invoiceId: string, voidDate: string, reason: string) {
  return callAmegoApi<{ ok: true }>({ action: "void", invoice_id: invoiceId, void_date: voidDate, reason });
}

/** 光賀開立折讓（伺服器端會一併寫入 sales_allowances） */
export function amegoCreateAllowance(invoiceId: string, amountIncTax: number, allowanceDate: string, reason: string) {
  return callAmegoApi<{ allowance_number: string }>({
    action: "allowance",
    invoice_id: invoiceId,
    amount_inc_tax: amountIncTax,
    allowance_date: allowanceDate,
    reason,
  });
}

/** 取得發票 PDF 下載連結（10 分鐘有效） */
export function amegoInvoiceFileUrl(invoiceId: string) {
  return callAmegoApi<{ file_url: string }>({ action: "file", invoice_id: invoiceId });
}

/** 統編查公司名稱（自動帶買方抬頭；查不到回空字串） */
export function amegoBanQuery(ban: string) {
  return callAmegoApi<{ name: string }>({ action: "ban", ban });
}

export interface SalesInvoiceTotals {
  amount_ex_tax: number;
  tax_amount: number;
  amount_inc_tax: number;
}

/**
 * 由明細合計算三金額（電子發票 MIG 慣例）：
 * B2B 明細為未稅（稅額＝未稅×5%）；B2C 明細為含稅（未稅＝含稅÷1.05）。
 * 零稅率／免稅（tax_type 2/3）稅額為 0，未稅＝含稅＝合計。
 */
export function calcInvoiceTotals(
  invoiceType: SalesInvoiceType,
  taxType: number,
  lineSum: number,
): SalesInvoiceTotals {
  const sum = Math.round(lineSum * 100) / 100;
  if (taxType !== 1) {
    return { amount_ex_tax: sum, tax_amount: 0, amount_inc_tax: sum };
  }
  if (invoiceType === "B2B") {
    const tax = Math.round(sum * 0.05);
    return { amount_ex_tax: sum, tax_amount: tax, amount_inc_tax: Math.round((sum + tax) * 100) / 100 };
  }
  const ex = Math.round(sum / 1.05);
  return { amount_ex_tax: ex, tax_amount: Math.round((sum - ex) * 100) / 100, amount_inc_tax: sum };
}
