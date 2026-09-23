/**
 * 展覽效益：場次標籤、開單自動帶入場次、效益統計（純函式，開單表單與統計頁共用）。
 *
 * - 現場成交：orders.exhibition_id 為該場次的訂單。
 * - 展後轉單：未標記場次、客戶來源（customers.source）等於該場次 customer_source、
 *   下單日落在本屆開始～下一屆同展開始前的訂單。
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
  /** 對應的客戶來源值（如「展覽(木質生活)」）；null＝不推算展後轉單 */
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

/** 散客代表客戶在展期結束後幾天內補登的訂單，仍自動帶入該場次 */
const WALKIN_BACKFILL_DAYS = 14;

/** 效益統計排除的訂單狀態（與銷售統計一致排除報價；退貨不計營收） */
const EXCLUDED_STATUSES = new Set(["報價中", "已退貨"]);

export function exhibitionLabel(e: Pick<ExhibitionRow, "name" | "start_date">): string {
  return `${e.start_date.slice(0, 4)} ${e.name}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 開單自動帶入的場次：
 * - 客戶來源是某展、下單日落在該展展期內 → 該場次
 * - 散客代表客戶（客戶種類「展覽」）：展期內或展後 14 天內補登 → 該場次
 * 其餘回傳 null（不帶入）。
 */
export function suggestExhibitionId(
  exhibitions: ExhibitionRow[],
  customer: { source?: string | null; customer_type?: string | null } | null | undefined,
  orderDate: string,
): string | null {
  const source = customer?.source?.trim();
  if (!source || !orderDate) return null;
  const graceDays =
    customer?.customer_type === EXHIBITION_WALKIN_CUSTOMER_TYPE ? WALKIN_BACKFILL_DAYS : 0;
  const hit = exhibitions
    .filter(
      (e) =>
        e.customer_source === source &&
        e.start_date <= orderDate &&
        orderDate <= addDays(e.end_date, graceDays),
    )
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  return hit?.id ?? null;
}

/** 開單下拉只列下單日前後一年內的場次（新到舊），並保留目前已選的場次 */
export function exhibitionOptionsFor(
  exhibitions: ExhibitionRow[],
  orderDate: string,
  selectedId: string,
): ExhibitionRow[] {
  const from = orderDate ? addDays(orderDate, -366) : "";
  const to = orderDate ? addDays(orderDate, 366) : "9999-12-31";
  return exhibitions
    .filter(
      (e) => e.id === selectedId || (e.end_date >= from && e.start_date <= to),
    )
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export interface EffectOrderInput {
  id: string;
  order_date: string | null;
  customer_id: string | null;
  exhibition_id: string | null;
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
  /** 展後轉單統計到此日前（不含）＝下一屆同展開始日；null＝統計至今 */
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
  cost: number;
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
): ExhibitionEffect[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const counted = orders.filter((o) => !EXCLUDED_STATUSES.has((o.status ?? "").trim()));

  const firstOrderDate = new Map<string, string>();
  for (const o of counted) {
    if (!o.customer_id || !o.order_date) continue;
    const prev = firstOrderDate.get(o.customer_id);
    if (!prev || o.order_date < prev) firstOrderDate.set(o.customer_id, o.order_date);
  }

  const costByExhibition = new Map<string, number>();
  for (const c of costs) {
    costByExhibition.set(c.exhibition_id, (costByExhibition.get(c.exhibition_id) ?? 0) + (Number(c.amount) || 0));
  }

  const sorted = [...exhibitions].sort((a, b) => b.start_date.localeCompare(a.start_date));

  return sorted.map((e) => {
    const nextEdition = exhibitions
      .filter((x) => x.id !== e.id && showKey(x) === showKey(e) && x.start_date > e.start_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const windowEnd = nextEdition?.start_date ?? null;
    const source = e.customer_source?.trim() || null;

    const onsite = counted.filter((o) => o.exhibition_id === e.id);
    const postShow = source
      ? counted.filter((o) => {
          if (o.exhibition_id || !o.customer_id || !o.order_date) return false;
          if (customerById.get(o.customer_id)?.source?.trim() !== source) return false;
          return o.order_date >= e.start_date && (windowEnd == null || o.order_date < windowEnd);
        })
      : [];

    const isWalkIn = (customerId: string | null) =>
      customerId != null &&
      customerById.get(customerId)?.customer_type === EXHIBITION_WALKIN_CUSTOMER_TYPE;

    const newCustomerIds = new Set<string>();
    for (const o of [...onsite, ...postShow]) {
      if (!o.customer_id || isWalkIn(o.customer_id)) continue;
      const first = firstOrderDate.get(o.customer_id);
      if (first && first >= e.start_date) newCustomerIds.add(o.customer_id);
    }

    const onsiteRevenue = onsite.reduce((s, o) => s + orderNetRevenue(o), 0);
    const postShowRevenue = postShow.reduce((s, o) => s + orderNetRevenue(o), 0);
    const totalRevenue = onsiteRevenue + postShowRevenue;
    const totalOrders = onsite.length + postShow.length;
    const cost = costByExhibition.get(e.id) ?? 0;

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
      revenuePerCost: cost > 0 ? totalRevenue / cost : null,
      costPerNewCustomer: cost > 0 && newCustomerIds.size > 0 ? cost / newCustomerIds.size : null,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : null,
    };
  });
}
