"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportCostStatisticsCsv,
  type ExportCurrentView,
} from "@/components/cost-statistics/export-cost-statistics-csv";
import {
  DEFAULT_ANNUAL_COMPANY_LOAN,
  DEFAULT_ANNUAL_RENT,
  fetchAllFixedOverheadRecords,
  fetchFixedOverheadForYear,
  listFixedOverheadYears,
  listRecordedSnapshotYears,
  loadAllFixedOverheadRecords,
  loadAllYearSnapshots,
  DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO,
  loadFixedOverheadForYear,
  loadYearSnapshot,
  persistFixedOverheadForYear,
  REVENUE_TAX_RATE,
  saveYearSnapshot,
  type CostStatisticsYearSnapshot,
} from "@/lib/cost-statistics-settings";
import {
  useCostStatisticsData,
  yearForPreset,
  type YearPreset,
} from "@/components/cost-statistics/use-cost-statistics-data";
import { spreadPurchaseCostByMonth } from "@/lib/purchase-amortization";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp, Download, Save } from "lucide-react";

/** 成本結構固定項目與色槽（色彩跟著項目走，不隨金額排序改變） */
const BUCKET_DEFS = [
  { key: "salary", label: "薪資", colorVar: "--cr-1" },
  { key: "wood", label: "木料攤提", colorVar: "--cr-2" },
  { key: "nonWood", label: "非木料", colorVar: "--cr-3" },
  { key: "amortized", label: "其他攤提", colorVar: "--cr-4" },
  { key: "rent", label: "租金", colorVar: "--cr-5" },
  { key: "loan", label: "貸款利息", colorVar: "--cr-6" },
  { key: "tax", label: "營業稅", colorVar: "--cr-7" },
] as const;

type BucketKey = (typeof BUCKET_DEFS)[number]["key"];

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPct(part: number, whole: number): string {
  if (!(whole > 0)) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function monthLabel(key: string): string {
  if (!key) return "未知";
  const [y, m] = key.split("-");
  return `${y}/${m}`;
}

function EstimateBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-400">
      {children}
    </span>
  );
}

function LossBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
      虧損
    </span>
  );
}

