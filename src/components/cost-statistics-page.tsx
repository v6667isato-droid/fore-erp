"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportCostStatisticsCsv,
  type ExportCurrentView,
} from "@/components/cost-statistics/export-cost-statistics-csv";
import {
  DEFAULT_ANNUAL_COMPANY_LOAN,
  DEFAULT_ANNUAL_RENT,
  listFixedOverheadYears,
  listRecordedSnapshotYears,
  loadAllFixedOverheadRecords,
  loadAllYearSnapshots,
  loadFixedOverheadForYear,
  loadYearSnapshot,
  saveFixedOverheadForYear,
  saveYearSnapshot,
  type CostStatisticsYearSnapshot,
} from "@/lib/cost-statistics-settings";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp, Download, Save } from "lucide-react";

type YearPreset = "this" | "last";

type PurchaseCostRow = {
  purchase_date: string;
  item_category?: string | null;
  tax_included_amount?: number | null;
  amount_ex_tax?: number | null;
};

/** 採購類別以「木料」開頭者歸入木料成本，其餘為非木料 */
function isWoodMaterialCategory(category: string | null | undefined): boolean {
  const c = (category ?? "").trim();
  return c.startsWith("木料");
}

type OrderRevenueRow = {
  order_date: string;
  total_amount?: number | null;
  status?: string | null;
};

type PayslipRow = {
  employee_id?: string | null;
  period_key?: string | null;
  net_pay?: number | null;
  net_salary?: number | null;
  status?: string | null;
};

type EmployeeBurdenRow = {
  id: string;
  name?: string | null;
  labor_employer_burden?: number | null;
  health_employer_burden?: number | null;
  labor_pension_employer?: number | null;
};

/** 2026/1–2 月沿用 3 月試算時，自該金額扣除此人於 3 月之薪資（含雇主負擔） */
const SALARY_BACKFILL_EXCLUDE_NAME = "鍾語桐";

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function monthKey(value: string): string {
  if (!value || value.length < 7) return "";
  return value.slice(0, 7);
}

function monthLabel(key: string): string {
  if (!key) return "未知";
  const [y, m] = key.split("-");
  return `${y}/${m}`;
}

/** 本地 YYYY-MM-DD */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 將「今天」對應到指定曆年的同日，避免無效日期（如 2/29） */
function sameCalendarDayInYear(statYear: number, ref: Date): Date {
  const last = new Date(statYear, ref.getMonth() + 1, 0).getDate();
  const day = Math.min(ref.getDate(), last);
  return new Date(statYear, ref.getMonth(), day);
}

/**
 * 統計截止日：本年度＝今年今日；去年度＝去年與今年相同的月日（可比期間）。
 * 若檢視曆年與預設不符，則以該年 12/31 為截止。
 */
function getYtdCutoff(statYear: number, preset: YearPreset): Date {
  const today = new Date();
  const cy = today.getFullYear();
  if (preset === "this") {
    if (statYear !== cy) return new Date(statYear, 11, 31);
    return sameCalendarDayInYear(cy, today);
  }
  const expectedLast = cy - 1;
  if (statYear !== expectedLast) return new Date(statYear, 11, 31);
  return sameCalendarDayInYear(statYear, today);
}

function daysInMonth1Based(year: number, month1To12: number): number {
  return new Date(year, month1To12, 0).getDate();
}

function rentLoanPortionForMonth(
  annualRent: number,
  annualLoan: number,
  statYear: number,
  month1To12: number,
  cutoff: Date,
): { rent: number; loan: number } | null {
  const rowYm = `${statYear}-${String(month1To12).padStart(2, "0")}`;
  const cYm = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
  if (rowYm > cYm) return null;
  const baseR = annualRent / 12;
  const baseL = annualLoan / 12;
  if (rowYm < cYm) return { rent: baseR, loan: baseL };
  const dim = daysInMonth1Based(statYear, month1To12);
  const d = Math.min(Math.max(1, cutoff.getDate()), dim);
  const frac = d / dim;
  return { rent: baseR * frac, loan: baseL * frac };
}

