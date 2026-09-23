/**
 * 展覽效益統計（純函式）：只看客戶來源與下單日，訂單不另外標記場次。
 * 統計對象＝客戶來源（customers.source）等於場次 customer_source、
 * 下單日落在本屆開始～下一屆同展開始前的訂單；其中
 * - 現場成交：下單日在展期內，或散客代表客戶（客戶種類「展覽」）的訂單
 * - 展後轉單：展期結束後的其餘訂單
 */
import { CUSTOMER_SOURCE_OPTIONS } from "@/lib/customer-options";

export interface ExhibitionRow {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  location: string | null;
  /** 對應的客戶來源值（如「展覽(木質生活)」）；null＝無法統計成交 */
  customer_source: string | null;
  notes: string | null;
}

export interface ExhibitionCostRow {
  id: string;
  exhibition_id: string;
  item: string;
  amount: number;
  notes: string | null;
  sort_order: number;
}

export const EXHIBITION_SELECT = "id, name, start_date, end_date, location, customer_source, notes";

/** 客戶種類為「展覽」＝展場散客的代表客戶（如「木質生活展」「好感空間展」） */
export const EXHIBITION_WALKIN_CUSTOMER_TYPE = "展覽";

/** 客戶來源選項中屬於展覽的值（場次的「對應客戶來源」下拉） */
export const EXHIBITION_CUSTOMER_SOURCES: string[] = CUSTOMER_SOURCE_OPTIONS.filter((s) =>
  s.startsWith("展覽"),
);

export const EXHIBITION_NAME_PRESETS = ["好感空間展", "木質生活展"];

export const EXHIBITION_COST_ITEM_PRESETS = [
  "攤位費",
  "裝潢佈置",
  "運輸",
  "住宿餐費",
  "印刷品",
  "人力加班",
];

/** 依展名推測對應的客戶來源：「好感空間展」→「展覽(好感生活)」（比對括號內前兩字） */
export function defaultCustomerSourceFor(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  return (
    EXHIBITION_CUSTOMER_SOURCES.find((s) => {
      const key = s.match(/\((.+)\)/)?.[1]?.slice(0, 2);
      return key ? n.includes(key) : false;
    }) ?? null
  );
}

/** 連結到展覽的採購品項（purchases.exhibition_id） */
export interface ExhibitionPurchaseRow {
  id: string;
  exhibition_id: string | null;
  purchase_date: string;
  vendor_name: string | null;
  item_name: string;
  item_category: string | null;
  amount_ex_tax: number | null;
  total_amount: number | null;
  po_number: string | null;
}

export const EXHIBITION_PURCHASE_SELECT =
  "id, exhibition_id, purchase_date, vendor_name, item_name, item_category, amount_ex_tax, total_amount, purchase_orders(po_number)";

/** Supabase 回傳列（purchase_orders 為關聯物件）→ ExhibitionPurchaseRow */
export function mapExhibitionPurchase(r: Record<string, unknown>): ExhibitionPurchaseRow {
  const po = r.purchase_orders as { po_number?: string | null } | { po_number?: string | null }[] | null;
  const poNumber = Array.isArray(po) ? po[0]?.po_number : po?.po_number;
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: String(r.id),
    exhibition_id: r.exhibition_id != null ? String(r.exhibition_id) : null,
    purchase_date: String(r.purchase_date ?? ""),
    vendor_name: r.vendor_name != null ? String(r.vendor_name) : null,
    item_name: String(r.item_name ?? ""),
    item_category: r.item_category != null ? String(r.item_category) : null,
    amount_ex_tax: num(r.amount_ex_tax),
    total_amount: num(r.total_amount),
    po_number: poNumber ?? null,
  };
}

/** 採購成本（未稅，與營收口徑一致）：amount_ex_tax，舊資料沒有時用 total_amount */
export function purchaseCostAmount(p: Pick<ExhibitionPurchaseRow, "amount_ex_tax" | "total_amount">): number {
  return Number(p.amount_ex_tax ?? p.total_amount) || 0;
}

/** 連結採購的候選期間：展前 180 天（攤位費常提早付）～展後 60 天 */
export function purchaseCandidateRange(startDate: string, endDate: string): { from: string; to: string } {
  const shift = (ymd: string, days: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(startDate, -180), to: shift(endDate, 60) };
}

const LIKELY_EXHIBITION_PURCHASE = /展覽|攤位|佈置|布置|展場|會展/;

/** 看起來像展覽支出的採購（品名、廠商或類別含展覽／攤位／佈置等），連結清單排在前面 */
export function isLikelyExhibitionPurchase(
  p: Pick<ExhibitionPurchaseRow, "item_name" | "vendor_name" | "item_category">,
): boolean {
  return [p.item_name, p.vendor_name, p.item_category].some((t) => t != null && LIKELY_EXHIBITION_PURCHASE.test(t));
}

/** 效益統計排除的訂單狀態（與銷售統計一致排除報價；退貨不計營收） */
const EXCLUDED_STATUSES = new Set(["報價中", "已退貨"]);

export function exhibitionLabel(e: Pick<ExhibitionRow, "name" | "start_date">): string {
  return `${e.start_date.slice(0, 4)} ${e.name}`;
}

export interface EffectOrderInput {
  id: string;
  order_date: string | null;
  customer_id: string | null;
  status: string | null;
  total_amount: number | null;
  shipping_fee: number | null;
  tax_extra_amount: number | null;
}

export interface EffectCustomerInput {
  id: string;
  source: string | null;
  customer_type: string | null;
}

