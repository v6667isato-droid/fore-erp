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
  computeRevenueTax,
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
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp, Download, Save } from "lucide-react";

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function monthLabel(key: string): string {
  if (!key) return "未知";
  const [y, m] = key.split("-");
  return `${y}/${m}`;
}

export function CostStatisticsPage() {
  const [preset, setPreset] = useState<YearPreset>("this");
  const [annualRent, setAnnualRent] = useState<number>(DEFAULT_ANNUAL_RENT);
  const [annualCompanyLoan, setAnnualCompanyLoan] = useState<number>(DEFAULT_ANNUAL_COMPANY_LOAN);
  const [fixedOverheadReady, setFixedOverheadReady] = useState(false);
  const [fixedOverheadOpen, setFixedOverheadOpen] = useState(false);
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear());
  const [recordedYears, setRecordedYears] = useState<number[]>([]);
  const [snapshotYears, setSnapshotYears] = useState<number[]>([]);
  const [overheadSaveState, setOverheadSaveState] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  /** 最近一次自儲存載入（或成功寫入）的值；與目前輸入相同時不觸發儲存 */
  const lastLoadedOverhead = useRef<{ rent: number; loan: number } | null>(null);
  /** 每季「月份明細」是否展開；收合時僅顯示該季小計列 */
  const [quarterMonthOpen, setQuarterMonthOpen] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
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
    lastLoadedOverhead.current = {
      rent: saved.annualRent,
      loan: saved.annualCompanyLoanInterest,
    };
    setAnnualRent(saved.annualRent);
    setAnnualCompanyLoan(saved.annualCompanyLoanInterest);
    setFixedOverheadReady(true);
    refreshRecordedMeta();
    void fetchFixedOverheadForYear(year).then((remote) => {
      if (cancelled) return;
      lastLoadedOverhead.current = {
        rent: remote.annualRent,
        loan: remote.annualCompanyLoanInterest,
      };
      setAnnualRent(remote.annualRent);
      setAnnualCompanyLoan(remote.annualCompanyLoanInterest);
      refreshRecordedMeta();
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  useEffect(() => {
    if (!fixedOverheadReady) return;
    const last = lastLoadedOverhead.current;
    if (last && last.rent === annualRent && last.loan === annualCompanyLoan) return;
    setOverheadSaveState({ kind: "saving" });
    const timer = setTimeout(() => {
      void persistFixedOverheadForYear(year, {
        annualRent,
        annualCompanyLoanInterest: annualCompanyLoan,
      }).then(({ error }) => {
        if (error) {
          setOverheadSaveState({ kind: "error", message: error });
          return;
        }
        lastLoadedOverhead.current = { rent: annualRent, loan: annualCompanyLoan };
        setOverheadSaveState({ kind: "saved" });
        refreshRecordedMeta();
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [annualRent, annualCompanyLoan, fixedOverheadReady, year]);

  const { loading, error, computed } = useCostStatisticsData({
    year,
    preset,
    annualRent,
    annualCompanyLoan,
  });

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
      totalTaxCost: snapshot.totalTaxCost ?? computeRevenueTax(snapshot.totalRevenue),
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
        taxCost: row.taxCost ?? computeRevenueTax(row.revenue),
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {year} 年年初至今（截至 {computed.ytdCutoffLabel}）；採購／薪資／訂單依實際日期或發薪月份，設攤提之採購按月分攤（含往年採購當年度分攤額），木料攤提併入「木料含攤提」欄，其餘列於「其他攤提」欄，租金與公司貸款利息依年額按月分攤（當月按日比例），稅金為訂單營收之 {REVENUE_TAX_RATE * 100}%。營收排除「報價中」與已刪除訂單；採購不含已刪除紀錄。
        </p>
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
      </div>

      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setFixedOverheadOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30"
          aria-expanded={fixedOverheadOpen}
        >
          <span className="shrink-0 text-sm font-medium text-foreground">年度固定開銷</span>
          <span className="ml-auto min-w-0 truncate text-right text-xs text-muted-foreground">
            {year} 年 · 租金 {formatMoney(annualRent)} · 利息 {formatMoney(annualCompanyLoan)}
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
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:min-w-0 sm:grid-cols-11 sm:overflow-visible">
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">非木料成本</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalPurchaseNonWood)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">木料含攤提</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalPurchaseWood)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">其他攤提</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalPurchaseAmortized)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">薪資成本</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalSalaryCost)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">租金</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalRentCost)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">公司貸款利息</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalCompanyLoanCost)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">
                稅金（營收 {REVENUE_TAX_RATE * 100}%）
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalTaxCost)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">總成本</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalCost)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">訂單營收</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalRevenue)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">毛利</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.grossProfit)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">毛利率</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {computed.grossMargin.toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">每月與季度結算（年初至今）</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  截至 {computed.ytdCutoffLabel} 為實際數；第三、四季度納入尚末發生之攤提預估（標示「預估攤提」）。點季度小計列可收合或展開月份明細。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  採購 {computed.purchaseCount} 筆 / 薪資 {computed.payslipCount} 筆 / 訂單{" "}
                  {computed.orderCount} 筆
                </p>
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
              <table className="w-full min-w-[1160px] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">月份</th>
                    <th className="px-4 py-2 font-medium">非木料成本</th>
                    <th className="px-4 py-2 font-medium">木料含攤提</th>
                    <th className="px-4 py-2 font-medium">其他攤提</th>
                    <th className="px-4 py-2 font-medium">薪資成本</th>
                    <th className="px-4 py-2 font-medium">租金</th>
                    <th className="px-4 py-2 font-medium">公司貸款利息</th>
                    <th className="px-4 py-2 font-medium">稅金（營收 5%）</th>
                    <th className="px-4 py-2 font-medium">總成本</th>
                    <th className="px-4 py-2 font-medium">訂單營收</th>
                    <th className="px-4 py-2 font-medium">毛利</th>
                    <th className="px-4 py-2 font-medium">毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.tableRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-muted-foreground" colSpan={12}>
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
                              {monthLabel(item.row.key)}
                              {item.row.labelSuffix ? (
                                <span className="text-muted-foreground">{item.row.labelSuffix}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">{formatMoney(item.row.purchaseNonWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.purchaseWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.purchaseAmortized)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.salaryCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.rentCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.loanCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.taxCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.totalCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.revenue)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.grossProfit)}</td>
                            <td className="px-4 py-2">{item.row.grossMargin.toFixed(1)}%</td>
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
                                className="inline-flex w-full max-w-full items-center gap-2 rounded-md text-left hover:bg-muted/60 sm:max-w-none"
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
                                <span>{item.label}</span>
                              </button>
                            </td>
                            <td className="px-4 py-2">{formatMoney(item.purchaseNonWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.purchaseWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.purchaseAmortized)}</td>
                            <td className="px-4 py-2">{formatMoney(item.salaryCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.rentCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.loanCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.taxCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.totalCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.revenue)}</td>
                            <td className="px-4 py-2">{formatMoney(item.grossProfit)}</td>
                            <td className="px-4 py-2">{item.grossMargin.toFixed(1)}%</td>
                          </tr>
                        );
                      }
                      return null;
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
