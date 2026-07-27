import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * 訂單水位與交期預估。
 * 抽成純 lib：總覽頁（client）之外，之後官網 API／展覽模式也會重用。
 *
 * backlog 口徑（與使用者確認）：
 * - 訂單狀態在「繪圖中～已完工之前」（只有確認生產才會到繪圖中），不看付款狀態
 * - 金額按 order_items 明細（quantity × unit_price）依品類分別加總，運費不計
 * - 椅子＝品類 椅、凳（餐椅、板凳），但 CH04 搖椅歸「其他」（產線不同）
 * - 分類不明一律歸「其他」（保守估計）
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

/** CH04 搖椅家族與椅凳產線不同，歸「其他」水位 */
export const CHAIR_EXCLUDED_SERIES_PREFIX = "CH04";

export const LEAD_TIME_SETTING_KEYS = {
  chairCapacityPerMonth: "lead_time_chair_capacity_per_month",
  chairBaseMonths: "lead_time_chair_base_months",
  otherCapacityPerMonth: "lead_time_other_capacity_per_month",
  otherBaseMonths: "lead_time_other_base_months",
} as const;

/** app_settings 缺列或讀取失敗時的後備值（與遷移種子一致） */
export const LEAD_TIME_DEFAULT_PARAMS: LeadTimeParams = {
  chairCapacityPerMonth: 500000,
  chairBaseMonths: 2,
  otherCapacityPerMonth: 900000,
  otherBaseMonths: 3,
};

export interface LeadTimeParams {
  chairCapacityPerMonth: number;
  chairBaseMonths: number;
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
  /** 原始交期 = base × max(1, backlog ÷ capacity)，debug 用 */
  rawMonths: number;
  /** 對外報價交期：無條件進位到 0.5 個月 */
  displayMonths: number;
}

export interface LeadTimeEstimates {
  chair: LeadTimeCategoryEstimate;
  other: LeadTimeCategoryEstimate;
}

/** 無條件進位到 0.5 個月（2.3 → 2.5、2.6 → 3.0） */
export function roundUpToHalfMonth(months: number): number {
  return Math.ceil(months * 2) / 2;
}

export function computeLeadTimeMonths(
  backlogAmount: number,
  capacityPerMonth: number,
  baseMonths: number,
): number {
  if (!(capacityPerMonth > 0)) return baseMonths;
  return baseMonths * Math.max(1, backlogAmount / capacityPerMonth);
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
  const pick = (key: string, fallback: number): number => {
    const v = byKey.get(key);
    return v != null && v > 0 ? v : fallback;
  };
  return {
    chairCapacityPerMonth: pick(
      LEAD_TIME_SETTING_KEYS.chairCapacityPerMonth,
      LEAD_TIME_DEFAULT_PARAMS.chairCapacityPerMonth,
    ),
    chairBaseMonths: pick(
      LEAD_TIME_SETTING_KEYS.chairBaseMonths,
      LEAD_TIME_DEFAULT_PARAMS.chairBaseMonths,
    ),
    otherCapacityPerMonth: pick(
      LEAD_TIME_SETTING_KEYS.otherCapacityPerMonth,
      LEAD_TIME_DEFAULT_PARAMS.otherCapacityPerMonth,
    ),
    otherBaseMonths: pick(
      LEAD_TIME_SETTING_KEYS.otherBaseMonths,
      LEAD_TIME_DEFAULT_PARAMS.otherBaseMonths,
    ),
  };
}

/**
 * 查詢未完工訂單明細並計算兩品類的 backlog 與預估交期。
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
         order_items(
           quantity,
           unit_price,
           custom_category,
           product_variants(product_code, product_series(category, series_name))
         )`,
      )
      .in("status", [...LEAD_TIME_BACKLOG_STATUSES])
      .is("deleted_at", null),
  ]);

  let chairBacklog = 0;
  let otherBacklog = 0;
  if (backlogRes.error) {
    console.error("[lead-time] 查詢未完工訂單失敗，backlog 以 0 計", backlogRes.error);
  } else {
    for (const order of backlogRes.data ?? []) {
      const items = (order.order_items ?? []) as BacklogItemRow[];
      for (const item of items) {
        const quantity = toFiniteNumber(item.quantity) ?? 0;
        const unitPrice = toFiniteNumber(item.unit_price) ?? 0;
        const amount = quantity * unitPrice;
        if (amount <= 0) continue;
        if (isChairBacklogItem(item)) chairBacklog += amount;
        else otherBacklog += amount;
      }
    }
  }

  return {
    chair: buildEstimate(chairBacklog, params.chairCapacityPerMonth, params.chairBaseMonths),
    other: buildEstimate(otherBacklog, params.otherCapacityPerMonth, params.otherBaseMonths),
  };
}
