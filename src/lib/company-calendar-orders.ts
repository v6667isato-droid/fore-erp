import { formatDateKey } from "@/lib/calendar-month";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/** 與訂單列表 ORDER_STATUS_SORT_ORDER 一致：行事曆僅顯示 排程中～已完工（含暫停） */
export const CALENDAR_ORDER_STATUSES = [
  "排程中",
  "繪製製作圖",
  "生產中",
  "暫停",
  "已完工",
] as const;

export type CalendarOrderStatus = (typeof CALENDAR_ORDER_STATUSES)[number];

function isCalendarOrderStatus(status: string | null | undefined): status is CalendarOrderStatus {
  if (!status) return false;
  return (CALENDAR_ORDER_STATUSES as readonly string[]).includes(status);
}

/** 行事曆「訂單預計完成日」列（對應 orders.expected_delivery_date） */
export interface CalendarOrderDueItem {
  id: string;
  expected_date: string;
  order_number: string;
  /** 列表條目用：alias 優先，否則 name */
  customer_short?: string | null;
  /** 客戶全名（customers.name） */
  customer_name?: string | null;
  /** 客戶簡稱（customers.alias） */
  customer_alias?: string | null;
  /** 本訂單收貨聯絡人（orders.shipping_contact_name） */
  shipping_contact_name?: string | null;
  /** 客戶主檔聯絡人（customers.contact_person），無 shipping 時後援 */
  customer_contact_person?: string | null;
  order_date?: string | null;
  status?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
}

function parseCustomerRel(customers: unknown): {
  short: string | null;
  name: string | null;
  alias: string | null;
  contact_person: string | null;
} {
  const c = Array.isArray(customers) ? customers[0] : customers;
  if (!c || typeof c !== "object") {
    return { short: null, name: null, alias: null, contact_person: null };
  }
  const o = c as { name?: string | null; alias?: string | null; contact_person?: string | null };
  const alias = typeof o.alias === "string" ? o.alias.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const short = alias || name || null;
  const cp = typeof o.contact_person === "string" ? o.contact_person.trim() : "";
  return {
    short,
    name: name || null,
    alias: alias || null,
    contact_person: cp || null,
  };
}

/** 條目顯示：[交期]「聯絡人」訂單（無聯絡人時後援客戶簡稱／訂單號） */
export function formatCalendarOrderDueTitle(row: CalendarOrderDueItem): string {
  const ship = row.shipping_contact_name?.trim();
  const cust = row.customer_contact_person?.trim();
  const contact = ship || cust || row.customer_short?.trim() || row.order_number || "—";
  return `[交期]「${contact}」訂單`;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 10) return null;
  return v.slice(0, 10);
}

/**
 * 讀取月曆範圍內、已填預計交貨日且未軟刪除的訂單（RLS 依專案設定）。
 */
export async function fetchOrdersExpectedDeliveryBetween(
  startIso: string,
  endIso: string
): Promise<CalendarOrderDueItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, shipping_contact_name, customers(name, alias, contact_person)"
    )
    .is("deleted_at", null)
    .not("expected_delivery_date", "is", null)
    .in("status", [...CALENDAR_ORDER_STATUSES])
    .gte("expected_delivery_date", startIso)
    .lte("expected_delivery_date", endIso)
    .order("expected_delivery_date", { ascending: true })
    .order("order_number", { ascending: true });

  if (error) throw error;

  const out: CalendarOrderDueItem[] = [];
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const id = r.id != null ? String(r.id) : "";
    const order_number = typeof r.order_number === "string" ? r.order_number : "";
    const expected = normalizeIsoDate(r.expected_delivery_date);
    if (!id || !expected) continue;
    const st = typeof r.status === "string" ? r.status : null;
    if (!isCalendarOrderStatus(st)) continue;
    const cust = parseCustomerRel(r.customers);
    const shipName =
      typeof r.shipping_contact_name === "string" ? r.shipping_contact_name.trim() : "";
    out.push({
      id,
      expected_date: expected,
      order_number,
      customer_short: cust.short,
      customer_name: cust.name,
      customer_alias: cust.alias,
      shipping_contact_name: shipName || null,
      customer_contact_person: cust.contact_person,
      order_date: normalizeIsoDate(r.order_date),
      status: st,
      payment_status: typeof r.payment_status === "string" ? r.payment_status : null,
      total_amount: numOrNull(r.total_amount),
    });
  }
  return out;
}

/** 每月 7、15、23 日各一筆範例（僅在未設定 Supabase 時供預覽） */
const DEMO_DAYS = [7, 15, 23] as const;
const DEMO_SUFFIX = ["0912", "0915", "0920"] as const;
const DEMO_LABEL = ["晨熙", "楷模", "大同"] as const;

export function mockOrderDuesBetween(startIso: string, endIso: string): CalendarOrderDueItem[] {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd, 12, 0, 0);
  const end = new Date(ey, em - 1, ed, 12, 0, 0);
  const out: CalendarOrderDueItem[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dayNum = cur.getDate();
    const idx = DEMO_DAYS.findIndex((d) => d === dayNum);
    if (idx >= 0) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      const key = formatDateKey(y, m, dayNum);
      const dayBefore = Math.max(1, dayNum - 12);
      const contacts = ["王小明", "李美華", "陳志偉"];
      out.push({
        id: `demo-order-due-${key}-${idx}`,
        expected_date: key,
        order_number: `ORD-${y}-${DEMO_SUFFIX[idx]}`,
        customer_short: DEMO_LABEL[idx],
        customer_name: `${DEMO_LABEL[idx]} 實業`,
        customer_alias: DEMO_LABEL[idx],
        shipping_contact_name: contacts[idx],
        customer_contact_person: null,
        order_date: formatDateKey(y, m, dayBefore),
        status: "生產中",
        payment_status: "已付訂金",
        total_amount: 128000 + idx * 24000,
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
