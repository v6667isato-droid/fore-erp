import { formatDateKey } from "@/lib/calendar-month";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  normalizeWorkOrderStage,
  workOrderStageSortIndex,
} from "@/lib/work-order-stages";

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
  /** 品項摘要（order_items：名稱＋數量），今日摘要顯示用 */
  items?: { name: string; quantity: number }[];
  /** 工單負責人姓名（去重；未出貨工單優先），今日摘要顯示用 */
  assignee_names?: string[];
  /** 工單目前工序（去重、依站別順序；未出貨工單優先），今日摘要顯示用 */
  stages?: string[];
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

/** 距交貨天數標籤：>0 離交貨還有 N 天；0 今日交貨；<0 已到期 N 天 */
export function formatDueCountdownLabel(expectedIso: string, todayIso: string): string {
  const toDate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const diff = Math.round(
    (toDate(expectedIso).getTime() - toDate(todayIso).getTime()) / 86_400_000,
  );
  if (diff > 0) return `離交貨還有 ${diff} 天`;
  if (diff === 0) return "今日交貨";
  return `已到期 ${-diff} 天`;
}

/** 今日摘要條目：[交期] 客戶，品項 ×數量，離交貨還有 N 天／已到期 N 天 */
export function formatCalendarOrderDueSummaryTitle(
  row: CalendarOrderDueItem,
  todayIso: string,
): string {
  const ship = row.shipping_contact_name?.trim();
  const cust = row.customer_contact_person?.trim();
  const contact = ship || cust || row.customer_short?.trim() || row.order_number || "—";
  const items = row.items ?? [];
  const itemsText = items.length
    ? items.map((it) => `${it.name} ×${it.quantity}`).join("、")
    : "—";
  return `[交期] ${contact}，${itemsText}，${formatDueCountdownLabel(row.expected_date, todayIso)}`;
}

function parseOrderItemsRel(raw: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; quantity: number }[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as { custom_name?: unknown; quantity?: unknown; product_variants?: unknown };
    const pv = Array.isArray(o.product_variants) ? o.product_variants[0] : o.product_variants;
    const code =
      pv && typeof pv === "object" ? (pv as { product_code?: unknown }).product_code : null;
    const name =
      typeof o.custom_name === "string" && o.custom_name.trim()
        ? o.custom_name.trim()
        : typeof code === "string" && code.trim()
          ? code.trim()
          : "品項";
    const qty = Number(o.quantity ?? 0) || 0;
    out.push({ name, quantity: qty });
  }
  return out;
}

/** 各品項工單的負責人與工序（未出貨工單優先；全部已出貨時才顯示已出貨） */
function parseWorkOrderMeta(orderItemsRaw: unknown): {
  assignee_names: string[];
  stages: string[];
} {
  const entries: { stage: string; name: string | null }[] = [];
  if (Array.isArray(orderItemsRaw)) {
    for (const it of orderItemsRaw) {
      if (!it || typeof it !== "object") continue;
      const wos = (it as { work_orders?: unknown }).work_orders;
      const list = Array.isArray(wos) ? wos : wos ? [wos] : [];
      for (const wo of list) {
        if (!wo || typeof wo !== "object") continue;
        const o = wo as { stage?: unknown; employees?: unknown };
        const emp = Array.isArray(o.employees) ? o.employees[0] : o.employees;
        const name =
          emp && typeof emp === "object" && typeof (emp as { name?: unknown }).name === "string"
            ? ((emp as { name: string }).name.trim() || null)
            : null;
        entries.push({
          stage: normalizeWorkOrderStage(typeof o.stage === "string" ? o.stage : null),
          name,
        });
      }
    }
  }
  const active = entries.filter((e) => e.stage !== "已出貨");
  const scope = active.length > 0 ? active : entries;
  const stages = [...new Set(scope.map((e) => e.stage))].sort(
    (a, b) => workOrderStageSortIndex(a) - workOrderStageSortIndex(b),
  );
  const assignee_names = [
    ...new Set(scope.map((e) => e.name).filter((n): n is string => Boolean(n))),
  ];
  return { assignee_names, stages };
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
      "id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, shipping_contact_name, customers(name, alias, contact_person), order_items(custom_name, quantity, product_variants(product_code), work_orders(stage, employees!assignee_id(name)))"
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
      items: parseOrderItemsRel(r.order_items),
      ...parseWorkOrderMeta(r.order_items),
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
        items: [{ name: ["大板椅", "圈椅", "長凳"][idx], quantity: idx + 1 }],
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
