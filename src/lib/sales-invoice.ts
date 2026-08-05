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

/** 發票 ↔ 訂單多對多關聯列（一張發票可涵蓋多張訂單） */
export interface SalesInvoiceOrderLink {
  order_id: string;
  orders: SalesInvoiceOrderSummary | null;
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
  /** 發票涵蓋的全部訂單（含主要訂單；多張訂單合併開票時多筆） */
  sales_invoice_orders?: SalesInvoiceOrderLink[];
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
      // orders 指定 FK 路徑：避免 PostgREST 節點快取殘留其他關聯（如曾短暫存在的
      // sales_invoice_orders 表）時回 PGRST201 模糊錯誤
      `${SALES_INVOICE_FIELDS}, orders!sales_invoices_order_id_fkey (id, order_number), sales_invoice_orders (order_id, orders (id, order_number)), sales_allowances (id, invoice_id, allowance_number, allowance_date, amount_ex_tax, tax_amount, amount_inc_tax, reason, status, deleted_at)`,
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

/** 各訂單已開發票統計（訂單列表顯示開票狀態用）：order_id → 未作廢張數（含多訂單連結） */
export async function fetchOrderInvoiceCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("sales_invoice_orders")
    .select("order_id, sales_invoices!inner (status, deleted_at)")
    .is("sales_invoices.deleted_at", null);
  if (error) {
    console.error("訂單開票統計讀取失敗:", error.message);
    return {};
  }
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as unknown as { order_id: string; sales_invoices: { status: string } }[]) {
    if (r.sales_invoices.status === "voided") continue;
    map[r.order_id] = (map[r.order_id] ?? 0) + 1;
  }
  return map;
}

/** 單張發票目前連結的訂單清單 */
export async function fetchInvoiceOrderLinks(invoiceId: string): Promise<SalesInvoiceOrderSummary[]> {
  const { data, error } = await supabase
    .from("sales_invoice_orders")
    .select("orders (id, order_number)")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("發票訂單連結讀取失敗:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as { orders: SalesInvoiceOrderSummary | null }[])
    .map((r) => r.orders)
    .filter((o): o is SalesInvoiceOrderSummary => o != null);
}

/**
 * 覆寫發票的訂單連結（多對多），並同步 sales_invoices.order_id（相容欄位＝第一張）。
 * 回傳 null＝成功，否則為錯誤訊息。
 */
export async function saveSalesInvoiceOrderLinks(invoiceId: string, orderIds: string[]): Promise<string | null> {
  const { error: delErr } = await supabase.from("sales_invoice_orders").delete().eq("invoice_id", invoiceId);
  if (delErr) return delErr.message;
  if (orderIds.length > 0) {
    const { error: insErr } = await supabase
      .from("sales_invoice_orders")
      .insert(orderIds.map((order_id) => ({ invoice_id: invoiceId, order_id })));
    if (insErr) return insErr.message;
  }
  const { error: updErr } = await supabase
    .from("sales_invoices")
    .update({ order_id: orderIds[0] ?? null })
    .eq("id", invoiceId);
  if (updErr) return updErr.message;
  return null;
}

/** 訂單連結選項（含客戶、日期與金額，方便辨識） */
export interface OrderLinkOption extends SalesInvoiceOrderSummary {
  order_date: string | null;
  customer_name: string | null;
  total_amount: number | null;
}

const ORDER_LINK_SELECT = "id, order_number, order_date, total_amount, customers (name, company)";

interface OrderLinkQueryRow {
  id: string;
  order_number: string;
  order_date: string | null;
  total_amount: number | null;
  customers: { name: string; company: string | null } | null;
}

function toOrderLinkOption(r: OrderLinkQueryRow): OrderLinkOption {
  return {
    id: r.id,
    order_number: r.order_number,
    order_date: r.order_date,
    // 顯示聯絡人姓名（customers.name）；無名字才退回公司名
    customer_name: r.customers?.name?.trim() || r.customers?.company || null,
    total_amount: r.total_amount,
  };
}

/** or() 過濾式中的保留字元先移除，避免使用者輸入破壞語法 */
function sanitizeIlike(s: string): string {
  return s.replace(/[,()"]/g, "").trim();
}

/** 依名稱／公司／發票抬頭找客戶 id */
async function findCustomerIds(keyword: string): Promise<string[]> {
  const kw = sanitizeIlike(keyword);
  if (!kw) return [];
  const { data } = await supabase
    .from("customers")
    .select("id")
    .or(`name.ilike.%${kw}%,company.ilike.%${kw}%,invoice_title.ilike.%${kw}%`)
    .limit(10);
  return ((data ?? []) as { id: string }[]).map((c) => c.id);
}

/** 搜尋訂單（連結發票用）：訂單號或客戶名稱模糊比對，訂單號命中優先 */
export async function searchOrdersForInvoiceLink(keyword: string): Promise<OrderLinkOption[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const [byNumberRes, customerIds] = await Promise.all([
    supabase
      .from("orders")
      .select(ORDER_LINK_SELECT)
      .ilike("order_number", `%${kw}%`)
      .order("created_at", { ascending: false })
      .limit(8),
    findCustomerIds(kw),
  ]);
  const merged: OrderLinkQueryRow[] = [...((byNumberRes.data ?? []) as unknown as OrderLinkQueryRow[])];
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("orders")
      .select(ORDER_LINK_SELECT)
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false })
      .limit(8);
    for (const r of (data ?? []) as unknown as OrderLinkQueryRow[]) {
      if (!merged.some((m) => m.id === r.id)) merged.push(r);
    }
  }
  return merged.slice(0, 10).map(toOrderLinkOption);
}

