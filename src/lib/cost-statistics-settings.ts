import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { clampDeductibleRatio, DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO } from "@/lib/purchase-tax";

export { DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO };

const STORAGE_KEY = "fore-erp:cost-statistics-store";
const LEGACY_KEY = "fore-erp:cost-statistics-fixed-overhead";

/** app_settings 內年度固定開銷的 key 前綴（後接年度，如 cost_fixed_overhead_2026） */
const FIXED_OVERHEAD_SETTING_PREFIX = "cost_fixed_overhead_";

/** 公司貸款預設年度支出：29695×12 + 7441×12 + 28037×6 */
export const DEFAULT_ANNUAL_COMPANY_LOAN = 29695 * 12 + 7441 * 12 + 28037 * 6;

export const DEFAULT_ANNUAL_RENT = 650_000;

/** 營業稅率 5% */
export const REVENUE_TAX_RATE = 0.05;

/**
 * @deprecated 營業稅為代收代付，已不列為成本；營收改以未稅認列。
 * 僅保留供讀取舊版快照／CSV 還原之用。
 */
export function computeRevenueTax(revenue: number): number {
  const base = Number.isFinite(revenue) && revenue > 0 ? revenue : 0;
  return Math.round(base * REVENUE_TAX_RATE);
}

export type CostStatisticsFixedOverhead = {
  annualRent: number;
  annualCompanyLoanInterest: number;
  /** 進項稅可扣抵比例（0–1）；0 ＝視同全部扣抵不到，材料以含稅認列 */
  inputTaxDeductibleRatio: number;
};

export type CostStatisticsYearFixedOverhead = CostStatisticsFixedOverhead & {
  updatedAt: string;
};

export type CostStatisticsMonthlySnapshotRow = {
  month: string;
  purchaseNonWood: number;
  purchaseWood: number;
  /** 當月認列之攤提金額；舊快照無此欄位 */
  purchaseAmortized?: number;
  salaryCost: number;
  rentCost: number;
  loanCost: number;
  /** @deprecated 舊版快照才有；營業稅已不列成本 */
  taxCost?: number;
  totalCost: number;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
};

export type CostStatisticsYearSnapshot = {
  savedAt: string;
  preset: "this" | "last";
  ytdCutoffLabel: string;
  fixedOverhead: CostStatisticsFixedOverhead;
  totalPurchaseNonWood: number;
  totalPurchaseWood: number;
  /** 年初至今攤提認列總額；舊快照無此欄位 */
  totalPurchaseAmortized?: number;
  totalSalaryCost: number;
  totalRentCost: number;
  totalCompanyLoanCost: number;
  /** @deprecated 舊版快照才有；營業稅已不列成本 */
  totalTaxCost?: number;
  totalCost: number;
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number;
  monthlyRows: CostStatisticsMonthlySnapshotRow[];
};

type CostStatisticsStoreV2 = {
  v: 2;
  byYear: Record<string, CostStatisticsYearFixedOverhead>;
  snapshots: Record<string, CostStatisticsYearSnapshot>;
};

function parseNonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function defaultFixedOverhead(): CostStatisticsFixedOverhead {
  return {
    annualRent: DEFAULT_ANNUAL_RENT,
    annualCompanyLoanInterest: DEFAULT_ANNUAL_COMPANY_LOAN,
    inputTaxDeductibleRatio: DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO,
  };
}

function emptyStore(): CostStatisticsStoreV2 {
  return { v: 2, byYear: {}, snapshots: {} };
}

function readStore(): CostStatisticsStoreV2 {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CostStatisticsStoreV2>;
      if (parsed.v === 2 && parsed.byYear && typeof parsed.byYear === "object") {
        return {
          v: 2,
          byYear: parsed.byYear as Record<string, CostStatisticsYearFixedOverhead>,
          snapshots:
            parsed.snapshots && typeof parsed.snapshots === "object"
              ? (parsed.snapshots as Record<string, CostStatisticsYearSnapshot>)
              : {},
        };
      }
    }
    return migrateLegacyStore();
  } catch {
    return emptyStore();
  }
}