export function CostStatisticsPage() {
  const [preset, setPreset] = useState<YearPreset>("this");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annualRent, setAnnualRent] = useState<number>(DEFAULT_ANNUAL_RENT);
  const [annualCompanyLoan, setAnnualCompanyLoan] = useState<number>(DEFAULT_ANNUAL_COMPANY_LOAN);
  const [fixedOverheadReady, setFixedOverheadReady] = useState(false);
  const [fixedOverheadOpen, setFixedOverheadOpen] = useState(false);
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear());
  const [recordedYears, setRecordedYears] = useState<number[]>([]);
  const [snapshotYears, setSnapshotYears] = useState<number[]>([]);
  const skipNextFixedOverheadSave = useRef(false);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseCostRow[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRevenueRow[]>([]);
  const [payslipRows, setPayslipRows] = useState<PayslipRow[]>([]);
  const [employeeBurdens, setEmployeeBurdens] = useState<EmployeeBurdenRow[]>([]);
  /** 每季「月份明細」是否展開；收合時僅顯示該季小計列 */
  const [quarterMonthOpen, setQuarterMonthOpen] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
  });

  const year = useMemo(() => {
    const now = new Date().getFullYear();
    return preset === "this" ? now : now - 1;
  }, [preset]);

  function refreshRecordedMeta() {
    setRecordedYears(listFixedOverheadYears());
    setSnapshotYears(listRecordedSnapshotYears());
  }

  useEffect(() => {
    skipNextFixedOverheadSave.current = true;
    const saved = loadFixedOverheadForYear(year);
    setAnnualRent(saved.annualRent);
    setAnnualCompanyLoan(saved.annualCompanyLoanInterest);
    setFixedOverheadReady(true);
    refreshRecordedMeta();
  }, [year]);

  useEffect(() => {
    if (!fixedOverheadReady) return;
    if (skipNextFixedOverheadSave.current) {
      skipNextFixedOverheadSave.current = false;
      return;
    }
    saveFixedOverheadForYear(year, {
      annualRent,
      annualCompanyLoanInterest: annualCompanyLoan,
    });
    refreshRecordedMeta();
  }, [annualRent, annualCompanyLoan, fixedOverheadReady, year]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const start = `${year}-01-01`;
      const end = `${year}-12-31`;

      const [purchaseRes, orderRes, payslipRes, employeeRes] = await Promise.all([
        supabase
          .from("purchases")
          .select("purchase_date,item_category,tax_included_amount,amount_ex_tax")
          .gte("purchase_date", start)
          .lte("purchase_date", end),
        supabase
          .from("orders")
          .select("order_date,total_amount,status")
          .gte("order_date", start)
          .lte("order_date", end),
        supabase
          .from("payslips")
          .select("employee_id,period_key,net_pay,net_salary,status")
          .gte("period_key", `${year}-01`)
          .lte("period_key", `${year}-12`),
        supabase
          .from("employees")
          .select("id,name,labor_employer_burden,health_employer_burden,labor_pension_employer"),
      ]);

      if (cancelled) return;

      if (purchaseRes.error || orderRes.error || payslipRes.error || employeeRes.error) {
        setError(
          purchaseRes.error?.message ??
            orderRes.error?.message ??
            payslipRes.error?.message ??
            employeeRes.error?.message ??
            "成本資料載入失敗",
        );
        setPurchaseRows([]);
        setOrderRows([]);
        setPayslipRows([]);
        setEmployeeBurdens([]);
        setLoading(false);
        return;
      }

      setPurchaseRows((purchaseRes.data ?? []) as PurchaseCostRow[]);
      setOrderRows((orderRes.data ?? []) as OrderRevenueRow[]);
      setPayslipRows((payslipRes.data ?? []) as PayslipRow[]);
      setEmployeeBurdens((employeeRes.data ?? []) as EmployeeBurdenRow[]);
      setLoading(false);
    }

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [year]);

  const computed = useMemo(() => {
    const cutoff = getYtdCutoff(year, preset);
    const cutoffStr = formatLocalYmd(cutoff);
    const cutoffYm = cutoffStr.slice(0, 7);

    const purchaseRowsYtd = purchaseRows.filter((r) => (r.purchase_date ?? "") <= cutoffStr);
    const orderRowsYtd = orderRows.filter((r) => (r.order_date ?? "") <= cutoffStr);
    const payslipRowsYtd = payslipRows.filter((r) => {
      const pk = r.period_key && r.period_key.length >= 7 ? r.period_key.slice(0, 7) : "";
      return pk && pk <= cutoffYm;
    });

    const purchaseNonWoodByMonth = new Map<string, number>();
    const purchaseWoodByMonth = new Map<string, number>();
    const salaryByMonth = new Map<string, number>();
    const revenueByMonth = new Map<string, number>();
    const burdenByEmployeeId = new Map<string, number>();

    let totalPurchaseNonWood = 0;
    let totalPurchaseWood = 0;
    for (const row of purchaseRowsYtd) {
      const cost = Number(row.tax_included_amount ?? row.amount_ex_tax ?? 0);
      if (!Number.isFinite(cost)) continue;
      const wood = isWoodMaterialCategory(row.item_category);
      if (wood) totalPurchaseWood += cost;
      else totalPurchaseNonWood += cost;
      const key = monthKey(row.purchase_date);
      if (!key) continue;
      const map = wood ? purchaseWoodByMonth : purchaseNonWoodByMonth;
      map.set(key, (map.get(key) ?? 0) + cost);
    }
    const totalPurchaseCost = totalPurchaseNonWood + totalPurchaseWood;

    for (const emp of employeeBurdens) {
      const burden =
        Number(emp.labor_employer_burden ?? 0) +
        Number(emp.health_employer_burden ?? 0) +
        Number(emp.labor_pension_employer ?? 0);
      if (!Number.isFinite(burden)) continue;
      burdenByEmployeeId.set(emp.id, burden);
    }

    let totalSalaryCost = 0;
    for (const row of payslipRowsYtd) {
      if (row.status && row.status !== "paid") continue;
      const key = row.period_key && row.period_key.length >= 7 ? row.period_key.slice(0, 7) : "";
      if (!key) continue;
      const netPay = Number(row.net_pay ?? row.net_salary ?? 0);
      if (!Number.isFinite(netPay)) continue;
      const burden =
        row.employee_id && burdenByEmployeeId.has(row.employee_id)
          ? Number(burdenByEmployeeId.get(row.employee_id) ?? 0)
          : 0;
      const salaryCost = netPay + burden;
      totalSalaryCost += salaryCost;
      salaryByMonth.set(key, (salaryByMonth.get(key) ?? 0) + salaryCost);
    }

    /** 2026 年 1–2 月系統尚未有發薪紀錄：薪資（含雇主負擔）沿用 3 月試算，並扣除指定員工於 3 月之金額（僅在 YTD 已含 3 月起始時套用） */
    if (year === 2026 && cutoffYm >= "2026-03") {
      const k1 = "2026-01";
      const k2 = "2026-02";
      const k3 = "2026-03";
      const s3 = salaryByMonth.get(k3) ?? 0;
      const excludeIds = new Set(
        employeeBurdens
          .filter((e) => (e.name ?? "").trim() === SALARY_BACKFILL_EXCLUDE_NAME)
          .map((e) => e.id),
      );
      let excludeMarchSalary = 0;
      for (const row of payslipRowsYtd) {
        if (row.status && row.status !== "paid") continue;
        const pk = row.period_key && row.period_key.length >= 7 ? row.period_key.slice(0, 7) : "";
        if (pk !== k3) continue;
        if (!row.employee_id || !excludeIds.has(row.employee_id)) continue;
        const netPay = Number(row.net_pay ?? row.net_salary ?? 0);
        if (!Number.isFinite(netPay)) continue;
        const burden = burdenByEmployeeId.has(row.employee_id)
          ? Number(burdenByEmployeeId.get(row.employee_id) ?? 0)
          : 0;
        excludeMarchSalary += netPay + burden;
      }
      const s3Adjusted = Math.max(0, s3 - excludeMarchSalary);
      const old1s = salaryByMonth.get(k1) ?? 0;
      const old2s = salaryByMonth.get(k2) ?? 0;
      salaryByMonth.set(k1, s3Adjusted);
      salaryByMonth.set(k2, s3Adjusted);
      totalSalaryCost += s3Adjusted - old1s + (s3Adjusted - old2s);
    }

    let totalRevenue = 0;
    for (const row of orderRowsYtd) {
      if ((row.status ?? "").trim() === "報價中") continue;
      const amount = Number(row.total_amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      totalRevenue += amount;
      const key = monthKey(row.order_date);
      if (!key) continue;
      revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + amount);
    }

    const monthlyRows: {
      key: string;
      purchaseNonWood: number;
      purchaseWood: number;
      purchaseCost: number;
      salaryCost: number;
      rentCost: number;
      loanCost: number;
      totalCost: number;
      revenue: number;
      grossProfit: number;
      grossMargin: number;
      labelSuffix: string;
    }[] = [];

    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const rl = rentLoanPortionForMonth(annualRent, annualCompanyLoan, year, m, cutoff);
      if (!rl) break;
      const purchaseNonWood = purchaseNonWoodByMonth.get(key) ?? 0;
      const purchaseWood = purchaseWoodByMonth.get(key) ?? 0;
      const purchaseCost = purchaseNonWood + purchaseWood;
      const salaryCost = salaryByMonth.get(key) ?? 0;
      const rentCost = rl.rent;
      const loanCost = rl.loan;
      const totalCost = purchaseCost + salaryCost + rentCost + loanCost;
      const revenue = revenueByMonth.get(key) ?? 0;
      const grossProfit = revenue - totalCost;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const labelSuffix =
        year === 2026 && (key === "2026-01" || key === "2026-02")
          ? " (用3月試算，不含鍾語桐)"
          : "";
      monthlyRows.push({
        key,
        purchaseNonWood,
        purchaseWood,
        purchaseCost,
        salaryCost,
        rentCost,
        loanCost,
        totalCost,
        revenue,
        grossProfit,
        grossMargin,
        labelSuffix,
      });
    }

    type MonthRow = (typeof monthlyRows)[number];
    type TableRow =
      | { kind: "month"; quarter: 1 | 2 | 3 | 4; row: MonthRow }
      | {
          kind: "quarter";
          quarter: 1 | 2 | 3 | 4;
          label: string;
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

    const tableRows: TableRow[] = [];
    for (let q = 0; q < 4; q++) {
      const mStart = q * 3 + 1;
      const mEnd = q * 3 + 3;
      const slice = monthlyRows.filter((row) => {
        const mm = Number(row.key.slice(5, 7));
        return mm >= mStart && mm <= mEnd;
      });
      const qNum = (q + 1) as 1 | 2 | 3 | 4;
      for (const row of slice) {
        tableRows.push({ kind: "month", quarter: qNum, row });
      }
      let purchaseNonWood = 0;
      let purchaseWood = 0;
      let salaryCost = 0;
      let rentCost = 0;
      let loanCost = 0;
      let totalCost = 0;
      let revenue = 0;
      let grossProfit = 0;
      for (const row of slice) {
        purchaseNonWood += row.purchaseNonWood;
        purchaseWood += row.purchaseWood;
        salaryCost += row.salaryCost;
        rentCost += row.rentCost;
        loanCost += row.loanCost;
        totalCost += row.totalCost;
        revenue += row.revenue;
        grossProfit += row.grossProfit;
      }
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      tableRows.push({
        kind: "quarter",
        quarter: qNum,
        label: `${year} 第 ${q + 1} 季 小計`,
        purchaseNonWood,
        purchaseWood,
        salaryCost,
        rentCost,
        loanCost,
        totalCost,
        revenue,
        grossProfit,
        grossMargin,
      });
    }

    let totalRentCost = 0;
    let totalCompanyLoanCost = 0;
    for (const row of monthlyRows) {
      totalRentCost += row.rentCost;
      totalCompanyLoanCost += row.loanCost;
    }

    const totalCost = totalPurchaseCost + totalSalaryCost + totalRentCost + totalCompanyLoanCost;
    const grossProfit = totalRevenue - totalCost;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      ytdCutoffLabel: cutoffStr,
      totalPurchaseCost,
      totalPurchaseNonWood,
      totalPurchaseWood,
      totalSalaryCost,
      totalRentCost,
      totalCompanyLoanCost,
      totalCost,
      totalRevenue,
      grossProfit,
      grossMargin,
      monthlyRows,
      tableRows,
      orderCount: orderRowsYtd.length,
      purchaseCount: purchaseRowsYtd.length,
      payslipCount: payslipRowsYtd.length,
    };
  }, [orderRows, payslipRows, purchaseRows, annualRent, annualCompanyLoan, year, employeeBurdens, preset]);

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
      totalSalaryCost: snapshot.totalSalaryCost,
      totalRentCost: snapshot.totalRentCost,
      totalCompanyLoanCost: snapshot.totalCompanyLoanCost,
      totalCost: snapshot.totalCost,
      totalRevenue: snapshot.totalRevenue,
      grossProfit: snapshot.grossProfit,
      grossMargin: snapshot.grossMargin,
      monthlyRows: snapshot.monthlyRows.map((row) => ({
        key: row.month,
        purchaseNonWood: row.purchaseNonWood,
        purchaseWood: row.purchaseWood,
        salaryCost: row.salaryCost,
        rentCost: row.rentCost,
        loanCost: row.loanCost,
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
      totalSalaryCost: computed.totalSalaryCost,
      totalRentCost: computed.totalRentCost,
      totalCompanyLoanCost: computed.totalCompanyLoanCost,
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
      totalSalaryCost: computed.totalSalaryCost,
      totalRentCost: computed.totalRentCost,
      totalCompanyLoanCost: computed.totalCompanyLoanCost,
      totalCost: computed.totalCost,
      totalRevenue: computed.totalRevenue,
      grossProfit: computed.grossProfit,
      grossMargin: computed.grossMargin,
      monthlyRows: computed.monthlyRows.map((row) => ({
        month: row.key,
        purchaseNonWood: row.purchaseNonWood,
        purchaseWood: row.purchaseWood,
        salaryCost: row.salaryCost,
        rentCost: row.rentCost,
        loanCost: row.loanCost,
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
          {year} 年年初至今（截至 {computed.ytdCutoffLabel}）；採購／薪資／訂單依實際日期或發薪月份，租金與公司貸款利息依年額按月分攤（當月按日比例）。營收排除「報價中」訂單。
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
              各年度設定分開儲存；統計快照保存在此瀏覽器。
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
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:min-w-0 sm:grid-cols-9 sm:overflow-visible">
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">非木料成本</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalPurchaseNonWood)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">木料成本</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">
                {formatMoney(computed.totalPurchaseWood)}
              </p>
            </div>
            <div className="min-w-[5.75rem] shrink-0 rounded-lg border border-border bg-card p-2 sm:min-w-0">
              <p className="text-[10px] leading-tight text-muted-foreground">薪資成本(含雇主負擔)</p>
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
                  僅顯示截至 {computed.ytdCutoffLabel} 之月份；點季度小計列可收合或展開該季月份明細
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
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">月份</th>
                    <th className="px-4 py-2 font-medium">非木料成本</th>
                    <th className="px-4 py-2 font-medium">木料成本</th>
                    <th className="px-4 py-2 font-medium">薪資成本(含雇主負擔)</th>
                    <th className="px-4 py-2 font-medium">租金</th>
                    <th className="px-4 py-2 font-medium">公司貸款利息</th>
                    <th className="px-4 py-2 font-medium">總成本</th>
                    <th className="px-4 py-2 font-medium">訂單營收</th>
                    <th className="px-4 py-2 font-medium">毛利</th>
                    <th className="px-4 py-2 font-medium">毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.tableRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-muted-foreground" colSpan={10}>
                        這個年度尚無可統計資料
                      </td>
                    </tr>
                  ) : (
                    computed.tableRows.map((item) =>
                      item.kind === "month" ? (
                        quarterMonthOpen[item.quarter] ? (
                          <tr key={item.row.key} className="border-b border-border/70">
                            <td className="px-4 py-2 pl-10">
                              {monthLabel(item.row.key)}
                              {item.row.labelSuffix ? (
                                <span className="text-muted-foreground">{item.row.labelSuffix}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">{formatMoney(item.row.purchaseNonWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.purchaseWood)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.salaryCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.rentCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.loanCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.totalCost)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.revenue)}</td>
                            <td className="px-4 py-2">{formatMoney(item.row.grossProfit)}</td>
                            <td className="px-4 py-2">{item.row.grossMargin.toFixed(1)}%</td>
                          </tr>
                        ) : null
                      ) : (
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
                          <td className="px-4 py-2">{formatMoney(item.salaryCost)}</td>
                          <td className="px-4 py-2">{formatMoney(item.rentCost)}</td>
                          <td className="px-4 py-2">{formatMoney(item.loanCost)}</td>
                          <td className="px-4 py-2">{formatMoney(item.totalCost)}</td>
                          <td className="px-4 py-2">{formatMoney(item.revenue)}</td>
                          <td className="px-4 py-2">{formatMoney(item.grossProfit)}</td>
                          <td className="px-4 py-2">{item.grossMargin.toFixed(1)}%</td>
                        </tr>
                      ),
                    )
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
