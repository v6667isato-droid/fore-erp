export type SeniorityParts = {
  years: number;
  months: number;
  /** 用於獎金加權計算（年 + 月/12） */
  decimalYears: number;
  label: string;
};

const YM_RE = /^(\d{4})-(\d{2})$/;

function isValidYearMonth(ym: string): boolean {
  const match = YM_RE.exec(ym.trim());
  if (!match) return false;
  const mo = Number(match[2]);
  return mo >= 1 && mo <= 12;
}

function totalMonthsFromHire(start: Date, asOf: Date): number {
  let years = asOf.getFullYear() - start.getFullYear();
  let months = asOf.getMonth() - start.getMonth();
  const dayDiff = asOf.getDate() - start.getDate();

  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  years = Math.max(0, years);
  months = Math.max(0, months);
  return years * 12 + months;
}

function deductibleUnpaidMonthCount(
  hireDate: string,
  asOf: Date,
  unpaidLeaveMonths: string[] | null | undefined,
): number {
  if (!unpaidLeaveMonths?.length) return 0;

  const startYm = hireDate.slice(0, 7);
  const endYm = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
  const seen = new Set<string>();
  let count = 0;

  for (const raw of unpaidLeaveMonths) {
    const ym = raw.trim();
    if (!isValidYearMonth(ym)) continue;
    if (ym < startYm || ym > endYm) continue;
    if (seen.has(ym)) continue;
    seen.add(ym);
    count += 1;
  }

  return count;
}

function partsFromTotalMonths(totalMonths: number): SeniorityParts {
  const clamped = Math.max(0, totalMonths);
  const years = Math.floor(clamped / 12);
  const months = clamped % 12;
  return {
    years,
    months,
    decimalYears: years + months / 12,
    label: `${years}年${months}月`,
  };
}

/** 到職日至基準日之年資（?年?月）；若有留職停薪月份則逐月扣除 */
export function seniorityFromHire(
  hireDate: string | null,
  asOf: Date = new Date(),
  unpaidLeaveMonths?: string[] | null,
): SeniorityParts {
  if (!hireDate) {
    return { years: 0, months: 0, decimalYears: 0, label: "—" };
  }

  const start = new Date(hireDate.slice(0, 10));
  if (Number.isNaN(start.getTime())) {
    return { years: 0, months: 0, decimalYears: 0, label: "—" };
  }

  if (start > asOf) {
    return { years: 0, months: 0, decimalYears: 0, label: "0年0月" };
  }

  let totalMonths = totalMonthsFromHire(start, asOf);
  totalMonths -= deductibleUnpaidMonthCount(
    hireDate,
    asOf,
    unpaidLeaveMonths,
  );

  return partsFromTotalMonths(totalMonths);
}
