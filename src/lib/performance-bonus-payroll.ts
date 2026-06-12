import { seniorityFromHire } from "@/lib/employee-seniority";
import { fetchHalfYearGrossProfit } from "@/lib/half-year-gross-profit";
import {
  computePerformanceBonus,
  halfYearEndDate,
  halfYearLabel,
  halfYearTenureRatio,
  type BonusEmployeeInput,
} from "@/lib/performance-bonus-compute";
import {
  loadPerformanceBonusLastPeriod,
  loadPerformanceBonusPeriodDraft,
  mergePerformanceBonusOverrides,
} from "@/lib/performance-bonus-draft";

export type PayrollBonusEmployee = {
  id: string;
  name: string;
  monthly_wage: number;
  hire_date: string | null;
  share_count: number;
  unpaid_leave_months: string[];
};

export type SemiAnnualBonusDetail = {
  yearEnd: number;
  profitSharing: number;
  share: number;
  total: number;
};

export type SemiAnnualBonusImportResult = {
  period: { year: number; half: "H1" | "H2"; label: string };
  bonusesByEmployeeId: Record<string, number>;
  detailByEmployeeId: Record<string, SemiAnnualBonusDetail>;
  profitMeta?: string;
  usedFallbackPeriod: boolean;
};

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function parseNum(s: string, fallback: number): number {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** 依發薪月份建議對應半年期別：7–8 月 → 當年上半年；1–2 月 → 上一年下半年 */
export function suggestBonusPeriodForPayMonth(
  ym: string,
): { year: number; half: "H1" | "H2"; label: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  if (p.m >= 7 && p.m <= 8) {
    return { year: p.y, half: "H1", label: halfYearLabel(p.y, "H1") };
  }
  if (p.m >= 1 && p.m <= 2) {
    return { year: p.y - 1, half: "H2", label: halfYearLabel(p.y - 1, "H2") };
  }
  return null;
}

export function formatSemiAnnualBonusPayrollNote(
  periodLabel: string,
  detail: SemiAnnualBonusDetail,
): string {
  const parts: string[] = [];
  if (detail.yearEnd > 0) {
    parts.push(`年終 NT$ ${detail.yearEnd.toLocaleString("zh-TW")}`);
  }
  if (detail.profitSharing > 0) {
    parts.push(`考績分潤 NT$ ${detail.profitSharing.toLocaleString("zh-TW")}`);
  }
  if (detail.share > 0) {
    parts.push(`股份 NT$ ${detail.share.toLocaleString("zh-TW")}`);
  }
  const breakdown = parts.length > 0 ? `${parts.join("、")}，` : "";
  return `【${periodLabel}獎金】${breakdown}合計 NT$ ${detail.total.toLocaleString("zh-TW")}`;
}

export async function computeSemiAnnualBonusesForPayroll(
  payPeriodYm: string,
  employees: PayrollBonusEmployee[],
  options?: { year?: number; half?: "H1" | "H2" },
): Promise<SemiAnnualBonusImportResult | { error: string }> {
  let usedFallbackPeriod = false;
  let period =
    options?.year != null && (options.half === "H1" || options.half === "H2")
      ? {
          year: options.year,
          half: options.half,
          label: halfYearLabel(options.year, options.half),
        }
      : suggestBonusPeriodForPayMonth(payPeriodYm);

  if (!period) {
    const last = loadPerformanceBonusLastPeriod();
    period = {
      year: last.year,
      half: last.half,
      label: halfYearLabel(last.year, last.half),
    };
    usedFallbackPeriod = true;
  }

  const draft = loadPerformanceBonusPeriodDraft(period.year, period.half);
  if (!draft) {
    return {
      error: `尚無「${period.label}」考績獎金草稿，請先至「考績獎金」分頁設定考績與分潤比例。`,
    };
  }

  let profit: number;
  let profitMeta: string | undefined;
  if (draft.profitManual) {
    profit = Math.max(0, parseNum(draft.profitInput, 0));
  } else {
    try {
      const result = await fetchHalfYearGrossProfit(period.year, period.half);
      profit = Math.max(0, result.grossProfit);
      profitMeta = `毛利 NT$ ${Math.round(result.grossProfit).toLocaleString("zh-TW")}（統計至 ${result.cutoffLabel}）`;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "半年毛利載入失敗" };
    }
  }

  const profitSharingPct = Math.max(0, parseNum(draft.profitSharingPct, 0));
  const shareBonusPct = Math.max(0, parseNum(draft.shareBonusPct, 0));
  const profitSharingPool = Math.round((profit * profitSharingPct) / 100);
  const shareBonusPool = Math.round((profit * shareBonusPct) / 100);

  const overrides = mergePerformanceBonusOverrides(
    draft.overrides,
    employees.map((e) => e.id),
  );
  const asOf = halfYearEndDate(period.year, period.half);

  const bonusInputs: BonusEmployeeInput[] = employees.map((emp) => {
    const ov = overrides[emp.id] ?? {
      performance: 5,
      participatesInProfitSharing: true,
    };
    const seniority = seniorityFromHire(
      emp.hire_date,
      asOf,
      emp.unpaid_leave_months,
    ).decimalYears;
    return {
      id: emp.id,
      name: emp.name,
      performance: ov.performance,
      seniority,
      salary: emp.monthly_wage,
      shares: emp.share_count,
      participatesInProfitSharing: ov.participatesInProfitSharing,
      halfYearTenureRatio: halfYearTenureRatio(emp.hire_date, period!.year, period!.half),
    };
  });

  const yearEndBonusSalaryPct = Math.max(0, parseNum(draft.yearEndBonusSalaryPct, 50));

  const computed = computePerformanceBonus(
    bonusInputs,
    profitSharingPool,
    shareBonusPool,
    draft.weights,
    draft.issueYearEndBonus,
    yearEndBonusSalaryPct,
  );

  const bonusesByEmployeeId: Record<string, number> = {};
  const detailByEmployeeId: Record<string, SemiAnnualBonusDetail> = {};
  for (const row of computed.rows) {
    bonusesByEmployeeId[row.id] = row.totalBonus;
    detailByEmployeeId[row.id] = {
      yearEnd: row.yearEndBonus,
      profitSharing: row.profitSharingBonus,
      share: row.shareBonus,
      total: row.totalBonus,
    };
  }

  return {
    period,
    bonusesByEmployeeId,
    detailByEmployeeId,
    profitMeta,
    usedFallbackPeriod,
  };
}
