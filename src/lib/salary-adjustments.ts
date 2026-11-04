import { supabase } from "@/lib/supabase";

/**
 * 調薪（salary_adjustments，migration 20261104140000）。
 * 薪資結算依「結算月份」取當月生效的月薪與勞健保自付額：可提前登記，生效月份前的薪資不受影響。
 */

export type SalaryAdjustment = {
  id: string;
  employee_id: string;
  /** YYYY-MM */
  effective_month: string;
  old_wage: number;
  new_wage: number;
  old_labor_insurance_bracket: number | null;
  new_labor_insurance_bracket: number | null;
  old_labor_employee_burden: number | null;
  new_labor_employee_burden: number | null;
  old_health_employee_burden: number | null;
  new_health_employee_burden: number | null;
  reason: string;
  applied_at: string | null;
  created_at: string;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSalaryAdjustment(r: Record<string, unknown>): SalaryAdjustment {
  return {
    id: String(r.id),
    employee_id: String(r.employee_id),
    effective_month: String(r.effective_month),
    old_wage: numOrNull(r.old_wage) ?? 0,
    new_wage: numOrNull(r.new_wage) ?? 0,
    old_labor_insurance_bracket: numOrNull(r.old_labor_insurance_bracket),
    new_labor_insurance_bracket: numOrNull(r.new_labor_insurance_bracket),
    old_labor_employee_burden: numOrNull(r.old_labor_employee_burden),
    new_labor_employee_burden: numOrNull(r.new_labor_employee_burden),
    old_health_employee_burden: numOrNull(r.old_health_employee_burden),
    new_health_employee_burden: numOrNull(r.new_health_employee_burden),
    reason: String(r.reason ?? ""),
    applied_at: r.applied_at == null ? null : String(r.applied_at),
    created_at: String(r.created_at ?? ""),
  };
}

export type PayrollProfile = {
  wage: number;
  laborInsuranceBracket: number | null;
  laborEmployeeBurden: number;
  /** 健保自付「每人」金額 */
  healthEmployeeBurden: number;
};

type FieldKey = "wage" | "labor_insurance_bracket" | "labor_employee_burden" | "health_employee_burden";

function oldNew(a: SalaryAdjustment, key: FieldKey): { old: number | null; next: number | null } {
  switch (key) {
    case "wage":
      return { old: a.old_wage, next: a.new_wage };
    case "labor_insurance_bracket":
      return { old: a.old_labor_insurance_bracket, next: a.new_labor_insurance_bracket };
    case "labor_employee_burden":
      return { old: a.old_labor_employee_burden, next: a.new_labor_employee_burden };
    case "health_employee_burden":
      return { old: a.old_health_employee_burden, next: a.new_health_employee_burden };
  }
}

/**
 * 某欄位在結算月份的值：
 * - 該月（含）以前最近一次有調整該欄位 → 該次的新值
 * - 否則，之後第一次調整該欄位的「調整前」值
 * - 都沒有 → 目前資料
 */
function fieldForPeriod(
  sorted: readonly SalaryAdjustment[],
  period: string,
  key: FieldKey,
  current: number | null,
): number | null {
  let applied: number | null | undefined;
  for (const a of sorted) {
    if (a.effective_month > period) break;
    const { next } = oldNew(a, key);
    if (next != null) applied = next;
  }
  if (applied !== undefined) return applied;
  const firstLater = sorted.find((a) => a.effective_month > period && oldNew(a, key).next != null);
  if (firstLater) return oldNew(firstLater, key).old;
  return current;
}

/** 單一員工在結算月份適用的月薪與勞健保自付額 */
export function payrollProfileForPeriod(
  adjustments: readonly SalaryAdjustment[],
  period: string,
  current: PayrollProfile,
): PayrollProfile {
  const sorted = [...adjustments].sort((a, b) => a.effective_month.localeCompare(b.effective_month));
  return {
    wage: fieldForPeriod(sorted, period, "wage", current.wage) ?? current.wage,
    laborInsuranceBracket: fieldForPeriod(
      sorted,
      period,
      "labor_insurance_bracket",
      current.laborInsuranceBracket,
    ),
    laborEmployeeBurden:
      fieldForPeriod(sorted, period, "labor_employee_burden", current.laborEmployeeBurden) ??
      current.laborEmployeeBurden,
    healthEmployeeBurden:
      fieldForPeriod(sorted, period, "health_employee_burden", current.healthEmployeeBurden) ??
      current.healthEmployeeBurden,
  };
}

/**
 * 休息日加班「每日」基準金額：與 employees.overtime_rate 產生欄位同一公式
 * （前 2 小時 × 4/3、後 6 小時 × 5/3，時薪＝月薪 ÷ 240）。
 */
export function overtimeDailyRateFromWage(monthlyWage: number): number {
  const hourly = monthlyWage / 240;
  return Math.round(hourly * (4 / 3) * 2 + hourly * (5 / 3) * 6);
}

function money(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("zh-TW");
}

/** 薪資單備註的調薪行前綴；重新產生備註時以此移除舊行 */
export const SALARY_ADJUST_REMARK_RE = /^調薪：/;

/** 「調薪：月薪 36,000 → 38,000（2027-01 起；年度調薪；勞保自付 915 → 960）」 */
export function formatSalaryAdjustmentRemark(a: SalaryAdjustment): string {
  const parts = [`${a.effective_month} 起`, a.reason.trim()].filter(Boolean);
  if (a.new_labor_insurance_bracket != null && a.new_labor_insurance_bracket !== a.old_labor_insurance_bracket) {
    parts.push(`勞保投保 ${money(a.old_labor_insurance_bracket)} → ${money(a.new_labor_insurance_bracket)}`);
  }
  if (a.new_labor_employee_burden != null && a.new_labor_employee_burden !== a.old_labor_employee_burden) {
    parts.push(`勞保自付 ${money(a.old_labor_employee_burden)} → ${money(a.new_labor_employee_burden)}`);
  }
  if (a.new_health_employee_burden != null && a.new_health_employee_burden !== a.old_health_employee_burden) {
    parts.push(`健保自付 ${money(a.old_health_employee_burden)} → ${money(a.new_health_employee_burden)}`);
  }
  return `調薪：月薪 ${money(a.old_wage)} → ${money(a.new_wage)}（${parts.join("；")}）`;
}

/** YYYY-MM 的下一個月 */
export function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 台北時間當月 YYYY-MM */
export function currentTaipeiMonth(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).slice(0, 7);
}

