import {
  computeRevenueTax,
  DEFAULT_ANNUAL_COMPANY_LOAN,
  DEFAULT_ANNUAL_RENT,
  loadFixedOverheadForYear,
} from "@/lib/cost-statistics-settings";
import {
  purchaseCostLookbackStartYear,
  spreadPurchaseCostByMonth,
} from "@/lib/purchase-amortization";
import { supabase } from "@/lib/supabase";

/** 2026/1–2 月沿用 3 月試算時，自該金額扣除此人於 3 月之薪資（含雇主負擔） */
const SALARY_BACKFILL_EXCLUDE_NAME = "鍾語桐";

type PurchaseCostRow = {
  purchase_date: string;
  item_category?: string | null;
  tax_included_amount?: number | null;
  amount_ex_tax?: number | null;
  amortization_months?: number | null;
};

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

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function halfYearMonths(half: "H1" | "H2"): number[] {
  return half === "H1" ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
}

function halfYearCutoff(year: number, half: "H1" | "H2"): Date {
  const today = new Date();
  const end = half === "H1" ? new Date(year, 5, 30) : new Date(year, 11, 31);
  if (today < end) return today;
  return end;
}

export type HalfYearGrossProfitResult = {
  grossProfit: number;
  revenue: number;
  totalCost: number;
  cutoffLabel: string;
  monthCount: number;
};

/** 加總指定年度、半年度各月毛利（與成本統計頁相同邏輯） */
export async function fetchHalfYearGrossProfit(
  year: number,
  half: "H1" | "H2",
): Promise<HalfYearGrossProfitResult> {
  const cutoff = halfYearCutoff(year, half);
  const cutoffStr = formatLocalYmd(cutoff);
  const cutoffYm = cutoffStr.slice(0, 7);
  const months = halfYearMonths(half);

  const fixed = loadFixedOverheadForYear(year);
  const annualRent = fixed.annualRent ?? DEFAULT_ANNUAL_RENT;
  const annualCompanyLoan = fixed.annualCompanyLoanInterest ?? DEFAULT_ANNUAL_COMPANY_LOAN;

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

  if (purchaseRes.error) throw new Error(purchaseRes.error.message);
  if (orderRes.error) throw new Error(orderRes.error.message);
  if (payslipRes.error) throw new Error(payslipRes.error.message);
  if (employeeRes.error) throw new Error(employeeRes.error.message);

  const purchaseRows = (purchaseRes.data ?? []) as PurchaseCostRow[];
  const orderRows = (orderRes.data ?? []) as OrderRevenueRow[];
  const payslipRows = (payslipRes.data ?? []) as PayslipRow[];
  const employeeBurdens = (employeeRes.data ?? []) as EmployeeBurdenRow[];

  const purchaseNonWoodByMonth = new Map<string, number>();
  const purchaseWoodByMonth = new Map<string, number>();
  const salaryByMonth = new Map<string, number>();
  const revenueByMonth = new Map<string, number>();
  const burdenByEmployeeId = new Map<string, number>();

  for (const row of purchaseRows) {
    const spreads = spreadPurchaseCostByMonth(row, { cutoffYm, statYear: year });
    for (const { monthKey: key, amount, isWood } of spreads) {
      const map = isWood ? purchaseWoodByMonth : purchaseNonWoodByMonth;
      map.set(key, (map.get(key) ?? 0) + amount);
    }
  }

  for (const emp of employeeBurdens) {
    const burden =
      Number(emp.labor_employer_burden ?? 0) +
      Number(emp.health_employer_burden ?? 0) +
      Number(emp.labor_pension_employer ?? 0);
    if (Number.isFinite(burden)) burdenByEmployeeId.set(emp.id, burden);
  }

  for (const row of payslipRows) {
    if (row.status && row.status !== "paid") continue;
    const key = row.period_key && row.period_key.length >= 7 ? row.period_key.slice(0, 7) : "";
    if (!key || key > cutoffYm) continue;
    const netPay = Number(row.net_pay ?? row.net_salary ?? 0);
    if (!Number.isFinite(netPay)) continue;
    const burden =
      row.employee_id && burdenByEmployeeId.has(row.employee_id)
        ? Number(burdenByEmployeeId.get(row.employee_id) ?? 0)
        : 0;
    salaryByMonth.set(key, (salaryByMonth.get(key) ?? 0) + netPay + burden);
  }

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
    for (const row of payslipRows) {
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
    salaryByMonth.set(k1, s3Adjusted);
    salaryByMonth.set(k2, s3Adjusted);
  }

  for (const row of orderRows) {
    if ((row.status ?? "").trim() === "報價中") continue;
    const amount = Number(row.total_amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const key = (row.order_date ?? "").slice(0, 7);
    if (!key || key > cutoffYm) continue;
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + amount);
  }

  let grossProfit = 0;
  let revenue = 0;
  let totalCost = 0;
  let monthCount = 0;

  for (const m of months) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    if (key > cutoffYm) continue;

    const rl = rentLoanPortionForMonth(annualRent, annualCompanyLoan, year, m, cutoff);
    if (!rl) continue;

    const purchaseCost =
      (purchaseNonWoodByMonth.get(key) ?? 0) + (purchaseWoodByMonth.get(key) ?? 0);
    const salaryCost = salaryByMonth.get(key) ?? 0;
    const rev = revenueByMonth.get(key) ?? 0;
    const taxCost = computeRevenueTax(rev);
    const cost = purchaseCost + salaryCost + rl.rent + rl.loan + taxCost;
    grossProfit += rev - cost;
    revenue += rev;
    totalCost += cost;
    monthCount += 1;
  }

  return {
    grossProfit,
    revenue,
    totalCost,
    cutoffLabel: cutoffStr,
    monthCount,
  };
}
