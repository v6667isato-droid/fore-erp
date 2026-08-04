"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { fetchHalfYearGrossProfit } from "@/lib/half-year-gross-profit";
import { seniorityFromHire } from "@/lib/employee-seniority";
import {
  loadPerformanceBonusLastPeriod,
  loadPerformanceBonusPeriodDraft,
  mergePerformanceBonusOverrides,
  savePerformanceBonusPeriodDraft,
  type PerformanceBonusRowDraft,
} from "@/lib/performance-bonus-draft";
import {
  openPerformanceBonusPrintPage,
  savePerformanceBonusExport,
  type PerformanceBonusExportSnapshot,
} from "@/lib/performance-bonus-export";
import { PerformanceBonusHistory } from "@/components/performance-bonus-history";
import {
  computePerformanceBonus,
  defaultBonusWeights,
  formatTenureRatioPct,
  halfYearEndDate,
  halfYearLabel,
  halfYearTenureRatio,
  type BonusEmployeeInput,
  type BonusWeights,
} from "@/lib/performance-bonus-compute";

type HalfYear = "H1" | "H2";

type EmployeeRow = {
  id: string;
  name: string;
  hire_date: string | null;
  monthly_wage: number;
  share_count: number;
  employment_status: string | null;
  unpaid_leave_months: string[];
};

type RowOverrides = PerformanceBonusRowDraft;

function defaultPeriod(): { year: number; half: HalfYear } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    half: now.getMonth() < 6 ? "H1" : "H2",
  };
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function parseNum(raw: string, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isActiveEmployee(status: string | null): boolean {
  return status === "在職" || status === "true" || status === "1";
}

function mapEmployeeRow(r: Record<string, unknown>): EmployeeRow {
  const rawStatus = r.employment_status;
  let status: string | null = null;
  if (typeof rawStatus === "boolean") status = rawStatus ? "在職" : "離職";
  else if (rawStatus != null) status = String(rawStatus);

  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? "—"),
    hire_date: r.hire_date != null ? String(r.hire_date) : null,
    monthly_wage:
      r.monthly_wage != null && Number.isFinite(Number(r.monthly_wage))
        ? Number(r.monthly_wage)
        : 0,
    share_count:
      r.share_count != null && Number.isFinite(Number(r.share_count))
        ? Number(r.share_count)
        : 0,
    employment_status: status,
    unpaid_leave_months: Array.isArray(r.unpaid_leave_months)
      ? (r.unpaid_leave_months as unknown[]).map(String)
      : [],
  };
}

const inputClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

const selectClass = cn(inputClass, "text-left");

const inputClassSm =
  "h-7 w-11 rounded-md border border-input bg-background px-1 text-center text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 表格內能力分級／考績輸入：與表頭加權輸入同寬（w-11），避免撐寬欄位 */
const inputClassNarrow =
  "h-9 w-11 rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium leading-none text-muted-foreground">{children}</span>
  );
}

