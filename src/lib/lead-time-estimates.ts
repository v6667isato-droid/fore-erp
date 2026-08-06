import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { normalizeWorkOrderStage, workOrderStageSortIndex } from "@/lib/work-order-stages";

/**
 * 訂單水位與交期預估。
 * 抽成純 lib：總覽頁（client）之外，之後官網 API／展覽模式也會重用。
 *
 * backlog 口徑（與使用者確認）：
 * - 第一層看訂單狀態：在「繪圖中～已完工之前」（只有確認生產才會到繪圖中），不看付款狀態
 * - 第二層看品項工站：工單全部到「塗裝後製程(組配、編織)」（含）以後即視為已完成，不計水位
 * - 金額按 order_items 明細（quantity × unit_price）依品類分別加總，運費不計
 * - 椅子＝品類 椅、凳（餐椅、板凳），但 CH04 搖椅歸「其他」（產線不同）
 * - 桌＝品類 桌（TB 系列）；架＝品類 層架／架（SF 系列）
 * - 分類不明一律歸「其他」（保守估計）
 * - 排除客戶「Føre」的訂單（自家庫存製作，非客戶交期）
 */

/** 已確認生產、尚未完工的訂單狀態（報價中之前、已完工之後皆不計入） */
export const LEAD_TIME_BACKLOG_STATUSES = [
  "繪圖中",
  "排程中",
  "繪製製作圖",
  "生產中",
  "暫停",
] as const;

/** 歸入「椅子」水位的品類（product_series.category / order_items.custom_category） */
export const CHAIR_CATEGORIES = ["椅", "凳"] as const;

/** 歸入「桌」水位的品類（TB 系列） */
export const TABLE_CATEGORIES = ["桌"] as const;

/** 歸入「架」水位的品類（SF 系列；客製品項有寫「層架」也有寫「架」） */
export const SHELF_CATEGORIES = ["層架", "架"] as const;

/** CH04 搖椅家族與椅凳產線不同，歸「其他」水位 */
export const CHAIR_EXCLUDED_SERIES_PREFIX = "CH04";

/** 品項工站達此站別（含）以後視為已完成，不計水位；「暫停」除外 */
export const LEAD_TIME_COMPLETED_STAGE = "塗裝後製程(組配、編織)";

/** 自家庫存製作的客戶名（Føre／FORE 等寫法都排除，ø 視同 O） */
export function isStockCustomerName(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toUpperCase().replace(/Ø/g, "O");
  return normalized === "FORE";
}

export const LEAD_TIME_SETTING_KEYS = {
  chairCapacityPerMonth: "lead_time_chair_capacity_per_month",
  chairBaseMonths: "lead_time_chair_base_months",
  tableCapacityPerMonth: "lead_time_table_capacity_per_month",
  tableBaseMonths: "lead_time_table_base_months",
  shelfCapacityPerMonth: "lead_time_shelf_capacity_per_month",
  shelfBaseMonths: "lead_time_shelf_base_months",
  otherCapacityPerMonth: "lead_time_other_capacity_per_month",
  otherBaseMonths: "lead_time_other_base_months",
} as const;

/** app_settings 缺列或讀取失敗時的後備值（與遷移種子一致） */
export const LEAD_TIME_DEFAULT_PARAMS: LeadTimeParams = {
  chairCapacityPerMonth: 500000,
  chairBaseMonths: 2,
  tableCapacityPerMonth: 400000,
  tableBaseMonths: 3,
  shelfCapacityPerMonth: 200000,
  shelfBaseMonths: 2,
  otherCapacityPerMonth: 900000,
  otherBaseMonths: 3,
};

export interface LeadTimeParams {
  chairCapacityPerMonth: number;
  chairBaseMonths: number;
  tableCapacityPerMonth: number;
  tableBaseMonths: number;
  shelfCapacityPerMonth: number;
  shelfBaseMonths: number;
  otherCapacityPerMonth: number;
  otherBaseMonths: number;
}

