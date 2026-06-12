import type { BonusWeights } from "@/lib/performance-bonus-compute";

export const PERFORMANCE_BONUS_EXPORT_KEY = "fore-erp:performance-bonus-export";

export type PerformanceBonusExportRow = {
  name: string;
  seniorityLabel: string;
  tenureRatioPct: string;
  performance: number;
  seniority: number;
  salary: number;
  shares: number;
  participatesInProfitSharing: boolean;
  performancePct: number;
  seniorityPct: number;
  salaryPct: number;
  totalPct: number;
  yearEndBonus: number;
  profitSharingBonus: number;
  shareBonus: number;
  totalBonus: number;
};

export type PerformanceBonusExportSnapshot = {
  savedAt: string;
  year: number;
  half: "H1" | "H2";
  halfLabel: string;
  profit: number;
  profitMeta: string;
  profitSharingPct: number;
  shareBonusPct: number;
  profitSharingPool: number;
  issueYearEndBonus?: boolean;
  /** 每半年年終＝月薪 ×（此 % ÷ 100）× 在職比例 */
  yearEndBonusSalaryPct?: number;
  yearEndBonusTotal: number;
  weightedProfitSharingPool: number;
  shareBonusPool: number;
  weights: BonusWeights;
  rows: PerformanceBonusExportRow[];
  totals: {
    performance: number;
    seniority: number;
    salary: number;
    shares: number;
    yearEndBonus: number;
    profitSharingBonus: number;
    shareBonus: number;
    totalBonus: number;
  };
};

/** localStorage 可跨分頁讀取（sessionStorage 無法供 window.open 新分頁使用） */
export function savePerformanceBonusExport(snapshot: PerformanceBonusExportSnapshot): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PERFORMANCE_BONUS_EXPORT_KEY, JSON.stringify(snapshot));
}

export function loadPerformanceBonusExport(): PerformanceBonusExportSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem(PERFORMANCE_BONUS_EXPORT_KEY) ??
      sessionStorage.getItem(PERFORMANCE_BONUS_EXPORT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PerformanceBonusExportSnapshot;
  } catch {
    return null;
  }
}

export function openPerformanceBonusPrintPage(): boolean {
  if (typeof window === "undefined") return false;
  const url = `/print/performance-bonus?t=${Date.now()}`;
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) return true;
  window.location.assign(url);
  return false;
}
