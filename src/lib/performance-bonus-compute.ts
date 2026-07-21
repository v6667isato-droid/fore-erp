export type BonusWeights = {
  ability: number;
  performance: number;
  seniority: number;
  salary: number;
};

export type BonusEmployeeInput = {
  id: string;
  name: string;
  /** 能力分級 */
  ability: number;
  performance: number;
  seniority: number;
  salary: number;
  shares: number;
  participatesInProfitSharing: boolean;
  /** 該半年在職比例（0–1）；到職滿半年為 1 */
  halfYearTenureRatio: number;
};

export type BonusEmployeeComputed = BonusEmployeeInput & {
  abilityPct: number;
  performancePct: number;
  seniorityPct: number;
  salaryPct: number;
  totalPct: number;
  yearEndBonus: number;
  profitSharingBonus: number;
  shareBonus: number;
  totalBonus: number;
};

export type BonusComputationResult = {
  rows: BonusEmployeeComputed[];
  /** 分潤獎金池總額（含年終＋考績分潤） */
  grossProfitSharingPool: number;
  /** 年終獎金合計（自分潤獎金池扣除） */
  yearEndBonusTotal: number;
  /** 考績分潤池（分潤獎金池 − 年終獎金） */
  weightedProfitSharingPool: number;
  totals: {
    ability: number;
    performance: number;
    seniority: number;
    salary: number;
    shares: number;
    abilityPct: number;
    performancePct: number;
    seniorityPct: number;
    salaryPct: number;
    totalPct: number;
    yearEndBonus: number;
    profitSharingBonus: number;
    shareBonus: number;
    totalBonus: number;
  };
};

/** 預設每半年年終＝月薪 50%（等同 0.5 個月） */
export const DEFAULT_YEAR_END_BONUS_SALARY_PCT = 50;

export function defaultYearEndBonusSalaryPct(): number {
  return DEFAULT_YEAR_END_BONUS_SALARY_PCT;
}

const DEFAULT_WEIGHTS: BonusWeights = {
  ability: 1,
  performance: 3,
  seniority: 1,
  salary: 2,
};

export function defaultBonusWeights(): BonusWeights {
  return { ...DEFAULT_WEIGHTS };
}