function migrateLegacyStore(): CostStatisticsStoreV2 {
  const store = emptyStore();
  if (typeof window === "undefined") return store;
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return store;
    const legacy = JSON.parse(legacyRaw) as Partial<CostStatisticsFixedOverhead>;
    const year = String(new Date().getFullYear());
    store.byYear[year] = {
      annualRent: parseNonNegative(legacy.annualRent, DEFAULT_ANNUAL_RENT),
      annualCompanyLoanInterest: parseNonNegative(
        legacy.annualCompanyLoanInterest,
        DEFAULT_ANNUAL_COMPANY_LOAN,
      ),
      inputTaxDeductibleRatio: clampDeductibleRatio(legacy.inputTaxDeductibleRatio),
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  return store;
}

function writeStore(store: CostStatisticsStoreV2): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadFixedOverheadForYear(year: number): CostStatisticsFixedOverhead {
  const store = readStore();
  const row = store.byYear[String(year)];
  if (!row) return defaultFixedOverhead();
  return {
    annualRent: parseNonNegative(row.annualRent, DEFAULT_ANNUAL_RENT),
    annualCompanyLoanInterest: parseNonNegative(
      row.annualCompanyLoanInterest,
      DEFAULT_ANNUAL_COMPANY_LOAN,
    ),
    inputTaxDeductibleRatio: clampDeductibleRatio(row.inputTaxDeductibleRatio),
  };
}

export function saveFixedOverheadForYear(
  year: number,
  settings: CostStatisticsFixedOverhead,
): void {
  const store = readStore();
  store.byYear[String(year)] = {
    annualRent: parseNonNegative(settings.annualRent, DEFAULT_ANNUAL_RENT),
    annualCompanyLoanInterest: parseNonNegative(
      settings.annualCompanyLoanInterest,
      DEFAULT_ANNUAL_COMPANY_LOAN,
    ),
    inputTaxDeductibleRatio: clampDeductibleRatio(settings.inputTaxDeductibleRatio),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

function fixedOverheadSettingKey(year: number): string {
  return `${FIXED_OVERHEAD_SETTING_PREFIX}${year}`;
}

function yearFromFixedOverheadSettingKey(key: string): number | null {
  if (!key.startsWith(FIXED_OVERHEAD_SETTING_PREFIX)) return null;
  const year = Number(key.slice(FIXED_OVERHEAD_SETTING_PREFIX.length));
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function parseFixedOverheadValue(value: unknown): CostStatisticsFixedOverhead | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Partial<CostStatisticsFixedOverhead>;
  return {
    annualRent: parseNonNegative(v.annualRent, DEFAULT_ANNUAL_RENT),
    annualCompanyLoanInterest: parseNonNegative(
      v.annualCompanyLoanInterest,
      DEFAULT_ANNUAL_COMPANY_LOAN,
    ),
    inputTaxDeductibleRatio: clampDeductibleRatio(v.inputTaxDeductibleRatio),
  };
}

/**
 * 自 app_settings 讀取年度固定開銷（各裝置共用）；查無或讀取失敗時退回本機快取／預設值。
 * 讀到時同步寫入本機快取，供同步讀取的頁面（成本占比、CSV 匯出）使用。
 */
export async function fetchFixedOverheadForYear(
  year: number,
): Promise<CostStatisticsFixedOverhead> {
  if (!isSupabaseConfigured) return loadFixedOverheadForYear(year);
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", fixedOverheadSettingKey(year))
    .maybeSingle();
  if (error) return loadFixedOverheadForYear(year);
  const parsed = parseFixedOverheadValue(data?.value);
  if (!parsed) return loadFixedOverheadForYear(year);
  saveFixedOverheadForYear(year, parsed);
  return parsed;
}

/** 自 app_settings 讀取所有年度固定開銷，並同步寫入本機快取 */
export async function fetchAllFixedOverheadRecords(): Promise<
  Array<{ year: number; settings: CostStatisticsFixedOverhead }>
> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .like("key", `${FIXED_OVERHEAD_SETTING_PREFIX}%`);
  if (error || !data) return [];
  const rows: Array<{ year: number; settings: CostStatisticsFixedOverhead }> = [];
  for (const row of data) {
    const year = yearFromFixedOverheadSettingKey(row.key);
    const settings = parseFixedOverheadValue(row.value);
    if (year == null || !settings) continue;
    saveFixedOverheadForYear(year, settings);
    rows.push({ year, settings });
  }
  return rows.sort((a, b) => b.year - a.year);
}

/** 寫入 app_settings（各裝置共用），並同步本機快取；回傳雲端寫入結果 */
export async function persistFixedOverheadForYear(
  year: number,
  settings: CostStatisticsFixedOverhead,
): Promise<{ error: string | null }> {
  const normalized: CostStatisticsFixedOverhead = {
    annualRent: parseNonNegative(settings.annualRent, DEFAULT_ANNUAL_RENT),
    annualCompanyLoanInterest: parseNonNegative(
      settings.annualCompanyLoanInterest,
      DEFAULT_ANNUAL_COMPANY_LOAN,
    ),
    inputTaxDeductibleRatio: clampDeductibleRatio(settings.inputTaxDeductibleRatio),
  };
  saveFixedOverheadForYear(year, normalized);
  if (!isSupabaseConfigured) return { error: "Supabase 尚未設定，僅存於此瀏覽器" };
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: fixedOverheadSettingKey(year),
      value: normalized,
      description: `成本統計 ${year} 年固定開銷（租金／公司貸款利息／進項稅可扣抵比例）`,
    },
    { onConflict: "key" },
  );
  return { error: error?.message ?? null };
}

export function listFixedOverheadYears(): number[] {
  const store = readStore();
  return Object.keys(store.byYear)
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a);
}

export function listRecordedSnapshotYears(): number[] {
  const store = readStore();
  return Object.keys(store.snapshots)
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a);
}

export function loadYearSnapshot(year: number): CostStatisticsYearSnapshot | null {
  const store = readStore();
  return store.snapshots[String(year)] ?? null;
}

export function saveYearSnapshot(year: number, snapshot: CostStatisticsYearSnapshot): void {
  const store = readStore();
  store.snapshots[String(year)] = snapshot;
  writeStore(store);
}

export function loadAllFixedOverheadRecords(): Array<{
  year: number;
  settings: CostStatisticsYearFixedOverhead;
}> {
  const store = readStore();
  return Object.entries(store.byYear)
    .map(([year, settings]) => ({ year: Number(year), settings }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => b.year - a.year);
}

export function loadAllYearSnapshots(): Array<{ year: number; snapshot: CostStatisticsYearSnapshot }> {
  const store = readStore();
  return Object.entries(store.snapshots)
    .map(([year, snapshot]) => ({ year: Number(year), snapshot }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => b.year - a.year);
}

/** @deprecated 使用 loadFixedOverheadForYear */
export function loadCostStatisticsFixedOverhead(): CostStatisticsFixedOverhead {
  return loadFixedOverheadForYear(new Date().getFullYear());
}

/** @deprecated 使用 saveFixedOverheadForYear */
export function saveCostStatisticsFixedOverhead(settings: CostStatisticsFixedOverhead): void {
  saveFixedOverheadForYear(new Date().getFullYear(), settings);
}