export interface LeadTimeCategoryEstimate {
  /** 未完工訂單明細金額合計（NT$） */
  backlogAmount: number;
  /** 產能門檻（NT$/月） */
  capacityPerMonth: number;
  /** 基準交期（月） */
  baseMonths: number;
  /** 原始交期 = max(基準交期, backlog ÷ 月產能)，debug 用 */
  rawMonths: number;
  /** 對外報價交期：無條件進位到 0.5 個月 */
  displayMonths: number;
}

export interface LeadTimeEstimates {
  chair: LeadTimeCategoryEstimate;
  table: LeadTimeCategoryEstimate;
  shelf: LeadTimeCategoryEstimate;
  other: LeadTimeCategoryEstimate;
}

export type LeadTimeCategoryKey = keyof LeadTimeEstimates;

/** 無條件進位到 0.5 個月（2.3 → 2.5、2.6 → 3.0） */
export function roundUpToHalfMonth(months: number): number {
  return Math.ceil(months * 2) / 2;
}

/** 交期（月）＝max(基準交期, backlog ÷ 月產能)；水位不足月產能時維持基準交期 */
export function computeLeadTimeMonths(
  backlogAmount: number,
  capacityPerMonth: number,
  baseMonths: number,
): number {
  if (!(capacityPerMonth > 0)) return baseMonths;
  return Math.max(baseMonths, backlogAmount / capacityPerMonth);
}

function buildEstimate(
  backlogAmount: number,
  capacityPerMonth: number,
  baseMonths: number,
): LeadTimeCategoryEstimate {
  const rawMonths = computeLeadTimeMonths(backlogAmount, capacityPerMonth, baseMonths);
  return {
    backlogAmount,
    capacityPerMonth,
    baseMonths,
    rawMonths,
    displayMonths: roundUpToHalfMonth(rawMonths),
  };
}

type SeriesRel =
  | { category: string | null; series_name: string | null }
  | { category: string | null; series_name: string | null }[]
  | null;

interface BacklogItemRow {
  quantity: number | null;
  unit_price: number | null;
  custom_category: string | null;
  product_variants:
    | { product_code: string | null; product_series: SeriesRel }
    | { product_code: string | null; product_series: SeriesRel }[]
    | null;
  work_orders: { stage: string | null }[] | { stage: string | null } | null;
}

function relSeries(rel: SeriesRel): { category: string | null; series_name: string | null } | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

/** 目錄品項看系列品類，客製品項看 custom_category；皆無 → null（歸「其他」） */
export function resolveItemCategory(item: BacklogItemRow): string | null {
  const pv = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants;
  const seriesCategory = pv ? (relSeries(pv.product_series)?.category ?? null) : null;
  if (seriesCategory && seriesCategory.trim() !== "") return seriesCategory.trim();
  const custom = (item.custom_category ?? "").trim();
  return custom !== "" ? custom : null;
}

export function isChairCategory(category: string | null): boolean {
  return category != null && (CHAIR_CATEGORIES as readonly string[]).includes(category);
}

/** CH04 搖椅家族（依品號或系列名前綴判斷） */
function isCh04Family(item: BacklogItemRow): boolean {
  const pv = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants;
  if (!pv) return false;
  const code = (pv.product_code ?? "").trim().toUpperCase();
  if (code.startsWith(CHAIR_EXCLUDED_SERIES_PREFIX)) return true;
  const seriesName = (relSeries(pv.product_series)?.series_name ?? "").trim().toUpperCase();
  return seriesName.startsWith(CHAIR_EXCLUDED_SERIES_PREFIX);
}

/** 椅子水位：品類 椅、凳，排除 CH04 搖椅 */
export function isChairBacklogItem(item: BacklogItemRow): boolean {
  return isChairCategory(resolveItemCategory(item)) && !isCh04Family(item);
}

/** 品項歸屬的水位分類：椅（排除 CH04）→ 桌 → 架 → 其他 */
export function resolveBacklogCategory(item: BacklogItemRow): LeadTimeCategoryKey {
  if (isChairBacklogItem(item)) return "chair";
  const category = resolveItemCategory(item);
  if (category != null) {
    if ((TABLE_CATEGORIES as readonly string[]).includes(category)) return "table";
    if ((SHELF_CATEGORIES as readonly string[]).includes(category)) return "shelf";
  }
  return "other";
}

