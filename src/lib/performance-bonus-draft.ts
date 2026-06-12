import {
  defaultBonusWeights,
  defaultYearEndBonusSalaryPct,
  type BonusWeights,
} from "@/lib/performance-bonus-compute";

export const PERFORMANCE_BONUS_DRAFT_KEY = "fore-erp:performance-bonus-draft";

export type PerformanceBonusRowDraft = {
  performance: number;
  participatesInProfitSharing: boolean;
};

export type PerformanceBonusPeriodDraft = {
  overrides: Record<string, PerformanceBonusRowDraft>;
  weights: BonusWeights;
  profitSharingPct: string;
  shareBonusPct: string;
  profitManual: boolean;
  profitInput: string;
  /** 勾選時從分潤獎金池先扣年終獎金；未勾選則留至年終再發 */
  issueYearEndBonus: boolean;
  /** 每半年年終獎金＝月薪 ×（此 % ÷ 100）× 在職比例 */
  yearEndBonusSalaryPct: string;
};

type PerformanceBonusDraftStoreV1 = {
  v: 1;
  lastPeriod: { year: number; half: "H1" | "H2" };
  byPeriod: Record<string, PerformanceBonusPeriodDraft>;
};

export function performanceBonusPeriodKey(year: number, half: "H1" | "H2"): string {
  return `${year}-${half}`;
}

function defaultPeriod(): { year: number; half: "H1" | "H2" } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    half: now.getMonth() < 6 ? "H1" : "H2",
  };
}

export function defaultPerformanceBonusPeriodDraft(): PerformanceBonusPeriodDraft {
  return {
    overrides: {},
    weights: defaultBonusWeights(),
    profitSharingPct: "20",
    shareBonusPct: "30",
    profitManual: false,
    profitInput: "",
    issueYearEndBonus: false,
    yearEndBonusSalaryPct: String(defaultYearEndBonusSalaryPct()),
  };
}

function emptyStore(): PerformanceBonusDraftStoreV1 {
  return { v: 1, lastPeriod: defaultPeriod(), byPeriod: {} };
}

function readStore(): PerformanceBonusDraftStoreV1 {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(PERFORMANCE_BONUS_DRAFT_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<PerformanceBonusDraftStoreV1>;
    if (parsed.v !== 1 || !parsed.byPeriod || typeof parsed.byPeriod !== "object") {
      return emptyStore();
    }
    return {
      v: 1,
      lastPeriod:
        parsed.lastPeriod?.year != null && (parsed.lastPeriod.half === "H1" || parsed.lastPeriod.half === "H2")
          ? { year: Number(parsed.lastPeriod.year), half: parsed.lastPeriod.half }
          : defaultPeriod(),
      byPeriod: parsed.byPeriod as Record<string, PerformanceBonusPeriodDraft>,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: PerformanceBonusDraftStoreV1): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PERFORMANCE_BONUS_DRAFT_KEY, JSON.stringify(store));
}

export function loadPerformanceBonusLastPeriod(): { year: number; half: "H1" | "H2" } {
  return readStore().lastPeriod;
}

export function loadPerformanceBonusPeriodDraft(
  year: number,
  half: "H1" | "H2",
): PerformanceBonusPeriodDraft | null {
  const key = performanceBonusPeriodKey(year, half);
  const draft = readStore().byPeriod[key];
  if (!draft) return null;
  return normalizePeriodDraft(draft);
}

function normalizePeriodDraft(draft: PerformanceBonusPeriodDraft): PerformanceBonusPeriodDraft {
  const overrides: Record<string, PerformanceBonusRowDraft> = {};
  for (const [id, row] of Object.entries(draft.overrides ?? {})) {
    if (!row || typeof row !== "object") continue;
    overrides[id] = {
      performance: Number.isFinite(Number(row.performance)) ? Math.max(0, Number(row.performance)) : 5,
      participatesInProfitSharing: row.participatesInProfitSharing !== false,
    };
  }
  const weights = draft.weights ?? defaultBonusWeights();
  return {
    overrides,
    weights: {
      performance: Math.max(0, Number(weights.performance) || 0),
      seniority: Math.max(0, Number(weights.seniority) || 0),
      salary: Math.max(0, Number(weights.salary) || 0),
    },
    profitSharingPct:
      draft.profitSharingPct != null && String(draft.profitSharingPct).trim() !== ""
        ? String(draft.profitSharingPct)
        : "20",
    shareBonusPct:
      draft.shareBonusPct != null && String(draft.shareBonusPct).trim() !== ""
        ? String(draft.shareBonusPct)
        : "30",
    profitManual: Boolean(draft.profitManual),
    profitInput: draft.profitInput != null ? String(draft.profitInput) : "",
    issueYearEndBonus: draft.issueYearEndBonus === true,
    yearEndBonusSalaryPct:
      draft.yearEndBonusSalaryPct != null && String(draft.yearEndBonusSalaryPct).trim() !== ""
        ? String(draft.yearEndBonusSalaryPct)
        : String(defaultYearEndBonusSalaryPct()),
  };
}

export function savePerformanceBonusPeriodDraft(
  year: number,
  half: "H1" | "H2",
  draft: PerformanceBonusPeriodDraft,
): void {
  const store = readStore();
  const key = performanceBonusPeriodKey(year, half);
  store.lastPeriod = { year, half };
  store.byPeriod[key] = normalizePeriodDraft(draft);
  writeStore(store);
}

/** 合併已存考績與新進員工預設值 */
export function mergePerformanceBonusOverrides(
  saved: Record<string, PerformanceBonusRowDraft>,
  employeeIds: string[],
): Record<string, PerformanceBonusRowDraft> {
  const next = { ...saved };
  for (const id of employeeIds) {
    if (!next[id]) {
      next[id] = { performance: 5, participatesInProfitSharing: true };
    }
  }
  return next;
}

export function applyPerformanceBonusPeriodDraft(
  draft: PerformanceBonusPeriodDraft,
): PerformanceBonusPeriodDraft {
  return normalizePeriodDraft(draft);
}