export function CostStatisticsPage() {
  const [preset, setPreset] = useState<YearPreset>("this");
  const [annualRent, setAnnualRent] = useState<number>(DEFAULT_ANNUAL_RENT);
  const [annualCompanyLoan, setAnnualCompanyLoan] = useState<number>(DEFAULT_ANNUAL_COMPANY_LOAN);
  /** 進項稅可扣抵比例，畫面以百分比（0–100）編輯 */
  const [deductiblePct, setDeductiblePct] = useState<number>(
    DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO * 100,
  );
  const [fixedOverheadReady, setFixedOverheadReady] = useState(false);
  const [fixedOverheadOpen, setFixedOverheadOpen] = useState(false);
  const [structureDetailOpen, setStructureDetailOpen] = useState(false);
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear());
  const [recordedYears, setRecordedYears] = useState<number[]>([]);
  const [snapshotYears, setSnapshotYears] = useState<number[]>([]);
  const [overheadSaveState, setOverheadSaveState] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  /** 最近一次自儲存載入（或成功寫入）的值；與目前輸入相同時不觸發儲存 */
  const lastLoadedOverhead = useRef<{ rent: number; loan: number; pct: number } | null>(null);
  /** 每季「月份明細」是否展開；收合時僅顯示該季小計列 */
  const [quarterMonthOpen, setQuarterMonthOpen] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: false,
    2: false,
    3: false,
    4: false,
  });

  const year = useMemo(() => yearForPreset(preset), [preset]);

  function refreshRecordedMeta() {
    setRecordedYears(listFixedOverheadYears());
    setSnapshotYears(listRecordedSnapshotYears());
  }

  /** 首次載入時把 app_settings 內所有年度設定同步進本機快取（歷史表、CSV 匯出用） */
  useEffect(() => {
    let cancelled = false;
    void fetchAllFixedOverheadRecords().then(() => {
      if (!cancelled) refreshRecordedMeta();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOverheadSaveState({ kind: "idle" });
    const saved = loadFixedOverheadForYear(year);
    const savedPct = saved.inputTaxDeductibleRatio * 100;
    lastLoadedOverhead.current = {
      rent: saved.annualRent,
      loan: saved.annualCompanyLoanInterest,
      pct: savedPct,
    };
    setAnnualRent(saved.annualRent);
    setAnnualCompanyLoan(saved.annualCompanyLoanInterest);
    setDeductiblePct(savedPct);
    setFixedOverheadReady(true);
    refreshRecordedMeta();
    void fetchFixedOverheadForYear(year).then((remote) => {
      if (cancelled) return;
      const remotePct = remote.inputTaxDeductibleRatio * 100;
      lastLoadedOverhead.current = {
        rent: remote.annualRent,
        loan: remote.annualCompanyLoanInterest,
        pct: remotePct,
      };
      setAnnualRent(remote.annualRent);
      setAnnualCompanyLoan(remote.annualCompanyLoanInterest);
      setDeductiblePct(remotePct);
      refreshRecordedMeta();
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  useEffect(() => {
    if (!fixedOverheadReady) return;
    const last = lastLoadedOverhead.current;
    if (
      last &&
      last.rent === annualRent &&
      last.loan === annualCompanyLoan &&
      last.pct === deductiblePct
    ) {
      return;
    }
    setOverheadSaveState({ kind: "saving" });
    const timer = setTimeout(() => {
      void persistFixedOverheadForYear(year, {
        annualRent,
        annualCompanyLoanInterest: annualCompanyLoan,
        inputTaxDeductibleRatio: deductiblePct / 100,
      }).then(({ error }) => {
        if (error) {
          setOverheadSaveState({ kind: "error", message: error });
          return;
        }
        lastLoadedOverhead.current = {
          rent: annualRent,
          loan: annualCompanyLoan,
          pct: deductiblePct,
        };
        setOverheadSaveState({ kind: "saved" });
        refreshRecordedMeta();
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [annualRent, annualCompanyLoan, deductiblePct, fixedOverheadReady, year]);

  const { loading, error, computed, purchaseRows } = useCostStatisticsData({
    year,
    preset,
    annualRent,
    annualCompanyLoan,
    inputTaxDeductibleRatio: deductiblePct / 100,
  });

  /** 截止月所屬季度：預設僅展開該季的月份明細 */
  const cutoffQuarter = useMemo(() => {
    const m = Number(computed.ytdCutoffLabel.slice(5, 7));
    if (!Number.isFinite(m) || m < 1) return 4;
    return (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  }, [computed.ytdCutoffLabel]);

  useEffect(() => {
    setQuarterMonthOpen({ 1: false, 2: false, 3: false, 4: false, [cutoffQuarter]: true });
  }, [cutoffQuarter, year]);

  /** 成本結構七大項，占比高者在前（色彩固定跟著項目走） */
  const buckets = useMemo(() => {
    const amounts: Record<BucketKey, number> = {
      salary: computed.totalSalaryCost,
      wood: computed.totalPurchaseWood,
      nonWood: computed.totalPurchaseNonWood,
      amortized: computed.totalPurchaseAmortized,
      rent: computed.totalRentCost,
      loan: computed.totalCompanyLoanCost,
      tax: computed.totalTaxCost,
    };
    return BUCKET_DEFS.map((def) => ({ ...def, amount: amounts[def.key] })).sort(
      (a, b) => b.amount - a.amount,
    );
  }, [computed]);

  /** 非木料採購（含攤提份額）依類別彙總，供成本結構明細使用 */
  const categoryBreakdown = useMemo(() => {
    const cutoffYm = computed.ytdCutoffLabel.slice(0, 7);
    const byCategory = new Map<string, number>();
    for (const row of purchaseRows) {
      const spreads = spreadPurchaseCostByMonth(row, { cutoffYm, statYear: year });
      for (const spread of spreads) {
        if (spread.isWood) continue;
        const cat = (row.item_category ?? "").trim() || "未分類";
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + spread.amount);
      }
    }
    return Array.from(byCategory, ([category, amount]) => ({ category, amount }))
      .filter((item) => item.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
  }, [purchaseRows, computed.ytdCutoffLabel, year]);

  const totalCost = computed.totalCost;
  const maxCategoryAmount = categoryBreakdown[0]?.amount ?? 0;

  const historyRows = useMemo(() => {
    return Array.from(new Set([...recordedYears, ...snapshotYears]))
      .sort((a, b) => b - a)
      .map((y) => ({
        year: y,
        overhead: loadFixedOverheadForYear(y),
        snapshot: loadYearSnapshot(y),
      }));
  }, [recordedYears, snapshotYears]);

  const exportYearOptions = useMemo(() => {
    const cy = new Date().getFullYear();
    return Array.from(new Set([year, cy, cy - 1, ...recordedYears, ...snapshotYears]))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => b - a);
  }, [year, recordedYears, snapshotYears]);

  useEffect(() => {
    setExportYear(year);
  }, [year]);

  function snapshotToExportView(
    targetYear: number,
    snapshot: CostStatisticsYearSnapshot,
  ): ExportCurrentView {
    return {
      year: targetYear,
      ytdCutoffLabel: snapshot.ytdCutoffLabel,
      fixedOverhead: snapshot.fixedOverhead,
      totalPurchaseNonWood: snapshot.totalPurchaseNonWood,
      totalPurchaseWood: snapshot.totalPurchaseWood,
      totalPurchaseAmortized: snapshot.totalPurchaseAmortized ?? 0,
      totalSalaryCost: snapshot.totalSalaryCost,
      totalRentCost: snapshot.totalRentCost,
      totalCompanyLoanCost: snapshot.totalCompanyLoanCost,
      totalTaxCost: snapshot.totalTaxCost ?? 0,
      totalCost: snapshot.totalCost,
      totalRevenue: snapshot.totalRevenue,
      grossProfit: snapshot.grossProfit,
      grossMargin: snapshot.grossMargin,
      monthlyRows: snapshot.monthlyRows.map((row) => ({
        key: row.month,
        purchaseNonWood: row.purchaseNonWood,
        purchaseWood: row.purchaseWood,
        purchaseAmortized: row.purchaseAmortized ?? 0,
        salaryCost: row.salaryCost,
        rentCost: row.rentCost,
        loanCost: row.loanCost,
        taxCost: row.taxCost ?? 0,
        totalCost: row.totalCost,
        revenue: row.revenue,
        grossProfit: row.grossProfit,
        grossMargin: row.grossMargin,
      })),
    };
  }

  function liveViewToExportView(): ExportCurrentView {
    return {
      year,
      ytdCutoffLabel: computed.ytdCutoffLabel,
      fixedOverhead: {
        annualRent,
        annualCompanyLoanInterest: annualCompanyLoan,
        inputTaxDeductibleRatio: deductiblePct / 100,
      },
      totalPurchaseNonWood: computed.totalPurchaseNonWood,
      totalPurchaseWood: computed.totalPurchaseWood,
      totalPurchaseAmortized: computed.totalPurchaseAmortized,
      totalSalaryCost: computed.totalSalaryCost,
      totalRentCost: computed.totalRentCost,
      totalCompanyLoanCost: computed.totalCompanyLoanCost,
      totalTaxCost: computed.totalTaxCost,
      totalCost: computed.totalCost,
      totalRevenue: computed.totalRevenue,
      grossProfit: computed.grossProfit,
      grossMargin: computed.grossMargin,
      monthlyRows: computed.monthlyRows,
    };
  }

  function buildYearSnapshot(): CostStatisticsYearSnapshot {
    return {
      savedAt: new Date().toISOString(),
      preset,
      ytdCutoffLabel: computed.ytdCutoffLabel,
      fixedOverhead: {
        annualRent,
        annualCompanyLoanInterest: annualCompanyLoan,
        inputTaxDeductibleRatio: deductiblePct / 100,
      },
      totalPurchaseNonWood: computed.totalPurchaseNonWood,
      totalPurchaseWood: computed.totalPurchaseWood,
      totalPurchaseAmortized: computed.totalPurchaseAmortized,
      totalSalaryCost: computed.totalSalaryCost,
      totalRentCost: computed.totalRentCost,
      totalCompanyLoanCost: computed.totalCompanyLoanCost,
      totalTaxCost: computed.totalTaxCost,
      totalCost: computed.totalCost,
      totalRevenue: computed.totalRevenue,
      grossProfit: computed.grossProfit,
      grossMargin: computed.grossMargin,
      monthlyRows: computed.monthlyRows.map((row) => ({
        month: row.key,
        purchaseNonWood: row.purchaseNonWood,
        purchaseWood: row.purchaseWood,
        purchaseAmortized: row.purchaseAmortized,
        salaryCost: row.salaryCost,
        rentCost: row.rentCost,
        loanCost: row.loanCost,
        taxCost: row.taxCost,
        totalCost: row.totalCost,
        revenue: row.revenue,
        grossProfit: row.grossProfit,
        grossMargin: row.grossMargin,
      })),
    };
  }

  function handleSaveYearRecord() {
    saveYearSnapshot(year, buildYearSnapshot());
    refreshRecordedMeta();
  }

  function handleExportCsv() {
    let current: ExportCurrentView | null = null;
    if (exportYear === year && !loading && !error) {
      current = liveViewToExportView();
    } else {
      const snap = loadYearSnapshot(exportYear);
      if (snap) current = snapshotToExportView(exportYear, snap);
    }
    if (!current) {
      window.alert(
        `${exportYear} 年尚無可匯出的統計資料。請切換至該年度檢視，或先按「儲存統計紀錄」。`,
      );
      return;
    }
    exportCostStatisticsCsv({
      current,
      fixedOverheadHistory: loadAllFixedOverheadRecords(),
      snapshots: loadAllYearSnapshots().filter((item) => item.year === exportYear),
    });
  }

  function exportYearSourceLabel(targetYear: number): string {
    if (targetYear === year && !loading && !error) return "即時";
    if (loadYearSnapshot(targetYear)) return "已存";
    return "";
  }

  const profitClass =
    computed.grossProfit >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive";

  return (
    <section className="space-y-4">
      {/* 圖表色票：亮／暗版皆為已驗證之分類色序（色彩對應固定項目） */}
      <style>{`
        .cost-structure-viz {
          --cr-1: #2a78d6;
          --cr-2: #eb6834;
          --cr-3: #1baf7a;
          --cr-4: #eda100;
          --cr-5: #e87ba4;
          --cr-6: #008300;
          --cr-7: #4a3aa7;
        }
        html.dark .cost-structure-viz {
          --cr-1: #3987e5;
          --cr-2: #d95926;
          --cr-3: #199e70;
          --cr-4: #c98500;
          --cr-5: #d55181;
          --cr-6: #008300;
          --cr-7: #9085e9;
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
          <Button
            type="button"
            variant={preset === "this" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setPreset("this")}
          >
            本年度
          </Button>
          <Button
            type="button"
            variant={preset === "last" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setPreset("last")}
          >
            去年度
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          採購 {computed.purchaseCount} 筆 · 薪資 {computed.payslipCount} 筆 · 訂單{" "}
          {computed.orderCount} 筆 · 截至 {computed.ytdCutoffLabel}
        </p>
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          載入成本統計中…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">訂單營收（含稅）</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
                {formatMoney(computed.totalRevenue)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">總成本</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
                {formatMoney(totalCost)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">毛利</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${profitClass}`}>
                {formatMoney(computed.grossProfit)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">毛利率</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${profitClass}`}>
                {computed.grossMargin.toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="cost-structure-viz rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">成本結構</h2>
              <button
                type="button"
                onClick={() => setStructureDetailOpen((open) => !open)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={structureDetailOpen}
              >
                總成本 {formatMoney(totalCost)} · {structureDetailOpen ? "收合明細" : "展開明細"}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${structureDetailOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {totalCost > 0 ? (
              <>
                <div className="mt-3 flex h-6 w-full gap-[2px]" role="img" aria-label="成本結構占比長條圖">
                  {buckets
                    .filter((b) => b.amount > 0)
                    .map((b) => (
                      <div
                        key={b.key}
                        title={`${b.label}：${formatMoney(b.amount)}（${formatPct(b.amount, totalCost)}）`}
                        className="h-full rounded-[4px]"
                        style={{
                          width: `${(b.amount / totalCost) * 100}%`,
                          minWidth: 3,
                          background: `var(${b.colorVar})`,
                        }}
                      />
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {buckets.map((b) => (
                    <span
                      key={b.key}
                      title={`占總成本 ${formatPct(b.amount, totalCost)}`}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: `var(${b.colorVar})` }}
                      />
                      {b.label}
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatMoney(b.amount)}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">這個年度尚無可統計資料</p>
            )}

            {structureDetailOpen && totalCost > 0 && (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead>
                      <tr className="whitespace-nowrap border-b border-border bg-muted/30 text-left text-muted-foreground">
                        <th className="px-4 py-2 font-medium">項目</th>
                        <th className="px-4 py-2 font-medium">金額</th>
                        <th className="px-4 py-2 font-medium">占總成本</th>
                        <th className="px-4 py-2 font-medium">占營收</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((b) => (
                        <tr key={b.key} className="border-b border-border/70">
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                                style={{ background: `var(${b.colorVar})` }}
                              />
                              {b.label}
                            </span>
                          </td>
                          <td className="px-4 py-2 tabular-nums">{formatMoney(b.amount)}</td>
                          <td className="px-4 py-2 tabular-nums">{formatPct(b.amount, totalCost)}</td>
                          <td className="px-4 py-2 tabular-nums">
                            {formatPct(b.amount, computed.totalRevenue)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-medium text-foreground">
                        <td className="px-4 py-2">總成本</td>
                        <td className="px-4 py-2 tabular-nums">{formatMoney(totalCost)}</td>
                        <td className="px-4 py-2 tabular-nums">100.0%</td>
                        <td className="px-4 py-2 tabular-nums">
                          {formatPct(totalCost, computed.totalRevenue)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    非木料採購類別細分（含攤提份額）
                  </h3>
                  {categoryBreakdown.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">尚無非木料採購資料</p>
                  ) : (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[26rem] text-sm">
                        <thead>
                          <tr className="whitespace-nowrap border-b border-border text-left text-muted-foreground">
                            <th className="px-2 py-1.5 font-medium">類別</th>
                            <th className="w-1/2 px-2 py-1.5 font-medium">金額分布</th>
                            <th className="px-2 py-1.5 text-right font-medium">金額</th>
                            <th className="px-2 py-1.5 text-right font-medium">占總成本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryBreakdown.map((item) => (
                            <tr key={item.category} className="border-b border-border/50">
                              <td className="whitespace-nowrap px-2 py-1.5">{item.category}</td>
                              <td className="px-2 py-1.5">
                                <div
                                  className="h-3.5 rounded-[4px]"
                                  title={`${item.category}：${formatMoney(item.amount)}`}
                                  style={{
                                    width: `${maxCategoryAmount > 0 ? Math.max((item.amount / maxCategoryAmount) * 100, 1) : 0}%`,
                                    background: "var(--cr-3)",
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {formatMoney(item.amount)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {formatPct(item.amount, totalCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">每月與季度結算</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  點季度列可展開／收合月份明細；未到月份僅列預估攤提。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="cost-export-year">
                  匯出年份
                </label>
                <select
                  id="cost-export-year"
                  value={exportYear}
                  onChange={(e) => setExportYear(Number(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  {exportYearOptions.map((y) => {
                    const tag = exportYearSourceLabel(y);
                    return (
                      <option key={y} value={y}>
                        {y} 年{tag ? `（${tag}）` : ""}
                      </option>
                    );
                  })}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleExportCsv}
                >
                  <Download className="h-3.5 w-3.5" />
                  匯出 CSV
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">月份</th>
                    <th className="px-4 py-2 text-right font-medium">材料與攤提</th>
                    <th className="px-4 py-2 text-right font-medium">薪資</th>
                    <th className="px-4 py-2 text-right font-medium">租金與利息</th>
                    <th className="px-4 py-2 text-right font-medium">營業稅</th>
                    <th className="px-4 py-2 text-right font-medium">總成本</th>
                    <th className="px-4 py-2 text-right font-medium">訂單營收</th>
                    <th className="px-4 py-2 text-right font-medium">毛利</th>
                    <th className="px-4 py-2 text-right font-medium">毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.tableRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-muted-foreground" colSpan={9}>
                        這個年度尚無可統計資料
                      </td>
                    </tr>
                  ) : (
                    computed.tableRows.map((item) => {
                      if (item.kind === "month") {
                        if (!quarterMonthOpen[item.quarter]) return null;
                        return (
                          <tr
                            key={item.row.key}
                            className={`border-b border-border/70 ${item.row.isProjected ? "text-muted-foreground" : ""}`}
                          >
                            <td className="px-4 py-2 pl-10">
                              <span className="inline-flex items-center gap-1.5">
                                {monthLabel(item.row.key)}
                                {item.row.isProjected ? (
                                  <EstimateBadge>預估</EstimateBadge>
                                ) : item.row.labelSuffix ? (
                                  <span className="text-xs text-muted-foreground">
                                    {item.row.labelSuffix}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.purchaseCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.salaryCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.rentCost + item.row.loanCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.taxCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.totalCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.row.revenue)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right tabular-nums ${item.row.grossProfit < 0 ? "text-destructive" : ""}`}
                            >
                              {formatMoney(item.row.grossProfit)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {item.row.grossMargin.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      }
                      if (item.kind === "quarter") {
                        return (
                          <tr
                            key={`quarter-${item.quarter}`}
                            className="border-b border-border bg-muted/40 font-medium text-foreground"
                          >
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setQuarterMonthOpen((prev) => ({
                                    ...prev,
                                    [item.quarter]: !prev[item.quarter],
                                  }))
                                }
                                className="inline-flex w-full max-w-full items-center gap-1.5 rounded-md text-left hover:bg-muted/60 sm:max-w-none"
                                aria-expanded={quarterMonthOpen[item.quarter]}
                                aria-label={
                                  quarterMonthOpen[item.quarter]
                                    ? `收合第 ${item.quarter} 季月份明細`
                                    : `展開第 ${item.quarter} 季月份明細`
                                }
                              >
                                {quarterMonthOpen[item.quarter] ? (
                                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <span>
                                  {year} Q{item.quarter}
                                </span>
                                {item.grossProfit < 0 && !item.hasProjected && <LossBadge />}
                                {item.hasProjected && <EstimateBadge>含預估</EstimateBadge>}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(
                                item.purchaseNonWood + item.purchaseWood + item.purchaseAmortized,
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.salaryCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.rentCost + item.loanCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.taxCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.totalCost)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMoney(item.revenue)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right tabular-nums ${item.grossProfit < 0 ? "text-destructive" : ""}`}
                            >
                              {formatMoney(item.grossProfit)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {item.grossMargin.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      }
                      return null;
                    })
                  )}
                  {computed.tableRows.length > 0 && (
                    <tr className="bg-emerald-50/60 font-medium text-foreground dark:bg-emerald-950/30">
                      <td className="px-4 py-2" title="僅計實際數，不含預估攤提">
                        年初至今合計
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(computed.totalPurchaseCost)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(computed.totalSalaryCost)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(computed.totalRentCost + computed.totalCompanyLoanCost)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(computed.totalTaxCost)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totalCost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(computed.totalRevenue)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${computed.grossProfit < 0 ? "text-destructive" : ""}`}
                      >
                        {formatMoney(computed.grossProfit)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {computed.grossMargin.toFixed(1)}%
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setFixedOverheadOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30"
          aria-expanded={fixedOverheadOpen}
        >
          <span className="shrink-0 text-sm font-medium text-foreground">年度固定開銷</span>
          <span className="ml-auto min-w-0 truncate text-right text-xs text-muted-foreground">
            {year} 年 · 租金 {formatMoney(annualRent)} · 利息 {formatMoney(annualCompanyLoan)} ·
            折抵率 {Math.round(deductiblePct)}%
            {snapshotYears.includes(year) ? " · 已存" : ""}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${fixedOverheadOpen ? "rotate-180" : ""}`}
          />
        </button>

        {fixedOverheadOpen && (
          <div className="space-y-4 border-t border-border px-4 py-4">
            <p className="text-xs text-muted-foreground">
              各年度設定分開儲存並同步至資料庫（各裝置共用）；統計快照保存在此瀏覽器。
              {overheadSaveState.kind === "saving" && (
                <span className="ml-2 text-muted-foreground">儲存中…</span>
              )}
              {overheadSaveState.kind === "saved" && (
                <span className="ml-2 text-emerald-600">已儲存</span>
              )}
              {overheadSaveState.kind === "error" && (
                <span className="ml-2 text-destructive">
                  雲端儲存失敗：{overheadSaveState.message}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-[12rem] flex-col gap-1">
                <label className="text-xs font-medium text-foreground" htmlFor="cost-annual-rent">
                  1. 租金（年）
                </label>
                <input
                  id="cost-annual-rent"
                  type="number"
                  min={0}
                  step={10000}
                  value={annualRent}
                  onChange={(e) => setAnnualRent(Math.max(0, Number(e.target.value || 0)))}
                  className="h-9 w-full max-w-[11rem] rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                />
                <span className="text-[11px] text-muted-foreground">
                  預設 {DEFAULT_ANNUAL_RENT.toLocaleString("zh-TW")} 元／年
                </span>
              </div>
              <div className="flex min-w-[12rem] flex-col gap-1">
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="cost-annual-company-loan"
                >
                  2. 公司貸款利息（年）
                </label>
                <input
                  id="cost-annual-company-loan"
                  type="number"
                  min={0}
                  step={1000}
                  value={annualCompanyLoan}
                  onChange={(e) => setAnnualCompanyLoan(Math.max(0, Number(e.target.value || 0)))}
                  title="預設：29695×12 + 7441×12 + 28037×6"
                  className="h-9 w-full max-w-[11rem] rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                />
                <span className="text-[11px] text-muted-foreground">
                  預設 {DEFAULT_ANNUAL_COMPANY_LOAN.toLocaleString("zh-TW")} 元／年
                </span>
              </div>
              <div className="flex min-w-[12rem] flex-col gap-1">
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="cost-input-tax-deductible"
                >
                  3. 進項稅折抵率（%）
                </label>
                <input
                  id="cost-input-tax-deductible"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={deductiblePct}
                  onChange={(e) =>
                    setDeductiblePct(Math.min(100, Math.max(0, Number(e.target.value || 0))))
                  }
                  className="h-9 w-full max-w-[11rem] rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                />
                <span className="text-[11px] text-muted-foreground">
                  進項稅實際折抵得掉的比例。0% ＝全部折抵不到（保守）；100% ＝全部折抵。
                  可由 401 申報書的進項稅額推算。
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={handleSaveYearRecord}
              disabled={loading || !!error}
            >
              <Save className="h-3.5 w-3.5" />
              儲存 {year} 年統計紀錄
            </Button>

            {(recordedYears.length > 0 || snapshotYears.length > 0) && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[28rem] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">年度</th>
                      <th className="px-3 py-2 font-medium">租金（年）</th>
                      <th className="px-3 py-2 font-medium">貸款利息（年）</th>
                      <th className="px-3 py-2 font-medium">折抵率</th>
                      <th className="px-3 py-2 font-medium">統計紀錄</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map(({ year: y, overhead, snapshot: snap }) => (
                      <tr key={y} className="border-b border-border/70">
                        <td className="px-3 py-2 font-medium">{y}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(overhead.annualRent)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatMoney(overhead.annualCompanyLoanInterest)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {Math.round(overhead.inputTaxDeductibleRatio * 100)}%
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {snap ? snap.savedAt.slice(0, 10).replace(/-/g, "/") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <details className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
        <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
          計算說明
        </summary>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">稅務口徑：</span>營收維持含稅（與訂單金額一致），
            材料與攤提一律以未稅認列。「營業稅」＝銷項稅額（營收 ÷ {1 + REVENUE_TAX_RATE} ×{" "}
            {REVENUE_TAX_RATE * 100}%，含在營收裡、須繳交國稅局）＋折抵不到的進項稅額（材料未稅 ×{" "}
            {REVENUE_TAX_RATE * 100}% × (1 −折抵率)）。折抵率目前為單一參數、不逐筆綁定採購紀錄；
            待會計系統上線後可改讀實際折抵金額。
          </p>
          <p>
            {year} 年年初至今（截至 {computed.ytdCutoffLabel}
            ）；採購／薪資／訂單依實際日期或發薪月份，設攤提之採購按月分攤（含往年採購當年度分攤額），木料攤提併入「木料攤提」，租金與公司貸款利息依年額按月分攤（當月按日比例）。營收排除「報價中」與已刪除訂單；採購不含已刪除紀錄。成本結構與合計列僅計實際數、不含
            Q3/Q4 預估攤提；表中未到月份僅列預估攤提供參考。「材料與攤提」＝非木料＋木料攤提＋其他攤提；「租金與利息」＝租金＋公司貸款利息。
          </p>
          <p>
            此口徑與考績獎金的半年度毛利共用，兩邊數字一致。2026-08-05
            之前儲存的年度快照為舊口徑（材料含稅、稅金以含稅營收 ×{REVENUE_TAX_RATE * 100}%
            計算），不可與現在的數字直接比較。
          </p>
        </div>
      </details>
    </section>
  );
}