/** 工站達「塗裝後製程(組配、編織)」（含）以後即算完成；「暫停」不算 */
function isCompletedStage(stageRaw: string | null): boolean {
  const stage = normalizeWorkOrderStage(stageRaw);
  if (stage === "暫停") return false;
  return workOrderStageSortIndex(stage) >= workOrderStageSortIndex(LEAD_TIME_COMPLETED_STAGE);
}

/**
 * 品項是否已完成（不計水位）：
 * 有工單、且全部工單的工站都達完成線。沒開工單的品項一律視為未完成。
 */
export function isItemProductionCompleted(item: BacklogItemRow): boolean {
  const rel = item.work_orders;
  const workOrders = rel == null ? [] : Array.isArray(rel) ? rel : [rel];
  if (workOrders.length === 0) return false;
  return workOrders.every((wo) => isCompletedStage(wo.stage));
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getLeadTimeParams(
  client: SupabaseClient<Database>,
): Promise<LeadTimeParams> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .in("key", Object.values(LEAD_TIME_SETTING_KEYS));
  if (error || !data) {
    console.error("[lead-time] 讀取 app_settings 失敗，改用預設參數", error);
    return { ...LEAD_TIME_DEFAULT_PARAMS };
  }
  const byKey = new Map(data.map((row) => [row.key, toFiniteNumber(row.value)]));
  const params = { ...LEAD_TIME_DEFAULT_PARAMS };
  for (const field of Object.keys(LEAD_TIME_SETTING_KEYS) as Array<keyof LeadTimeParams>) {
    const v = byKey.get(LEAD_TIME_SETTING_KEYS[field]);
    if (v != null && v > 0) params[field] = v;
  }
  return params;
}

/**
 * 查詢未完工訂單明細並計算各品類的 backlog 與預估交期。
 * backlog 為 0 或查無訂單時回傳基準交期，不會失敗。
 */
export async function getLeadTimeEstimates(
  client: SupabaseClient<Database>,
): Promise<LeadTimeEstimates> {
  const [params, backlogRes] = await Promise.all([
    getLeadTimeParams(client),
    client
      .from("orders")
      .select(
        `id,
         customers(name),
         order_items(
           quantity,
           unit_price,
           custom_category,
           product_variants(product_code, product_series(category, series_name)),
           work_orders(stage)
         )`,
      )
      .in("status", [...LEAD_TIME_BACKLOG_STATUSES])
      .is("deleted_at", null),
  ]);

  const backlog: Record<LeadTimeCategoryKey, number> = { chair: 0, table: 0, shelf: 0, other: 0 };
  if (backlogRes.error) {
    console.error("[lead-time] 查詢未完工訂單失敗，backlog 以 0 計", backlogRes.error);
  } else {
    for (const order of backlogRes.data ?? []) {
      const customerRel = order.customers as { name: string | null } | { name: string | null }[] | null;
      const customer = Array.isArray(customerRel) ? customerRel[0] : customerRel;
      if (isStockCustomerName(customer?.name)) continue;
      const items = (order.order_items ?? []) as BacklogItemRow[];
      for (const item of items) {
        const quantity = toFiniteNumber(item.quantity) ?? 0;
        const unitPrice = toFiniteNumber(item.unit_price) ?? 0;
        const amount = quantity * unitPrice;
        if (amount <= 0) continue;
        if (isItemProductionCompleted(item)) continue;
        backlog[resolveBacklogCategory(item)] += amount;
      }
    }
  }

  return {
    chair: buildEstimate(backlog.chair, params.chairCapacityPerMonth, params.chairBaseMonths),
    table: buildEstimate(backlog.table, params.tableCapacityPerMonth, params.tableBaseMonths),
    shelf: buildEstimate(backlog.shelf, params.shelfCapacityPerMonth, params.shelfBaseMonths),
    other: buildEstimate(backlog.other, params.otherCapacityPerMonth, params.otherBaseMonths),
  };
}
