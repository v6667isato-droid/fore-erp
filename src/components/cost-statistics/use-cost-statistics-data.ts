"use client";

import { useEffect, useMemo, useState } from "react";
import { computeRevenueTax } from "@/lib/cost-statistics-settings";
import {
  purchaseCostLookbackStartYear,
  spreadPurchaseCostByMonth,
} from "@/lib/purchase-amortization";
import { supabase } from "@/lib/supabase";

export type YearPreset = "this" | "last";

export type PurchaseCostRow = {
  purchase_date: string;
  item_category?: string | null;
  tax_included_amount?: number | null;
  amount_ex_tax?: number | null;
  amortization_months?: number | null;
};

export type OrderRevenueRow = {
  order_date: string;
  total_amount?: number | null;
  status?: string | null;
};

export type PayslipRow = {
  employee_id?: string | null;
  period_key?: string | null;
  net_pay?: number | null;
  net_salary?: number | null;
  status?: string | null;
};

export type EmployeeBurdenRow = {
  id: string;
  name?: string | null;
  labor_employer_burden?: number | null;
  health_employer_burden?: number | null;
  labor_pension_employer?: number | null;
};

/** 2026/1–2 月沿用 3 月試算時，自該金額扣除此人於 3 月之薪資（含雇主負擔） */
const SALARY_BACKFILL_EXCLUDE_NAME = "鍾語桐";

export function yearForPreset(preset: YearPreset): number {
  const now = new Date().getFullYear();
  return preset === "this" ? now : now - 1;
}