function isMissingRelation(message: string): boolean {
  return /does not exist|relation|schema cache|could not find/i.test(message);
}

/** 載入員工的調薪紀錄（依生效月份排序）；資料表尚未建立時回傳空陣列 */
export async function fetchSalaryAdjustments(employeeIds: readonly string[]): Promise<SalaryAdjustment[]> {
  if (employeeIds.length === 0) return [];
  const { data, error } = await supabase
    .from("salary_adjustments")
    .select("*")
    .in("employee_id", employeeIds as string[])
    .order("effective_month", { ascending: true });
  if (error) {
    if (isMissingRelation(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeSalaryAdjustment);
}

/** 員工最新已發放的薪資月份（YYYY-MM）；沒有則 null */
export async function fetchLatestPaidMonth(employeeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("payslips")
    .select("period_key, status")
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  let latest: string | null = null;
  for (const r of (data ?? []) as { period_key?: unknown; status?: unknown }[]) {
    const s = String(r.status ?? "").trim().toLowerCase();
    if (s !== "paid" && s !== "已發放" && s !== "發放") continue;
    const pk = String(r.period_key ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(pk) && (latest == null || pk > latest)) latest = pk;
  }
  return latest;
}

export type SalaryRpcResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; message: string };

function salaryErrorMessage(payload: Record<string, unknown>): string {
  switch (payload.error) {
    case "forbidden":
      return "只有管理員可以調薪。";
    case "invalid_month":
      return "生效月份格式不正確。";
    case "invalid_wage":
      return "新月薪必須大於 0。";
    case "reason_required":
      return "請填寫調薪原因。";
    case "employee_not_found":
      return "找不到員工資料。";
    case "month_paid":
      return `生效月份不能選已發放的月份（最新已發放：${String(payload.latest_paid ?? "")}）。追溯補發請用結算頁的「調整」欄。`;
    case "not_after_latest":
      return `生效月份必須晚於最近一次調薪（${String(payload.latest_month ?? "")}）。要修改請先取消最近一筆。`;
    case "not_latest":
      return "只能取消最近一筆調薪。";
    case "not_found":
      return "找不到這筆調薪，請重新整理。";
    default:
      return payload.error ? `操作失敗（${String(payload.error)}）` : "操作失敗";
  }
}

async function callSalaryRpc<T>(
  fn: "create_salary_adjustment" | "cancel_salary_adjustment",
  args: Record<string, unknown>,
): Promise<SalaryRpcResult<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 兩支 RPC 參數不同，於包裝函式約束
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) {
    if (/could not find the function|does not exist|schema cache/i.test(error.message)) {
      return { ok: false, message: "資料庫尚未套用調薪 migration（salary_adjustments），請先套用。" };
    }
    return { ok: false, message: error.message };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) return { ok: false, message: salaryErrorMessage(payload) };
  return { ok: true, data: payload as T };
}

/** 建立調薪；投保欄位傳 null＝不變 */
export function createSalaryAdjustmentRpc(input: {
  employeeId: string;
  effectiveMonth: string;
  newWage: number;
  reason: string;
  laborInsuranceBracket: number | null;
  laborEmployeeBurden: number | null;
  healthEmployeeBurden: number | null;
}) {
  return callSalaryRpc<{ id: string; old_wage: number; applied: boolean }>("create_salary_adjustment", {
    p_employee_id: input.employeeId,
    p_effective_month: input.effectiveMonth,
    p_new_wage: input.newWage,
    p_reason: input.reason,
    ...(input.laborInsuranceBracket != null ? { p_labor_insurance_bracket: input.laborInsuranceBracket } : {}),
    ...(input.laborEmployeeBurden != null ? { p_labor_employee_burden: input.laborEmployeeBurden } : {}),
    ...(input.healthEmployeeBurden != null ? { p_health_employee_burden: input.healthEmployeeBurden } : {}),
  });
}

export function cancelSalaryAdjustmentRpc(id: string) {
  return callSalaryRpc<Record<string, never>>("cancel_salary_adjustment", { p_id: id });
}
