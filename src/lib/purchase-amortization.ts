import { roundMoney2 } from "@/lib/purchase-tax";

/** 成本統計查詢時，向前追溯採購紀錄的年數上限 */
export const MAX_AMORTIZATION_MONTHS = 60;

export const PURCHASE_AMORTIZATION_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "不攤提（當月認列）" },
  { value: 6, label: "6 個月" },
  { value: 12, label: "12 個月" },
  { value: 24, label: "24 個月" },
  { value: 36, label: "36 個月" },
  { value: 48, label: "48 個月" },
  { value: 60, label: "60 個月" },
];

export function normalizeAmortizationMonths(value: number | null | undefined): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_AMORTIZATION_MONTHS);
}

export function formatAmortizationLabel(months: number | null | undefined): string {
  const m = normalizeAmortizationMonths(months);
  if (m <= 1) return "—";
  return `${m} 個月`;
}

/** 木料類大量採購預設建議 12 個月攤提 */
export function defaultAmortizationMonthsForCategory(category: string | null | undefined): number {
  const c = (category ?? "").trim();
  if (c.startsWith("木料")) return 12;
  return 1;
}

/** 依物料主檔欄位（或類別）決定採購時預設攤提月數 */
export function resolveDefaultAmortizationMonths(
  material: { amortization_months?: number | null; item_category?: string | null } | null | undefined,
): number {
  if (material == null) return 1;
  if (material.amortization_months != null && Number.isFinite(Number(material.amortization_months))) {
    return normalizeAmortizationMonths(material.amortization_months);
  }
  return defaultAmortizationMonthsForCategory(material.item_category);
}

export function purchaseCostLookbackStartYear(statYear: number): number {
  return statYear - Math.ceil(MAX_AMORTIZATION_MONTHS / 12);
}

function addMonthsToYm(ym: string, offset: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type PurchaseAmortizationInput = {
  purchase_date: string;
  item_category?: string | null;
  tax_included_amount?: number | null;
  amount_ex_tax?: number | null;
  amortization_months?: number | null;
};

export type PurchaseCostSpread = {
  monthKey: string;
  amount: number;
  isWood: boolean;
  /** 該筆採購設有攤提（>1 個月），此份額屬攤提認列 */
  isAmortized: boolean;
};

export type SpreadPurchaseCostOptions = {
  /** 採購必須不晚於此月（通常為 YTD 截止月） */
  cutoffYm: string;
  statYear: number;
  /** 攤提認列上限月；預設同 cutoffYm。設為年底可計算 Q3/Q4 預估攤提 */
  throughYm?: string;
};

/**
 * 將一筆採購成本依攤提月數拆成各月金額（僅回傳落在 statYear 且 ≤ throughYm 的月份）。
 */
export function spreadPurchaseCostByMonth(
  row: PurchaseAmortizationInput,
  opts: SpreadPurchaseCostOptions,
): PurchaseCostSpread[] {
  const purchaseDate = (row.purchase_date ?? "").slice(0, 10);
  if (!purchaseDate) return [];

  const startYm = purchaseDate.slice(0, 7);
  if (startYm > opts.cutoffYm) return [];

  const throughYm = opts.throughYm ?? opts.cutoffYm;

  const total = Number(row.tax_included_amount ?? row.amount_ex_tax ?? 0);
  if (!Number.isFinite(total) || total === 0) return [];

  const months = normalizeAmortizationMonths(row.amortization_months);
  const yearPrefix = `${opts.statYear}-`;
  const isWood = (row.item_category ?? "").trim().startsWith("木料");

  if (months <= 1) {
    if (startYm.startsWith(yearPrefix) && startYm <= throughYm) {
      return [{ monthKey: startYm, amount: total, isWood, isAmortized: false }];
    }
    return [];
  }

  const base = roundMoney2(total / months);
  let allocated = 0;
  const results: PurchaseCostSpread[] = [];

  for (let i = 0; i < months; i++) {
    const ym = addMonthsToYm(startYm, i);
    const amount = i === months - 1 ? roundMoney2(total - allocated) : base;
    allocated += amount;
    if (!ym.startsWith(yearPrefix)) continue;
    if (ym > throughYm) continue;
    results.push({ monthKey: ym, amount, isWood, isAmortized: true });
  }

  return results;
}