export function PerformanceBonusPage() {
  const fallbackPeriod = defaultPeriod();
  const [year, setYear] = useState(fallbackPeriod.year);
  const [half, setHalf] = useState<HalfYear>(fallbackPeriod.half);
  const [draftReady, setDraftReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profitLoading, setProfitLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, RowOverrides>>({});
  const [weights, setWeights] = useState<BonusWeights>(defaultBonusWeights());
  const [profitSharingPct, setProfitSharingPct] = useState("20");
  const [shareBonusPct, setShareBonusPct] = useState("30");
  const [grossProfit, setGrossProfit] = useState<number | null>(null);
  const [profitManual, setProfitManual] = useState(false);
  const [profitInput, setProfitInput] = useState("");
  const [issueYearEndBonus, setIssueYearEndBonus] = useState(false);
  const [yearEndBonusSalaryPct, setYearEndBonusSalaryPct] = useState("50");
  const [profitMeta, setProfitMeta] = useState<string>("");
  const [profitStats, setProfitStats] = useState<{ revenue: number; cost: number } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const loadedPeriodRef = useRef<string | null>(null);

  const asOf = useMemo(() => halfYearEndDate(year, half), [year, half]);

  const applyPeriodDraft = useCallback(
    (targetYear: number, targetHalf: HalfYear, employeeIds: string[]) => {
      const draft = loadPerformanceBonusPeriodDraft(targetYear, targetHalf);
      if (draft) {
        setOverrides(mergePerformanceBonusOverrides(draft.overrides, employeeIds));
        setWeights(draft.weights);
        setProfitSharingPct(draft.profitSharingPct);
        setShareBonusPct(draft.shareBonusPct);
        setProfitManual(draft.profitManual);
        setProfitInput(draft.profitInput);
        setIssueYearEndBonus(draft.issueYearEndBonus);
        setYearEndBonusSalaryPct(draft.yearEndBonusSalaryPct);
        return;
      }
      setOverrides(mergePerformanceBonusOverrides({}, employeeIds));
      setWeights(defaultBonusWeights());
      setProfitSharingPct("20");
      setShareBonusPct("30");
      setProfitManual(false);
      setProfitInput("");
      setIssueYearEndBonus(false);
      setYearEndBonusSalaryPct("50");
    },
    [],
  );

  useEffect(() => {
    const last = loadPerformanceBonusLastPeriod();
    setYear(last.year);
    setHalf(last.half);
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const key = `${year}-${half}`;
    if (loadedPeriodRef.current === key) return;
    loadedPeriodRef.current = key;
    applyPeriodDraft(year, half, employees.map((e) => e.id));
  }, [year, half, draftReady, employees, applyPeriodDraft]);

  useEffect(() => {
    if (!draftReady || loading) return;
    savePerformanceBonusPeriodDraft(year, half, {
      overrides,
      weights,
      profitSharingPct,
      shareBonusPct,
      profitManual,
      profitInput,
      issueYearEndBonus,
      yearEndBonusSalaryPct,
    });
  }, [
    draftReady,
    loading,
    overrides,
    weights,
    profitSharingPct,
    shareBonusPct,
    profitManual,
    profitInput,
    issueYearEndBonus,
    yearEndBonusSalaryPct,
    year,
    half,
  ]);

  const persistCurrentDraft = useCallback(() => {
    savePerformanceBonusPeriodDraft(year, half, {
      overrides,
      weights,
      profitSharingPct,
      shareBonusPct,
      profitManual,
      profitInput,
      issueYearEndBonus,
      yearEndBonusSalaryPct,
    });
  }, [
    year,
    half,
    overrides,
    weights,
    profitSharingPct,
    shareBonusPct,
    profitManual,
    profitInput,
    issueYearEndBonus,
    yearEndBonusSalaryPct,
  ]);

  const loadEmployees = useCallback(async () => {
    if (!isSupabaseConfigured) {
      toast.error(SUPABASE_CONFIG_HELP);
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const selectFull =
      "id, name, hire_date, monthly_wage, employment_status, share_count, unpaid_leave_months, deleted_at";
    const selectNoUnpaidLeave =
      "id, name, hire_date, monthly_wage, employment_status, share_count, deleted_at";
    let res = await supabase
      .from("employees")
      .select(selectFull)
      .is("deleted_at", null)
      .order("name");

    if (res.error && /column .* does not exist|could not find/i.test(res.error.message)) {
      const second = await supabase
        .from("employees")
        .select(selectNoUnpaidLeave)
        .is("deleted_at", null)
        .order("name");
      res = second as typeof res;
    }

    if (res.error && /column .* does not exist|could not find/i.test(res.error.message)) {
      const fallback = await supabase
        .from("employees")
        .select("id, name, hire_date, monthly_wage, employment_status")
        .order("name");
      res = fallback as typeof res;
    }

    if (res.error) {
      toast.error(res.error.message);
      setEmployees([]);
      setLoading(false);
      return;
    }

    const rows = (res.data ?? [])
      .map((r) => mapEmployeeRow(r as Record<string, unknown>))
      .filter((e) => isActiveEmployee(e.employment_status));

    setEmployees(rows);
    setOverrides((prev) =>
      mergePerformanceBonusOverrides(prev, rows.map((e) => e.id)),
    );
    setLoading(false);
  }, []);

  const loadProfit = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setProfitLoading(true);
    try {
      const result = await fetchHalfYearGrossProfit(year, half);
      setGrossProfit(result.grossProfit);
      setProfitStats({ revenue: result.revenue, cost: result.totalCost });
      if (!profitManual) {
        setProfitInput(String(Math.round(result.grossProfit)));
      }
      setProfitMeta(
        `統計至 ${result.cutoffLabel}，共 ${result.monthCount} 個月；營收 ${formatMoney(result.revenue)}、成本 ${formatMoney(result.totalCost)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "毛利載入失敗");
    } finally {
      setProfitLoading(false);
    }
  }, [year, half, profitManual]);

  useEffect(() => {
    if (!draftReady) return;
    void loadEmployees();
  }, [draftReady, loadEmployees]);

  useEffect(() => {
    void loadProfit();
  }, [loadProfit]);

  const profit = useMemo(() => {
    if (profitManual) return Math.max(0, parseNum(profitInput, 0));
    return Math.max(0, grossProfit ?? parseNum(profitInput, 0));
  }, [profitManual, profitInput, grossProfit]);

  const profitSharingPool = useMemo(() => {
    const pct = Math.max(0, parseNum(profitSharingPct, 0));
    return Math.round((profit * pct) / 100);
  }, [profit, profitSharingPct]);

  const shareBonusPool = useMemo(() => {
    const pct = Math.max(0, parseNum(shareBonusPct, 0));
    return Math.round((profit * pct) / 100);
  }, [profit, shareBonusPct]);

  const seniorityById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof seniorityFromHire>>();
    for (const emp of employees) {
      map.set(
        emp.id,
        seniorityFromHire(emp.hire_date, asOf, emp.unpaid_leave_months),
      );
    }
    return map;
  }, [employees, asOf]);

  const tenureRatioById = useMemo(() => {
    const map = new Map<string, number>();
    for (const emp of employees) {
      map.set(emp.id, halfYearTenureRatio(emp.hire_date, year, half));
    }
    return map;
  }, [employees, year, half]);

  const bonusInputs: BonusEmployeeInput[] = useMemo(
    () =>
      employees.map((emp) => {
        const ov = overrides[emp.id] ?? { performance: 5, participatesInProfitSharing: true, abilityGrade: 5 };
        const seniority = seniorityById.get(emp.id)?.decimalYears ?? 0;
        return {
          id: emp.id,
          name: emp.name,
          ability: Number.isFinite(Number(ov.abilityGrade)) ? Math.max(0, Number(ov.abilityGrade)) : 5,
          performance: ov.performance,
          seniority,
          salary: emp.monthly_wage,
          shares: emp.share_count,
          participatesInProfitSharing: ov.participatesInProfitSharing,
          halfYearTenureRatio: tenureRatioById.get(emp.id) ?? 0,
        };
      }),
    [employees, overrides, seniorityById, tenureRatioById],
  );

  const parsedYearEndBonusSalaryPct = useMemo(
    () => Math.max(0, parseNum(yearEndBonusSalaryPct, 50)),
    [yearEndBonusSalaryPct],
  );

  const computed = useMemo(
    () =>
      computePerformanceBonus(
        bonusInputs,
        profitSharingPool,
        shareBonusPool,
        weights,
        issueYearEndBonus,
        parsedYearEndBonusSalaryPct,
      ),
    [
      bonusInputs,
      profitSharingPool,
      shareBonusPool,
      weights,
      issueYearEndBonus,
      parsedYearEndBonusSalaryPct,
    ],
  );

  function updateOverride(id: string, patch: Partial<RowOverrides>) {
    setOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { performance: 5, participatesInProfitSharing: true, abilityGrade: 5 }),
        ...patch,
      },
    }));
  }

  function refreshAll() {
    void loadEmployees();
    void loadProfit();
  }

  /** 確定發放：將當期設定、加權與每位員工的所有欄位快照寫入發放紀錄 */
  async function confirmIssue() {
    if (!isSupabaseConfigured) {
      toast.error(SUPABASE_CONFIG_HELP);
      return;
    }
    if (computed.rows.length === 0) return;

    setIssuing(true);
    try {
      const existing = await supabase
        .from("performance_bonus_issuances")
        .select("id")
        .eq("year", year)
        .eq("half", half);
      if (existing.error) throw new Error(existing.error.message);

      const label = halfYearLabel(year, half);
      const confirmed = window.confirm(
        (existing.data ?? []).length > 0
          ? `${label} 已有 ${existing.data.length} 筆發放紀錄，仍要再記錄一筆？\n獎金合計 ${formatMoney(computed.totals.totalBonus)} 元`
          : `確定發放 ${label} 獎金並記錄？\n獎金合計 ${formatMoney(computed.totals.totalBonus)} 元`,
      );
      if (!confirmed) return;

      const header = await supabase
        .from("performance_bonus_issuances")
        .insert({
          year,
          half,
          profit,
          profit_meta: profitMeta || null,
          revenue: profitStats?.revenue ?? null,
          cost: profitStats?.cost ?? null,
          profit_sharing_pct: parseNum(profitSharingPct, 0),
          share_bonus_pct: parseNum(shareBonusPct, 0),
          issue_year_end_bonus: issueYearEndBonus,
          year_end_bonus_salary_pct: parsedYearEndBonusSalaryPct,
          weight_ability: weights.ability,
          weight_performance: weights.performance,
          weight_seniority: weights.seniority,
          weight_salary: weights.salary,
          profit_sharing_pool: computed.grossProfitSharingPool,
          year_end_bonus_total: computed.yearEndBonusTotal,
          weighted_profit_sharing_pool: computed.weightedProfitSharingPool,
          share_bonus_pool: shareBonusPool,
          total_bonus: computed.totals.totalBonus,
        })
        .select("id")
        .single();
      if (header.error) throw new Error(header.error.message);

      const rows = await supabase.from("performance_bonus_issuance_rows").insert(
        computed.rows.map((row, i) => ({
          issuance_id: header.data.id,
          employee_id: row.id,
          employee_name: row.name,
          participates_in_profit_sharing: row.participatesInProfitSharing,
          ability_grade: row.ability,
          performance: row.performance,
          seniority_years: row.seniority,
          seniority_label: seniorityById.get(row.id)?.label ?? null,
          tenure_ratio: row.halfYearTenureRatio,
          salary: row.salary,
          shares: row.shares,
          ability_pct: row.abilityPct,
          performance_pct: row.performancePct,
          seniority_pct: row.seniorityPct,
          salary_pct: row.salaryPct,
          total_pct: row.totalPct,
          year_end_bonus: row.yearEndBonus,
          profit_sharing_bonus: row.profitSharingBonus,
          share_bonus: row.shareBonus,
          total_bonus: row.totalBonus,
          sort_order: i,
        })),
      );
      if (rows.error) {
        // 明細寫入失敗時移除主檔，避免留下半套紀錄
        await supabase.from("performance_bonus_issuances").delete().eq("id", header.data.id);
        throw new Error(rows.error.message);
      }

      toast.success(`${label} 發放紀錄已儲存（${computed.rows.length} 人）`);
      setHistoryRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "發放紀錄儲存失敗");
    } finally {
      setIssuing(false);
    }
  }

  function exportPdf() {
    const snapshot: PerformanceBonusExportSnapshot = {
      savedAt: new Date().toISOString(),
      year,
      half,
      halfLabel: halfYearLabel(year, half),
      profit,
      profitMeta,
      profitSharingPct: parseNum(profitSharingPct, 0),
      shareBonusPct: parseNum(shareBonusPct, 0),
      issueYearEndBonus,
      yearEndBonusSalaryPct: parsedYearEndBonusSalaryPct,
      profitSharingPool,
      yearEndBonusTotal: computed.yearEndBonusTotal,
      weightedProfitSharingPool: computed.weightedProfitSharingPool,
      shareBonusPool,
      weights,
      rows: computed.rows.map((row) => ({
        name: row.name,
        abilityGrade: row.ability,
        seniorityLabel: seniorityById.get(row.id)?.label ?? "—",
        tenureRatioPct: formatTenureRatioPct(row.halfYearTenureRatio),
        performance: row.performance,
        seniority: row.seniority,
        salary: row.salary,
        shares: row.shares,
        participatesInProfitSharing: row.participatesInProfitSharing,
        abilityPct: row.abilityPct,
        performancePct: row.performancePct,
        seniorityPct: row.seniorityPct,
        salaryPct: row.salaryPct,
        totalPct: row.totalPct,
        yearEndBonus: row.yearEndBonus,
        profitSharingBonus: row.profitSharingBonus,
        shareBonus: row.shareBonus,
        totalBonus: row.totalBonus,
      })),
      totals: {
        ability: computed.totals.ability,
        performance: computed.totals.performance,
        seniority: computed.totals.seniority,
        salary: computed.totals.salary,
        shares: computed.totals.shares,
        yearEndBonus: computed.totals.yearEndBonus,
        profitSharingBonus: computed.totals.profitSharingBonus,
        shareBonus: computed.totals.shareBonus,
        totalBonus: computed.totals.totalBonus,
      },
    };
    savePerformanceBonusExport(snapshot);
    const opened = openPerformanceBonusPrintPage();
    if (!opened) {
      toast.message("已在本分頁開啟列印頁，請按「列印／另存 PDF」");
    }
  }

  const yearOptions = useMemo(() => {
    const cy = new Date().getFullYear();
    return [cy - 1, cy, cy + 1];
  }, []);

  const colSpan = 17;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid w-full max-w-md grid-cols-2 gap-3 sm:max-w-none sm:grid-cols-[7rem_11rem]">
            <label className="flex flex-col gap-1.5">
              <FieldLabel>年度</FieldLabel>
              <select
                className={selectClass}
                value={year}
                onChange={(e) => {
                  persistCurrentDraft();
                  setYear(Number(e.target.value));
                }}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel>發放期別</FieldLabel>
              <select
                className={selectClass}
                value={half}
                onChange={(e) => {
                  persistCurrentDraft();
                  setHalf(e.target.value as HalfYear);
                }}
              >
                <option value="H1">上半年（第 1–2 季）</option>
                <option value="H2">下半年（第 3–4 季）</option>
              </select>
            </label>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="default"
              className="h-9 gap-2 text-xs"
              onClick={() => void confirmIssue()}
              disabled={loading || issuing || computed.rows.length === 0}
            >
              <CheckCircle2 className={cn("h-3.5 w-3.5", issuing && "animate-spin")} />
              {issuing ? "記錄中…" : "確定發放"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2 text-xs"
              onClick={exportPdf}
              disabled={loading || computed.rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              匯出 PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2 text-xs"
              onClick={refreshAll}
              disabled={loading || profitLoading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (loading || profitLoading) && "animate-spin")} />
              重新整理
            </Button>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>分潤比例 (%)</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.1"
              className={inputClass}
              value={profitSharingPct}
              onChange={(e) => setProfitSharingPct(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>股份獎金比例 (%)</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.1"
              className={inputClass}
              value={shareBonusPct}
              onChange={(e) => setShareBonusPct(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>年終獎金（% 月薪）</FieldLabel>
            <div className="flex h-9 items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.1"
                className={cn(inputClass, !issueYearEndBonus && "opacity-50")}
                value={yearEndBonusSalaryPct}
                disabled={!issueYearEndBonus}
                title={
                  issueYearEndBonus
                    ? "每半年發放＝月薪 × 此 % × 在職比例"
                    : "勾選「發放」後可設定"
                }
                onChange={(e) => setYearEndBonusSalaryPct(e.target.value)}
              />
              <label
                htmlFor="issue-year-end-bonus"
                className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <input
                  id="issue-year-end-bonus"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={issueYearEndBonus}
                  onChange={(e) => setIssueYearEndBonus(e.target.checked)}
                />
                發放
              </label>
            </div>
          </label>
          <label className="flex flex-col gap-1.5 lg:col-span-2">
            <FieldLabel>利潤 · {halfYearLabel(year, half)} 毛利合計</FieldLabel>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={profitInput}
                onChange={(e) => {
                  setProfitManual(true);
                  setProfitInput(e.target.value);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0 px-3 text-xs"
                disabled={profitLoading}
                onClick={() => {
                  setProfitManual(false);
                  void loadProfit();
                }}
              >
                重算
              </Button>
            </div>
          </label>
        </div>

        {profitMeta && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground leading-relaxed">
            {profitMeta}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">利潤</p>
          <p className="font-serif text-xl font-semibold tabular-nums">{formatMoney(profit)}</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">分潤獎金池（{profitSharingPct}%）</p>
          <p className="font-serif text-xl font-semibold tabular-nums text-primary">
            {formatMoney(computed.grossProfitSharingPool)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">
            年終獎金合計
            {issueYearEndBonus
              ? `（${parsedYearEndBonusSalaryPct}% 月薪）`
              : "（本次不發）"}
          </p>
          <p className="font-serif text-xl font-semibold tabular-nums">
            {formatMoney(computed.yearEndBonusTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">考績分潤池</p>
          <p className="font-serif text-xl font-semibold tabular-nums text-primary">
            {formatMoney(computed.weightedProfitSharingPool)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">股份獎金池（{shareBonusPct}%）</p>
          <p className="font-serif text-xl font-semibold tabular-nums text-primary">
            {formatMoney(shareBonusPool)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] text-muted-foreground">獎金合計</p>
          <p className="font-serif text-xl font-semibold tabular-nums">
            {formatMoney(computed.totals.totalBonus)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">姓名</th>
              <th className="px-1.5 py-2 text-center font-medium">參與分紅</th>
              <th className="px-1.5 py-2 text-right font-medium">
                <div className="flex flex-col items-end gap-1">
                  <span>能力分級</span>
                  <input
                    type="number"
                    min={0}
                    className={inputClassSm}
                    value={weights.ability}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, ability: Math.max(0, parseNum(e.target.value, 0)) }))
                    }
                    title="能力分級加權"
                  />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right font-medium">
                <div className="flex flex-col items-end gap-1">
                  <span>考績</span>
                  <input
                    type="number"
                    min={0}
                    className={inputClassSm}
                    value={weights.performance}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, performance: Math.max(0, parseNum(e.target.value, 0)) }))
                    }
                    title="考績加權"
                  />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right font-medium">
                <div className="flex flex-col items-end gap-1">
                  <span>年資</span>
                  <input
                    type="number"
                    min={0}
                    className={inputClassSm}
                    value={weights.seniority}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, seniority: Math.max(0, parseNum(e.target.value, 0)) }))
                    }
                    title="年資加權"
                  />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right font-medium">
                <div className="flex flex-col items-end gap-1">
                  <span>薪資</span>
                  <input
                    type="number"
                    min={0}
                    className={inputClassSm}
                    value={weights.salary}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, salary: Math.max(0, parseNum(e.target.value, 0)) }))
                    }
                    title="薪資加權"
                  />
                </div>
              </th>
              <th className="px-1.5 py-2 text-right font-medium">股份</th>
              <th className="px-1.5 py-2 text-right font-medium">能力%</th>
              <th className="px-1.5 py-2 text-right font-medium">考績%</th>
              <th className="px-1.5 py-2 text-right font-medium">年資%</th>
              <th className="px-1.5 py-2 text-right font-medium">薪資%</th>
              <th className="px-1.5 py-2 text-right font-medium">總%</th>
              <th className="px-1.5 py-2 text-right font-medium">年終獎金</th>
              <th className="px-1.5 py-2 text-right font-medium">考績分潤</th>
              <th className="px-1.5 py-2 text-right font-medium">股份分紅</th>
              <th className="px-2 py-2 text-right font-medium">總獎金</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                  載入員工資料中…
                </td>
              </tr>
            ) : computed.rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                  無在職員工
                </td>
              </tr>
            ) : (
              computed.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 hover:bg-muted/20">
                  <td className="px-2 py-2 font-medium">{row.name}</td>
                  <td className="px-1.5 py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={overrides[row.id]?.participatesInProfitSharing ?? row.participatesInProfitSharing}
                      onChange={(e) =>
                        updateOverride(row.id, { participatesInProfitSharing: e.target.checked })
                      }
                      aria-label={`${row.name} 參與分紅`}
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.1"
                      className={inputClassNarrow}
                      value={overrides[row.id]?.abilityGrade ?? 5}
                      onChange={(e) =>
                        updateOverride(row.id, { abilityGrade: Math.max(0, parseNum(e.target.value, 0)) })
                      }
                      aria-label={`${row.name} 能力分級`}
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.1"
                      className={inputClassNarrow}
                      value={overrides[row.id]?.performance ?? row.performance}
                      onChange={(e) =>
                        updateOverride(row.id, { performance: Math.max(0, parseNum(e.target.value, 0)) })
                      }
                    />
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {seniorityById.get(row.id)?.label ?? "—"}
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums text-muted-foreground">
                    {formatMoney(row.salary)}
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums text-muted-foreground">
                    {row.shares.toLocaleString("zh-TW")}
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(row.abilityPct)}</td>
                  <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(row.performancePct)}</td>
                  <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(row.seniorityPct)}</td>
                  <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(row.salaryPct)}</td>
                  <td className="px-1.5 py-2 text-right tabular-nums font-medium">{formatPct(row.totalPct)}</td>
                  <td
                    className="px-1.5 py-2 text-right tabular-nums"
                    title={
                      row.halfYearTenureRatio < 1
                        ? `月薪 × ${parsedYearEndBonusSalaryPct}% × 在職比例 ${formatTenureRatioPct(row.halfYearTenureRatio)}`
                        : `月薪 × ${parsedYearEndBonusSalaryPct}%`
                    }
                  >
                    {formatMoney(row.yearEndBonus)}
                    {row.halfYearTenureRatio < 1 && row.halfYearTenureRatio > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({formatTenureRatioPct(row.halfYearTenureRatio)})
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums text-primary">
                    {formatMoney(row.profitSharingBonus)}
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums text-primary">
                    {formatMoney(row.shareBonus)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">
                    {formatMoney(row.totalBonus)}
                  </td>
                </tr>
              ))
            )}
            {!loading && computed.rows.length > 0 && (
              <tr className="bg-muted/30 font-medium">
                <td className="px-2 py-2">合計</td>
                <td className="px-1.5 py-2" />
                <td className="px-1.5 py-2 text-right tabular-nums">{computed.totals.ability}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{computed.totals.performance}</td>
                <td className="px-1.5 py-2" />
                <td className="px-1.5 py-2 text-right tabular-nums">{formatMoney(computed.totals.salary)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">
                  {computed.totals.shares.toLocaleString("zh-TW")}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(computed.totals.abilityPct)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(computed.totals.performancePct)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(computed.totals.seniorityPct)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(computed.totals.salaryPct)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{formatPct(computed.totals.totalPct)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">
                  {formatMoney(computed.totals.yearEndBonus)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-primary">
                  {formatMoney(computed.totals.profitSharingBonus)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-primary">
                  {formatMoney(computed.totals.shareBonus)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatMoney(computed.totals.totalBonus)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        勾選「發放」並設定年終獎金（% 月薪）時，分潤獎金池先扣年終（到職不足半年依在職比例），剩餘為考績分潤池；未勾選則全額作考績分潤（年終另於期末發放）。考績分潤僅分配給勾選「參與分紅」者。
      </p>

      <PerformanceBonusHistory refreshKey={historyRefreshKey} />
    </div>
  );
}