export interface ExhibitionEffect {
  exhibition: ExhibitionRow;
  /** 統計到此日前（不含）＝下一屆同展開始日；null＝統計至今 */
  windowEnd: string | null;
  onsiteOrders: number;
  /** 其中散客代表客戶的張數 */
  onsiteWalkInOrders: number;
  onsiteRevenue: number;
  postShowOrders: number;
  postShowCustomers: number;
  postShowRevenue: number;
  totalRevenue: number;
  /** 首次成交落在本屆開始之後的客戶數（不含散客代表客戶） */
  newCustomers: number;
  /** 成本合計＝連結採購（未稅）＋其他成本 */
  cost: number;
  purchaseCost: number;
  purchaseCount: number;
  otherCost: number;
  /** 營收 ÷ 成本；無成本時 null */
  revenuePerCost: number | null;
  costPerNewCustomer: number | null;
  avgOrderValue: number | null;
}

/** 訂單營收：未稅、不含運費（total_amount 扣掉運費與外加稅額） */
export function orderNetRevenue(o: Pick<EffectOrderInput, "total_amount" | "shipping_fee" | "tax_extra_amount">): number {
  const total = Number(o.total_amount) || 0;
  const ship = Math.max(0, Number(o.shipping_fee) || 0);
  const tax = Math.max(0, Number(o.tax_extra_amount) || 0);
  return Math.max(0, total - ship - tax);
}

/** 同一個展跨年份的識別：優先用對應客戶來源，沒設定才用展名 */
function showKey(e: ExhibitionRow): string {
  return e.customer_source?.trim() || e.name.trim();
}

export function computeExhibitionEffects(
  exhibitions: ExhibitionRow[],
  costs: Pick<ExhibitionCostRow, "exhibition_id" | "amount">[],
  orders: EffectOrderInput[],
  customers: EffectCustomerInput[],
  purchases: Pick<ExhibitionPurchaseRow, "exhibition_id" | "amount_ex_tax" | "total_amount">[] = [],
): ExhibitionEffect[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const counted = orders.filter((o) => !EXCLUDED_STATUSES.has((o.status ?? "").trim()));

  const firstOrderDate = new Map<string, string>();
  for (const o of counted) {
    if (!o.customer_id || !o.order_date) continue;
    const prev = firstOrderDate.get(o.customer_id);
    if (!prev || o.order_date < prev) firstOrderDate.set(o.customer_id, o.order_date);
  }

  const otherCostByExhibition = new Map<string, number>();
  for (const c of costs) {
    otherCostByExhibition.set(c.exhibition_id, (otherCostByExhibition.get(c.exhibition_id) ?? 0) + (Number(c.amount) || 0));
  }
  const purchaseByExhibition = new Map<string, { cost: number; count: number }>();
  for (const p of purchases) {
    if (!p.exhibition_id) continue;
    const cur = purchaseByExhibition.get(p.exhibition_id) ?? { cost: 0, count: 0 };
    purchaseByExhibition.set(p.exhibition_id, { cost: cur.cost + purchaseCostAmount(p), count: cur.count + 1 });
  }

  const sorted = [...exhibitions].sort((a, b) => b.start_date.localeCompare(a.start_date));

  return sorted.map((e) => {
    const nextEdition = exhibitions
      .filter((x) => x.id !== e.id && showKey(x) === showKey(e) && x.start_date > e.start_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const windowEnd = nextEdition?.start_date ?? null;
    const source = e.customer_source?.trim() || null;

    const isWalkIn = (customerId: string | null) =>
      customerId != null &&
      customerById.get(customerId)?.customer_type === EXHIBITION_WALKIN_CUSTOMER_TYPE;

    const attributed = source
      ? counted.filter((o) => {
          if (!o.customer_id || !o.order_date) return false;
          if (customerById.get(o.customer_id)?.source?.trim() !== source) return false;
          return o.order_date >= e.start_date && (windowEnd == null || o.order_date < windowEnd);
        })
      : [];
    const isOnsite = (o: EffectOrderInput) => isWalkIn(o.customer_id) || o.order_date! <= e.end_date;
    const onsite = attributed.filter(isOnsite);
    const postShow = attributed.filter((o) => !isOnsite(o));

    const newCustomerIds = new Set<string>();
    for (const o of attributed) {
      if (!o.customer_id || isWalkIn(o.customer_id)) continue;
      const first = firstOrderDate.get(o.customer_id);
      if (first && first >= e.start_date) newCustomerIds.add(o.customer_id);
    }

    const onsiteRevenue = onsite.reduce((s, o) => s + orderNetRevenue(o), 0);
    const postShowRevenue = postShow.reduce((s, o) => s + orderNetRevenue(o), 0);
    const totalRevenue = onsiteRevenue + postShowRevenue;
    const totalOrders = onsite.length + postShow.length;
    const otherCost = otherCostByExhibition.get(e.id) ?? 0;
    const linked = purchaseByExhibition.get(e.id) ?? { cost: 0, count: 0 };
    const cost = linked.cost + otherCost;

    return {
      exhibition: e,
      windowEnd,
      onsiteOrders: onsite.length,
      onsiteWalkInOrders: onsite.filter((o) => isWalkIn(o.customer_id)).length,
      onsiteRevenue,
      postShowOrders: postShow.length,
      postShowCustomers: new Set(postShow.map((o) => o.customer_id)).size,
      postShowRevenue,
      totalRevenue,
      newCustomers: newCustomerIds.size,
      cost,
      purchaseCost: linked.cost,
      purchaseCount: linked.count,
      otherCost,
      revenuePerCost: cost > 0 ? totalRevenue / cost : null,
      costPerNewCustomer: cost > 0 && newCustomerIds.size > 0 ? cost / newCustomerIds.size : null,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : null,
    };
  });
}
