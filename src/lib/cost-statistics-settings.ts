const STORAGE_KEY = "fore-erp:cost-statistics-store";
const LEGACY_KEY = "fore-erp:cost-statistics-fixed-overhead";

/** 公司貸款預設年度支出：29695×12 + 7441×12 + 28037×6 */
export const DEFAULT_ANNUAL_COMPANY_LOAN = 29695 * 12 + 7441 * 12 + 28037 * 6;

export const DEFAULT_ANNUAL_RENT = 650_000;

export type CostStatisticsFixedOverhead = {
  annualRent: number;
  annualCompanyLoanInterest: number;
};

export type CostStatisticsYearFixedOverhead = CostStatisticsFixedOverhead & {
  updatedAt: string;
};

export type CostStatisticsMonthlySnapshotRow = {
  month: string;
  purchaseNonWood: number;
  purchaseWood: number;
  salaryCost: number;
  rentCost: number;
  loanCost: number;
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
  totalSalaryCost: number;
  totalRentCost: number;
  totalCompanyLoanCost: number;
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
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
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