function safeNum(v: number): number {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** 發放金額以「百」為最小單位（無條件捨去至百位） */
function floorToHundred(v: number): number {
  return Math.floor(safeNum(v) / 100) * 100;
}

function shareOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function weightedTotalPct(
  abilityPct: number,
  performancePct: number,
  seniorityPct: number,
  salaryPct: number,
  weights: BonusWeights,
): number {
  const wAbility = safeNum(weights.ability);
  const wPerf = safeNum(weights.performance);
  const wSen = safeNum(weights.seniority);
  const wSal = safeNum(weights.salary);
  const denom = wAbility + wPerf + wSen + wSal;
  if (denom <= 0) return 0;
  return (
    (abilityPct * wAbility + performancePct * wPerf + seniorityPct * wSen + salaryPct * wSal) /
    denom
  );
}

function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/** 到職日在該半年區間內的在職天數比例（0–1） */
export function halfYearTenureRatio(
  hireDate: string | null,
  year: number,
  half: "H1" | "H2",
): number {
  const periodStart = half === "H1" ? new Date(year, 0, 1) : new Date(year, 6, 1);
  const periodEnd = halfYearEndDate(year, half);

  if (!hireDate) return 0;
  const hire = new Date(hireDate.slice(0, 10));
  if (Number.isNaN(hire.getTime()) || hire > periodEnd) return 0;

  const effectiveStart = hire > periodStart ? hire : periodStart;
  const totalDays = dayIndex(periodEnd) - dayIndex(periodStart) + 1;
  if (totalDays <= 0) return 0;

  const workedDays = dayIndex(periodEnd) - dayIndex(effectiveStart) + 1;
  return Math.min(1, Math.max(0, workedDays / totalDays));
}

/** 半年年終獎金＝月薪 ×（% 月薪 ÷ 100）× 在職比例 */
export function computeHalfYearEndBonus(
  salary: number,
  tenureRatio: number,
  salaryPct = DEFAULT_YEAR_END_BONUS_SALARY_PCT,
): number {
  const pct = Math.max(0, safeNum(salaryPct));
  const ratio = Math.min(1, Math.max(0, tenureRatio));
  return Math.round((safeNum(salary) * pct * ratio) / 100);
}

/** 依比例分配獎金池，四捨五入後補差至最大小數餘數者（僅調整權重 > 0 的列） */
function distributePool(pool: number, weights: number[]): number[] {
  if (pool <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (pool * w) / weightSum);
  const rounded = raw.map((x) => Math.round(x));
  let diff = Math.round(pool) - rounded.reduce((a, b) => a + b, 0);

  if (diff !== 0) {
    const order = raw
      .map((x, i) => ({
        i,
        frac: x - Math.floor(x),
        eligible: (weights[i] ?? 0) > 0,
        amount: rounded[i] ?? 0,
      }))
      .filter((e) => e.eligible)
      .sort((a, b) => (diff > 0 ? b.frac - a.frac : a.frac - b.frac));

    for (let k = 0; k < order.length && diff !== 0; k++) {
      const { i, amount } = order[k]!;
      if (diff < 0 && amount <= 0) continue;
      rounded[i] = amount + (diff > 0 ? 1 : -1);
      diff += diff > 0 ? -1 : 1;
    }
  }

  return rounded.map((x) => Math.max(0, x));
}

export function computePerformanceBonus(
  employees: BonusEmployeeInput[],
  grossProfitSharingPool: number,
  shareBonusPool: number,
  weights: BonusWeights,
  issueYearEndBonus = false,
  yearEndBonusSalaryPct = DEFAULT_YEAR_END_BONUS_SALARY_PCT,
): BonusComputationResult {
  const pool = Math.max(0, grossProfitSharingPool);
  const profitEligible = employees.filter((e) => e.participatesInProfitSharing);

  const sumAbility = profitEligible.reduce((s, e) => s + safeNum(e.ability), 0);
  const sumPerformance = profitEligible.reduce((s, e) => s + safeNum(e.performance), 0);
  const sumSeniority = profitEligible.reduce((s, e) => s + safeNum(e.seniority), 0);
  const sumSalary = profitEligible.reduce((s, e) => s + safeNum(e.salary), 0);
  const sumShares = employees.reduce((s, e) => s + safeNum(e.shares), 0);

  const rawYearEnd = issueYearEndBonus
    ? employees.map((e) =>
        computeHalfYearEndBonus(e.salary, e.halfYearTenureRatio, yearEndBonusSalaryPct),
      )
    : employees.map(() => 0);
  const rawYearEndSum = rawYearEnd.reduce((a, b) => a + b, 0);

  let yearEndBonuses: number[];
  if (!issueYearEndBonus || rawYearEndSum <= 0) {
    yearEndBonuses = employees.map(() => 0);
  } else if (rawYearEndSum <= pool) {
    yearEndBonuses = rawYearEnd;
  } else {
    yearEndBonuses = distributePool(pool, rawYearEnd);
  }
  yearEndBonuses = yearEndBonuses.map(floorToHundred);

  const yearEndBonusTotal = yearEndBonuses.reduce((a, b) => a + b, 0);
  const weightedProfitSharingPool = Math.max(0, pool - yearEndBonusTotal);

  const withPct = employees.map((e) => {
    const inPool = e.participatesInProfitSharing;
    const abilityPct = inPool ? shareOf(safeNum(e.ability), sumAbility) : 0;
    const performancePct = inPool ? shareOf(safeNum(e.performance), sumPerformance) : 0;
    const seniorityPct = inPool ? shareOf(safeNum(e.seniority), sumSeniority) : 0;
    const salaryPct = inPool ? shareOf(safeNum(e.salary), sumSalary) : 0;
    const totalPct = inPool
      ? weightedTotalPct(abilityPct, performancePct, seniorityPct, salaryPct, weights)
      : 0;
    return { ...e, abilityPct, performancePct, seniorityPct, salaryPct, totalPct };
  });

  // 各項獎金以「百」為最小單位無條件捨去；捨去的尾數不再重分配
  const profitBonuses = distributePool(
    weightedProfitSharingPool,
    withPct.map((r) => r.totalPct),
  ).map(floorToHundred);
  const shareBonuses = distributePool(
    Math.max(0, shareBonusPool),
    withPct.map((r) => (sumShares > 0 ? safeNum(r.shares) : 0)),
  ).map(floorToHundred);

  const rows: BonusEmployeeComputed[] = withPct.map((r, i) => {
    const yearEndBonus = yearEndBonuses[i] ?? 0;
    const profitSharingBonus = profitBonuses[i] ?? 0;
    const shareBonus = shareBonuses[i] ?? 0;
    return {
      ...r,
      yearEndBonus,
      profitSharingBonus,
      shareBonus,
      totalBonus: yearEndBonus + profitSharingBonus + shareBonus,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      ability: acc.ability + safeNum(r.ability),
      performance: acc.performance + safeNum(r.performance),
      seniority: acc.seniority + safeNum(r.seniority),
      salary: acc.salary + safeNum(r.salary),
      shares: acc.shares + safeNum(r.shares),
      abilityPct: acc.abilityPct + r.abilityPct,
      performancePct: acc.performancePct + r.performancePct,
      seniorityPct: acc.seniorityPct + r.seniorityPct,
      salaryPct: acc.salaryPct + r.salaryPct,
      totalPct: acc.totalPct + r.totalPct,
      yearEndBonus: acc.yearEndBonus + r.yearEndBonus,
      profitSharingBonus: acc.profitSharingBonus + r.profitSharingBonus,
      shareBonus: acc.shareBonus + r.shareBonus,
      totalBonus: acc.totalBonus + r.totalBonus,
    }),
    {
      ability: 0,
      performance: 0,
      seniority: 0,
      salary: 0,
      shares: 0,
      abilityPct: 0,
      performancePct: 0,
      seniorityPct: 0,
      salaryPct: 0,
      totalPct: 0,
      yearEndBonus: 0,
      profitSharingBonus: 0,
      shareBonus: 0,
      totalBonus: 0,
    },
  );

  return {
    rows,
    grossProfitSharingPool: pool,
    yearEndBonusTotal,
    weightedProfitSharingPool,
    totals,
  };
}

export function halfYearEndDate(year: number, half: "H1" | "H2"): Date {
  if (half === "H1") return new Date(year, 5, 30);
  return new Date(year, 11, 31);
}

export function halfYearLabel(year: number, half: "H1" | "H2"): string {
  return half === "H1" ? `${year} 上半年（1–6 月）` : `${year} 下半年（7–12 月）`;
}

export function formatTenureRatioPct(ratio: number): string {
  return `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(1)}%`;
}