/** 依發票買方比對客戶（B2B 統編優先、否則抬頭名稱），建議該客戶最近的訂單 */
export async function suggestOrdersForInvoice(
  buyerTaxId: string | null,
  buyerName: string | null,
): Promise<OrderLinkOption[]> {
  let customerIds: string[] = [];
  const ban = (buyerTaxId ?? "").trim();
  if (/^\d{8}$/.test(ban)) {
    const { data } = await supabase.from("customers").select("id").eq("tax_id", ban).limit(10);
    customerIds = ((data ?? []) as { id: string }[]).map((c) => c.id);
  }
  if (customerIds.length === 0 && (buyerName ?? "").trim()) {
    customerIds = await findCustomerIds(buyerName ?? "");
  }
  if (customerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_LINK_SELECT)
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    console.error("訂單建議讀取失敗:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as OrderLinkQueryRow[]).map(toOrderLinkOption);
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

/** 從光貿同步發票回 ERP（預設近 60 天）：新增缺漏、補作廢狀態 */
export function amegoSyncInvoices(days = 60) {
  return callAmegoApi<{
    checked: number;
    imported: number;
    voided_updated: number;
    conflicts: string[];
    errors: string[];
  }>({ action: "sync", days });
}

/** 下載發票 PDF 並以「買方名稱_發票號碼.pdf」存檔 */
export async function amegoDownloadInvoicePdf(
  invoice: Pick<SalesInvoiceRow, "id" | "invoice_number" | "buyer_name">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: "尚未登入，請重新登入後再試" };
  try {
    const res = await fetch("/api/amego", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "file", invoice_id: invoice.id }),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error ?? `發票 PDF 下載失敗（HTTP ${res.status}）` };
    }
    const blob = await res.blob();
    const name = [invoice.buyer_name?.trim(), invoice.invoice_number]
      .filter(Boolean)
      .join("_")
      .replace(/[\\/:*?"<>|]/g, "");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "發票"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "無法連線伺服器，請稍後再試" };
  }
}

/** 某訂單的全部發票（未刪除，新→舊；訂單內檢視用；含多訂單連結） */
export async function fetchSalesInvoicesByOrder(orderId: string): Promise<SalesInvoiceRow[]> {
  const { data, error } = await supabase
    .from("sales_invoice_orders")
    .select(`sales_invoices!inner (${SALES_INVOICE_FIELDS})`)
    .eq("order_id", orderId)
    .is("sales_invoices.deleted_at", null);
  if (error) {
    console.error("訂單發票讀取失敗:", error.message);
    return [];
  }
  const rows = ((data ?? []) as unknown as { sales_invoices: SalesInvoiceRow }[]).map((r) => r.sales_invoices);
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return rows;
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
