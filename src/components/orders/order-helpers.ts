import type { CustomerRow } from "@/types/crm";
import type { OrderRow, OrderStatus, PaymentStatus, ExplanationImage } from "./types";

export const CUSTOMER_VIEW_SELECT =
  "id, name, alias, contact_person, phone, line_id, ig_account, delivery_address, has_elevator, notes, source, customer_type, channel_id, contact_method";

export function mapCustomerViewRow(r: Record<string, unknown>): CustomerRow {
  const addr = r.delivery_address ?? r.address;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    alias: r.alias != null ? String(r.alias) : null,
    contact_person: r.contact_person != null ? String(r.contact_person) : null,
    phone: r.phone != null ? String(r.phone) : null,
    line_id: r.line_id != null ? String(r.line_id) : null,
    ig_account: r.ig_account != null ? String(r.ig_account) : null,
    delivery_address: addr != null ? String(addr) : null,
    has_elevator: typeof r.has_elevator === "boolean" ? r.has_elevator : null,
    notes: r.notes != null ? String(r.notes) : null,
    source: r.source != null ? String(r.source) : null,
    customer_type: r.customer_type != null ? String(r.customer_type) : null,
    channel_id: r.channel_id != null ? String(r.channel_id) : null,
    contact_method: r.contact_method != null ? String(r.contact_method) : null,
  };
}

/** DB total_amount 為應收總額（折扣後小計+運費）→ 表單「折扣後總金額」欄位 */
export function orderDiscountSubtotalField(order: OrderRow): string {
  if (order.total_amount == null || !Number.isFinite(Number(order.total_amount))) {
    return "";
  }
  const grand = Number(order.total_amount);
  const ship = Math.max(0, Number(order.shipping_fee) || 0);
  return String(Math.max(0, grand - ship));
}

/** 「結案」「已退貨」訂單後台僅能檢視，不可改寫（其餘狀態含已出貨、已結清仍可編輯）；退貨經由列表的退貨入口操作 */
export function isOrderAdminReadOnly(order: Pick<OrderRow, "status">): boolean {
  return order.status === "結案" || order.status === "已退貨";
}

/**
 * 訂單生命週期三集合（總覽三卡與訂單列表 filter 共用；每個 status 僅屬一個集合）：
 * 報價中｜生產中（繪圖中→完成前，含暫停）｜已完成未結案（已完工、已出貨）；「結案」「已退貨」三者皆不計。
 */
export const QUOTE_STATUSES: OrderStatus[] = ["報價中"];
export const PRODUCTION_STATUSES: OrderStatus[] = [
  "繪圖中",
  "排程中",
  "繪製製作圖",
  "生產中",
  "暫停",
];
export const COMPLETED_OPEN_STATUSES: OrderStatus[] = ["已完工", "已出貨"];

/** 已收齊款項的 payment_status；其餘（未付款、部分付款、已付訂金）視為未收齊 */
export const SETTLED_PAYMENT_STATUS: PaymentStatus = "已結清";

export function isPaymentUnsettled(paymentStatus: string | null | undefined): boolean {
  return paymentStatus !== SETTLED_PAYMENT_STATUS;
}

/** 手動可選（不含「暫停」— 僅由生產工序帶入） */
const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "報價中",
  "繪圖中",
  "排程中",
  "繪製製作圖",
  "生產中",
  "已完工",
  "已出貨",
  "結案",
];

/** 列表依「訂單狀態」欄排序時使用（與 ORDER_STATUS_OPTIONS 流程一致；「暫停」介於生產與完工之間） */
const ORDER_STATUS_SORT_ORDER: OrderStatus[] = [
  "報價中",
  "繪圖中",
  "排程中",
  "繪製製作圖",
  "生產中",
  "暫停",
  "已完工",
  "已出貨",
  "結案",
  "已退貨",
];

export function orderStatusSortIndex(status: OrderStatus): number {
  const i = ORDER_STATUS_SORT_ORDER.indexOf(status);
  return i >= 0 ? i : ORDER_STATUS_SORT_ORDER.length;
}

/** 列表依「付款狀態」欄排序時使用 */
const PAYMENT_STATUS_SORT_ORDER: PaymentStatus[] = [
  "未付款",
  "部分付款",
  "已付訂金",
  "已結清",
];

export function paymentStatusSortIndex(p: PaymentStatus): number {
  const i = PAYMENT_STATUS_SORT_ORDER.indexOf(p);
  return i >= 0 ? i : PAYMENT_STATUS_SORT_ORDER.length;
}

export function manualOrderStatusOptions(current: OrderStatus): OrderStatus[] {
  if (current === "暫停") return [];
  if (current === "已完工") return ["已完工", "已出貨", "結案"];
  if (current === "已出貨") return ["已出貨", "結案"];
  if (current === "結案") return [];
  // 「已退貨」僅能由退貨流程設定／還原，不開放手動切換
  if (current === "已退貨") return [];
  return [...ORDER_STATUS_OPTIONS];
}

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  "未付款",
  "已付訂金",
  "已結清",
];

// 與「使用回饋」頁面狀態欄使用相同色系（較鮮明的色階）
export const statusStyles: Record<OrderStatus, string> = {
  報價中: "bg-amber-100 text-amber-800 border-amber-200",
  繪圖中: "bg-violet-100 text-violet-800 border-violet-200",
  排程中: "bg-amber-100 text-amber-800 border-amber-200",
  繪製製作圖: "bg-violet-100 text-violet-800 border-violet-200",
  生產中: "bg-blue-100 text-blue-800 border-blue-200",
  暫停: "bg-orange-100 text-orange-900 border-orange-200",
  已完工: "bg-teal-100 text-teal-900 border-teal-200",
  已出貨: "bg-emerald-100 text-emerald-800 border-emerald-200",
  結案: "bg-slate-200 text-slate-800 border-slate-300",
  已退貨: "bg-rose-100 text-rose-800 border-rose-200",
};

export const paymentStatusStyles: Record<PaymentStatus, string> = {
  未付款: "bg-amber-100 text-amber-800 border-amber-200",
  部分付款: "bg-blue-100 text-blue-800 border-blue-200",
  已付訂金: "bg-blue-100 text-blue-800 border-blue-200",
  已結清: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function generateOrderNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `ORD-${ymd}-${suffix}`;
}

export function parseExplanationImages(raw: string | null | undefined): ExplanationImage[] {
  if (raw == null || raw === "") return [];
  const normalizeUrl = (u: unknown): string | null => {
    if (typeof u !== "string") return null;
    const s = u.trim();
    return s ? s : null;
  };
  const normalizeTitle = (t: unknown): string | null => {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s ? s : null;
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 1) ["url", ...]
      if (parsed.every((x) => typeof x === "string")) {
        return (parsed as string[])
          .map((u) => normalizeUrl(u))
          .filter((u): u is string => Boolean(u))
          .map((url) => ({ url }));
      }
      // 2) [{url,title}, ...]
      return (parsed as any[])
        .map((x): ExplanationImage | null => {
          const url = normalizeUrl((x as any)?.url);
          if (!url) return null;
          const title = normalizeTitle((x as any)?.title);
          return { url, title };
        })
        .filter((x): x is ExplanationImage => x != null);
    }
    if (typeof parsed === "string") {
      const url = normalizeUrl(parsed);
      return url ? [{ url }] : [];
    }
    return [];
  } catch {
    const url = normalizeUrl(raw);
    return url ? [{ url }] : [];
  }
}