function monthKey(value: string): string {
  if (!value || value.length < 7) return "";
  return value.slice(0, 7);
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

function rentLoanForFullMonth(annualRent: number, annualLoan: number): { rent: number; loan: number } {
  return { rent: annualRent / 12, loan: annualLoan / 12 };
}

/** 第三、四季度月份（7–12 月） */
function isQ3OrQ4Month(month1To12: number): boolean {
  return month1To12 >= 7;
}

export type CostMonthlyRow = {
  key: string;
  purchaseNonWood: number;
  purchaseWood: number;
  purchaseAmortized: number;
  purchaseCost: number;
  salaryCost: number;
  rentCost: number;
  loanCost: number;
  taxCost: number;
  totalCost: number;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  labelSuffix: string;
  isProjected: boolean;
};

type AggregateTotals = {
  purchaseNonWood: number;
  purchaseWood: number;
  purchaseAmortized: number;
  salaryCost: number;
  rentCost: number;
  loanCost: number;
  taxCost: number;
  totalCost: number;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  hasProjected: boolean;
};

export type CostTableRow =
  | { kind: "month"; quarter: 1 | 2 | 3 | 4; row: CostMonthlyRow }
  | ({ kind: "quarter"; quarter: 1 | 2 | 3 | 4; label: string } & AggregateTotals);

export type CostStatisticsComputed = {
  ytdCutoffLabel: string;
  totalPurchaseCost: number;
  totalPurchaseNonWood: number;
  totalPurchaseWood: number;
  totalPurchaseAmortized: number;
  totalSalaryCost: number;
  totalRentCost: number;
  totalCompanyLoanCost: number;
  totalTaxCost: number;
  totalCost: number;
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number;
  monthlyRows: CostMonthlyRow[];
  tableRows: CostTableRow[];
  orderCount: number;
  purchaseCount: number;
  payslipCount: number;
};

/**
 * 成本統計資料來源與彙總（成本統計／成本占比分頁共用，確保兩邊數字一致）。
 */
export function useCostStatisticsData(args: {
  year: number;
  preset: YearPreset;
  annualRent: number;
  annualCompanyLoan: number;
}) {
  const { year, preset, annualRent, annualCompanyLoan } = args;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseCostRow[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRevenueRow[]>([]);
  const [payslipRows, setPayslipRows] = useState<PayslipRow[]>([]);
  const [employeeBurdens, setEmployeeBurdens] = useState<EmployeeBurdenRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const start = `${year}-01-01`;
      const lookbackStart = `${purchaseCostLookbackStartYear(year)}-01-01`;
      const end = `${year}-12-31`;

      const [purchaseRes, orderRes, payslipRes, employeeRes] = await Promise.all([
        supabase
          .from("purchases")
          .select("purchase_date,item_category,tax_included_amount,amount_ex_tax,amortization_months")
          .is("deleted_at", null)
          .gte("purchase_date", lookbackStart)
          .lte("purchase_date", end),
        supabase
          .from("orders")
          .select("order_date,total_amount,status")
          .is("deleted_at", null)
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

  const computed = useMemo<CostStatisticsComputed>(() => {
    const cutoff = getYtdCutoff(year, preset);
    const cutoffStr = formatLocalYmd(cutoff);
    const cutoffYm = cutoffStr.slice(0, 7);

    const purchaseRowsInYearYtd = purchaseRows.filter(
      (r) =>
        (r.purchase_date ?? "").startsWith(`${year}-`) && (r.purchase_date ?? "") <= cutoffStr,
    );
    const orderRowsYtd = orderRows.filter((r) => (r.order_date ?? "") <= cutoffStr);
    const payslipRowsYtd = payslipRows.filter((r) => {
      const pk = r.period_key && r.period_key.length >= 7 ? r.period_key.slice(0, 7) : "";
      return pk && pk <= cutoffYm;
    });

    const yearEndYm = `${year}-12`;
    const purchaseNonWoodByMonth = new Map<string, number>();
    const purchaseWoodByMonth = new Map<string, number>();
    const purchaseAmortizedByMonth = new Map<string, number>();
    const purchaseNonWoodFullByMonth = new Map<string, number>();
    const purchaseWoodFullByMonth = new Map<string, number>();
    const purchaseAmortizedFullByMonth = new Map<string, number>();
    const salaryByMonth = new Map<string, number>();
    const revenueByMonth = new Map<string, number>();
    const burdenByEmployeeId = new Map<string, number>();

    let totalPurchaseNonWood = 0;
    let totalPurchaseWood = 0;
    let totalPurchaseAmortized = 0;
    for (const row of purchaseRows) {
      const spreadsYtd = spreadPurchaseCostByMonth(row, { cutoffYm, statYear: year });
      for (const { monthKey: key, amount, isWood, isAmortized } of spreadsYtd) {
        if (isWood) totalPurchaseWood += amount;
        else if (isAmortized) totalPurchaseAmortized += amount;
        else totalPurchaseNonWood += amount;
        const map = isWood
          ? purchaseWoodByMonth
          : isAmortized
            ? purchaseAmortizedByMonth
            : purchaseNonWoodByMonth;
        map.set(key, (map.get(key) ?? 0) + amount);
      }
      const spreadsFull = spreadPurchaseCostByMonth(row, {
        cutoffYm,
        statYear: year,
        throughYm: yearEndYm,
      });
      for (const { monthKey: key, amount, isWood, isAmortized } of spreadsFull) {
        const map = isWood
          ? purchaseWoodFullByMonth
          : isAmortized
            ? purchaseAmortizedFullByMonth
            : purchaseNonWoodFullByMonth;
        map.set(key, (map.get(key) ?? 0) + amount);
      }
    }
    const totalPurchaseCost = totalPurchaseNonWood + totalPurchaseWood + totalPurchaseAmortized;

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

    const monthlyRows: CostMonthlyRow[] = [];

    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const isActual = key <= cutoffYm;
      const isProjected = key > cutoffYm && isQ3OrQ4Month(m);
      if (!isActual && !isProjected) continue;

      let purchaseNonWood = 0;
      let purchaseWood = 0;
      let purchaseAmortized = 0;
      let salaryCost = 0;
      let rentCost = 0;
      let loanCost = 0;
      let revenue = 0;
      let taxCost = 0;
      let labelSuffix = "";

      if (isProjected) {
        purchaseNonWood = purchaseNonWoodFullByMonth.get(key) ?? 0;
        purchaseWood = purchaseWoodFullByMonth.get(key) ?? 0;
        purchaseAmortized = purchaseAmortizedFullByMonth.get(key) ?? 0;
        const rl = rentLoanForFullMonth(annualRent, annualCompanyLoan);
        rentCost = rl.rent;
        loanCost = rl.loan;
        labelSuffix = " (預估攤提)";
      } else {
        const rl = rentLoanPortionForMonth(annualRent, annualCompanyLoan, year, m, cutoff);
        if (!rl) continue;
        purchaseNonWood = purchaseNonWoodByMonth.get(key) ?? 0;
        purchaseWood = purchaseWoodByMonth.get(key) ?? 0;
        purchaseAmortized = purchaseAmortizedByMonth.get(key) ?? 0;
        salaryCost = salaryByMonth.get(key) ?? 0;
        rentCost = rl.rent;
        loanCost = rl.loan;
        revenue = revenueByMonth.get(key) ?? 0;
        if (year === 2026 && (key === "2026-01" || key === "2026-02")) {
          labelSuffix = " (用3月試算，不含鍾語桐)";
        }
      }

      const purchaseCost = purchaseNonWood + purchaseWood + purchaseAmortized;
      taxCost = computeRevenueTax(revenue);
      const totalCost = purchaseCost + salaryCost + rentCost + loanCost + taxCost;
      const grossProfit = revenue - totalCost;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

      monthlyRows.push({
        key,
        purchaseNonWood,
        purchaseWood,
        purchaseAmortized,
        purchaseCost,
        salaryCost,
        rentCost,
        loanCost,
        taxCost,
        totalCost,
        revenue,
        grossProfit,
        grossMargin,
        labelSuffix,
        isProjected,
      });
    }

    function sumMonthSlice(slice: CostMonthlyRow[]): AggregateTotals {
      let purchaseNonWood = 0;
      let purchaseWood = 0;
      let purchaseAmortized = 0;
      let salaryCost = 0;
      let rentCost = 0;
      let loanCost = 0;
      let taxCost = 0;
      let totalCost = 0;
      let revenue = 0;
      let grossProfit = 0;
      let hasProjected = false;
      for (const row of slice) {
        purchaseNonWood += row.purchaseNonWood;
        purchaseWood += row.purchaseWood;
        purchaseAmortized += row.purchaseAmortized;
        salaryCost += row.salaryCost;
        rentCost += row.rentCost;
        loanCost += row.loanCost;
        taxCost += row.taxCost;
        totalCost += row.totalCost;
        revenue += row.revenue;
        grossProfit += row.grossProfit;
        if (row.isProjected) hasProjected = true;
      }
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      return {
        purchaseNonWood,
        purchaseWood,
        purchaseAmortized,
        salaryCost,
        rentCost,
        loanCost,
        taxCost,
        totalCost,
        revenue,
        grossProfit,
        grossMargin,
        hasProjected,
      };
    }

    const tableRows: CostTableRow[] = [];
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
      const qSum = sumMonthSlice(slice);
      const qLabel =
        qSum.hasProjected && qNum >= 3
          ? `${year} 第 ${q + 1} 季 小計（含預估攤提）`
          : `${year} 第 ${q + 1} 季 小計`;
      tableRows.push({
        kind: "quarter",
        quarter: qNum,
        label: qLabel,
        ...qSum,
      });
    }

    let totalRentCost = 0;
    let totalCompanyLoanCost = 0;
    for (const row of monthlyRows) {
      if (row.isProjected) continue;
      totalRentCost += row.rentCost;
      totalCompanyLoanCost += row.loanCost;
    }

    const totalTaxCost = computeRevenueTax(totalRevenue);
    const totalCost =
      totalPurchaseCost + totalSalaryCost + totalRentCost + totalCompanyLoanCost + totalTaxCost;
    const grossProfit = totalRevenue - totalCost;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      ytdCutoffLabel: cutoffStr,
      totalPurchaseCost,
      totalPurchaseNonWood,
      totalPurchaseWood,
      totalPurchaseAmortized,
      totalSalaryCost,
      totalRentCost,
      totalCompanyLoanCost,
      totalTaxCost,
      totalCost,
      totalRevenue,
      grossProfit,
      grossMargin,
      monthlyRows,
      tableRows,
      orderCount: orderRowsYtd.length,
      purchaseCount: purchaseRowsInYearYtd.length,
      payslipCount: payslipRowsYtd.length,
    };
  }, [orderRows, payslipRows, purchaseRows, annualRent, annualCompanyLoan, year, employeeBurdens, preset]);

  return { loading, error, computed, purchaseRows };
}
