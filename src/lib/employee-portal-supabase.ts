import { supabase } from "@/lib/supabase";
import type {
  AnnouncementRow,
  EmployeePortalPayload,
  EmployeeTaskRow,
  LeaveRequestRow,
  LeaveRequestStatus,
  PayslipDetailBreakdown,
  PayslipRow,
  PayslipStatus,
  TaskStatus,
  WorkProgressSeedRow,
  WorkProgressUiStatus,
} from "@/lib/employee-portal-mock";

export type FetchEmployeePortalResult =
  | { ok: true; payload: EmployeePortalPayload }
  | { ok: false; code: "no_employee" | "error"; message: string };

interface EmployeeRow {
  id: string;
  name: string;
  monthly_wage: number | null;
  annual_leave_remaining?: number | null;
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapProductionStatus(status: string | null | undefined): TaskStatus {
  const s = (status ?? "").trim();
  if (s === "進行中") return "in_progress";
  if (s === "已完成") return "done";
  return "todo";
}

function workOrderStageToUi(stage: string | null | undefined): WorkProgressUiStatus {
  const s = (stage ?? "").trim();
  if (s === "待排程" || s === "暫停") return "pending";
  if (s === "成品" || s === "已出貨") return "done";
  return "in_progress";
}

function mapLeaveStatus(raw: string | null | undefined): LeaveRequestStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved" || s === "已核准" || s === "核准") return "approved";
  if (s === "rejected" || s === "退回" || s === "拒絕") return "rejected";
  return "pending";
}

function ymLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-");
  if (!y || !m) return periodKey;
  return `${y} 年 ${Number(m)} 月`;
}

function payslipStatus(raw: string | null | undefined): PayslipStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "paid" || s === "已發放" || s === "發放") return "paid";
  return "calculating";
}

function pickEmployeeRow(emp: Record<string, unknown>): EmployeeRow {
  const alrRaw = emp.annual_leave_remaining ?? emp.special_leave_days;
  return {
    id: String(emp.id ?? ""),
    name: String(emp.name ?? ""),
    monthly_wage: (emp.monthly_wage as number | null) ?? null,
    annual_leave_remaining:
      alrRaw != null && alrRaw !== "" && Number.isFinite(Number(alrRaw)) ? Number(alrRaw) : null,
  };
}

function isMissingColumnError(message: string): boolean {
  return /could not find|column .* does not exist|schema cache/i.test(message);
}

/** 先選 annual_leave_remaining；欄位不存在時改選 special_leave_days（舊欄位） */
async function fetchEmployeeRowFlexible(
  column: string,
  value: string,
  mode: "eq" | "ilike"
): Promise<Record<string, unknown> | null> {
  const run = async (selectCols: string) => {
    let q = supabase.from("employees").select(selectCols);
    q = mode === "ilike" ? q.ilike(column, value) : q.eq(column, value);
    return q.maybeSingle();
  };

  let { data, error } = await run("id,name,monthly_wage,annual_leave_remaining");
  if (error && isMissingColumnError(error.message)) {
    const r = await run("id,name,monthly_wage,special_leave_days");
    data = r.data;
    error = r.error;
  }
  if (error || !data) return null;
  return data as unknown as Record<string, unknown>;
}

async function resolveEmployee(authUserId: string, authEmail: string | undefined): Promise<EmployeeRow | null> {
  const { data: profileExt, error: extErr } = await supabase
    .from("user_profiles")
    .select("full_name, employee_id")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (!extErr && profileExt && (profileExt as { employee_id?: string }).employee_id) {
    const eid = String((profileExt as { employee_id: string }).employee_id);
    const row = await fetchEmployeeRowFlexible("id", eid, "eq");
    if (row) return pickEmployeeRow(row);
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name")
    .eq("user_id", authUserId)
    .maybeSingle();

  const fullName = (profile?.full_name as string | undefined)?.trim() ?? "";

  if (authEmail?.trim()) {
    const e = authEmail.trim();
    let row = await fetchEmployeeRowFlexible("email", e, "eq");
    if (!row) row = await fetchEmployeeRowFlexible("email", e, "ilike");
    if (row) return pickEmployeeRow(row);
  }

  if (fullName) {
    const row = await fetchEmployeeRowFlexible("name", fullName, "eq");
    if (row) return pickEmployeeRow(row);
  }

  return null;
}

async function fetchTasksForEmployee(employeeId: string): Promise<EmployeeTaskRow[]> {
  const { data, error } = await supabase
    .from("production_tasks")
    .select(
      `
      id,
      status,
      step_name,
      notes,
      work_orders(
        planned_end_date,
        order_items(
          orders(order_number),
          product_variants(product_code),
          custom_name
        )
      )
    `
    )
    .eq("employee_id", employeeId)
    .order("id", { ascending: false })
    .limit(40);

  if (error) {
    if (/column .*employee_id|does not exist/i.test(error.message)) {
      return [];
    }
    console.warn("[employee-portal] production_tasks:", error.message);
    return [];
  }

  const rows = (data ?? []) as any[];
  return rows.map((r) => {
    const wo = Array.isArray(r.work_orders) ? r.work_orders[0] : r.work_orders;
    const oi = wo?.order_items?.[0] ?? wo?.order_items;
    const oiOne = Array.isArray(oi) ? oi[0] : oi;
    const ord = oiOne?.orders;
    const orderNum = ord?.order_number ? String(ord.order_number) : "";
    const piece =
      oiOne?.custom_name ||
      oiOne?.product_variants?.product_code ||
      (orderNum ? `訂單 ${orderNum}` : "生產任務");
    const title = [r.step_name, piece].filter(Boolean).join(" · ") || "生產任務";
    const due =
      wo?.planned_end_date != null
        ? String(wo.planned_end_date).slice(0, 10)
        : null;
    return {
      id: String(r.id),
      title,
      status: mapProductionStatus(r.status),
      due_date: due,
    };
  });
}

async function fetchWorkProgressForAssignee(employeeName: string): Promise<WorkProgressSeedRow[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select(
      `
      id,
      stage,
      assignee,
      planned_end_date,
      order_items(
        orders(order_number, expected_delivery_date)
      )
    `
    )
    .eq("assignee", employeeName)
    .order("planned_end_date", { ascending: true })
    .limit(30);

  if (error) {
    console.warn("[employee-portal] work_orders (my progress):", error.message);
    return [];
  }

  const rows = (data ?? []) as any[];
  return rows.map((r) => {
    const oi = r.order_items;
    const oiOne = Array.isArray(oi) ? oi[0] : oi;
    const ord = oiOne?.orders;
    const orderNum = ord?.order_number ? String(ord.order_number) : "";
    const orderRef = orderNum ? `WO · ${orderNum}` : `工單 ${String(r.id).slice(0, 8)}…`;
    const exp =
      r.planned_end_date != null
        ? String(r.planned_end_date).slice(0, 10)
        : ord?.expected_delivery_date != null
          ? String(ord.expected_delivery_date).slice(0, 10)
          : "—";
    return {
      id: String(r.id),
      order_ref: orderRef,
      stage_label: String(r.stage ?? "—"),
      expected_complete_date: exp,
      initial_ui_status: workOrderStageToUi(r.stage),
    };
  });
}

function mapLeaveRow(row: Record<string, unknown>, index: number): LeaveRequestRow {
  const typeLabel = String(row.leave_type ?? row.type_label ?? row.type ?? "假別");
  const start = String(row.start_date ?? row.start ?? "").slice(0, 10);
  const end = String(row.end_date ?? row.end ?? start).slice(0, 10);
  const days = num(row.total_days ?? row.days_count ?? row.days ?? 1, 1);
  const deducts =
    row.deducts_salary === true ||
    row.is_unpaid === true ||
    String(row.deducts_salary ?? "").toLowerCase() === "true";
  const nHour = (v: unknown): number | null =>
    v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  const startHour = nHour(row.start_day_start_hour ?? row.start_hour);
  const endHour = nHour(row.start_day_end_hour ?? row.end_hour);
  const endDayStartHour = nHour(row.end_day_start_hour);
  const endDayEndHour = nHour(row.end_day_end_hour);
  const hcRaw = row.hours_count;
  const hoursCount =
    hcRaw != null && hcRaw !== "" && Number.isFinite(Number(hcRaw)) ? Number(hcRaw) : null;
  const reasonRaw = row.reason;
  const reason =
    reasonRaw != null && String(reasonRaw).trim() !== "" ? String(reasonRaw).trim() : null;
  return {
    id: String(row.id ?? `lr-${index}`),
    type_label: typeLabel,
    start_date: start || "—",
    end_date: end || "—",
    status: mapLeaveStatus(String(row.status ?? "")),
    deducts_salary: deducts,
    days_count: days,
    start_hour: startHour,
    end_hour: endHour,
    end_day_start_hour: endDayStartHour,
    end_day_end_hour: endDayEndHour,
    hours_count: hoursCount,
    reason,
  };
}

async function fetchLeaveRows(employeeId: string): Promise<LeaveRequestRow[]> {
  const attempts: { col: string; val: string }[] = [
    { col: "employee_id", val: employeeId },
    { col: "employeeId", val: employeeId },
  ];

  for (const { col, val } of attempts) {
    const { data, error } = await supabase
      .from("leave_requests")
      .select("*")
      .eq(col, val)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      if (/does not exist|relation|column/i.test(error.message)) continue;
      console.warn("[employee-portal] leave_requests:", error.message);
      return [];
    }
    if (data?.length) {
      return (data as Record<string, unknown>[]).map((row, i) => mapLeaveRow(row, i));
    }
  }

  const { error: relErr } = await supabase.from("leave_requests").select("id").limit(1);
  if (relErr && /does not exist|relation/i.test(relErr.message)) {
    return [];
  }
  return [];
}

function currentMonthBounds() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0);
  const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function sumApprovedLeaveDaysInMonth(rows: LeaveRequestRow[]): number {
  const { start, end } = currentMonthBounds();
  let sum = 0;
  for (const r of rows) {
    if (r.status !== "approved") continue;
    if (r.start_date >= start && r.start_date <= end) {
      sum += r.days_count;
    }
  }
  return sum;
}

/** 與員工維護頁相同欄位：labor_employee_burden、health_employee_burden、health_employee_burden_number */
type EmployeeInsuranceSnapshot = {
  labor: number;
  health: number;
  healthPersons: number | null;
};

async function fetchEmployeeInsuranceSnapshot(employeeId: string): Promise<EmployeeInsuranceSnapshot | null> {
  const tries = [
    "labor_employee_burden, health_employee_burden, health_employee_burden_number",
    "labor_employee_burden, health_employee_burden, health_insured_persons",
    "labor_employee_burden, health_employee_burden",
    "labor_insurance, health_insurance, health_insured_persons",
  ];
  for (const cols of tries) {
    const { data, error } = await supabase.from("employees").select(cols).eq("id", employeeId).maybeSingle();
    if (error) {
      if (isMissingColumnError(error.message)) continue;
      return null;
    }
    if (!data) return null;
    const r = data as unknown as Record<string, unknown>;
    const labor = num(r.labor_employee_burden ?? r.labor_insurance, 0);
    const health = num(r.health_employee_burden ?? r.health_insurance, 0);
    const hp = r.health_employee_burden_number ?? r.health_insured_persons;
    const healthPersons =
      hp != null && hp !== "" && Number.isFinite(Number(hp))
        ? Math.max(0, Math.trunc(Number(hp)))
        : null;
    return { labor, health, healthPersons };
  }
  return null;
}

/** payslips 快照有值（含 0）則用快照；缺欄／null 則用 employees 目前資料 */
function payslipLaborHealth(
  row: Record<string, unknown>,
  snap: EmployeeInsuranceSnapshot | null,
): { labor: number; health: number; persons: number | null } {
  const laborSnap = row.labor_insurance_employee;
  const healthSnap = row.health_insurance_employee;
  const personsSnap = row.health_insured_persons;
  const labor =
    laborSnap !== undefined && laborSnap !== null && laborSnap !== ""
      ? num(laborSnap, 0)
      : (snap?.labor ?? 0);
  const health =
    healthSnap !== undefined && healthSnap !== null && healthSnap !== ""
      ? num(healthSnap, 0)
      : (snap?.health ?? 0);
  const persons =
    personsSnap !== undefined && personsSnap !== null && personsSnap !== ""
      ? Math.max(0, Math.trunc(num(personsSnap, 0)))
      : (snap?.healthPersons ?? null);
  return { labor, health, persons };
}

async function fetchPayslipRows(employeeId: string): Promise<PayslipRow[]> {
  const [ins, slipRes] = await Promise.all([
    fetchEmployeeInsuranceSnapshot(employeeId),
    supabase
      .from("payslips")
      .select("*")
      .eq("employee_id", employeeId)
      .order("period_key", { ascending: false })
      .limit(24),
  ]);

  const { data, error } = slipRes;
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return [];
    console.warn("[employee-portal] payslips:", error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const periodKey = String(row.period_key ?? row.pay_period ?? row.period ?? "").slice(0, 7);
    const pk = periodKey.length === 7 ? periodKey : String(row.id).slice(0, 12);
    const month_label =
      typeof row.month_label === "string" && row.month_label
        ? row.month_label
        : ymLabel(pk.includes("-") ? pk : `${new Date().getFullYear()}-01`);
    const net = num(row.net_pay ?? row.net_salary ?? row.net_amount ?? row.total_net, 0);
    const base = num(row.base_salary ?? row.base_pay, net);
    const overtimePay = num(
      row.bonus_and_overtime ?? row.overtime_pay ?? row.overtime_amount ?? row.bonus,
      0,
    );
    const deduct = num(row.leave_deduction ?? row.deduction, 0);
    const { labor, health, persons } = payslipLaborHealth(row, ins);
    const breakdown: PayslipDetailBreakdown = {
      base_salary: base,
      labor_insurance_employee: labor,
      health_insurance_employee: health,
      health_insured_persons: persons,
      overtime_days: num(row.overtime_days, 0),
      overtime_pay: overtimePay,
      special_leave_days_settled: num(row.special_leave_days_settled ?? row.special_leave_settled, 0),
      leave_deduction: deduct,
      other_adjust: num(row.other_adjust, 0),
      net_pay: net,
    };
    return {
      id: String(row.id),
      period_key: pk,
      month_label,
      net_pay: net,
      status: payslipStatus(String(row.status ?? "")),
      breakdown,
    };
  });
}

/**
 * 依目前登入者載入員工儀表板資料。
 * 員工對應：user_profiles.employee_id → employees；否則 employees.email；否則 user_profiles.full_name = employees.name。
 */
export async function fetchEmployeePortalFromSupabase(
  authUserId: string,
  authEmail: string | undefined
): Promise<FetchEmployeePortalResult> {
  try {
    const emp = await resolveEmployee(authUserId, authEmail);
    if (!emp) {
      return {
        ok: false,
        code: "no_employee",
        message:
          "找不到與您帳號對應的員工資料。請確認 employees 表的 email 與登入信箱一致，或由管理員在 user_profiles 設定 employee_id。",
      };
    }

    const baseSalary = num(emp.monthly_wage, 0);
    const [tasks, workProgress, leaveRows, payslips] = await Promise.all([
      fetchTasksForEmployee(emp.id),
      fetchWorkProgressForAssignee(emp.name),
      fetchLeaveRows(emp.id),
      fetchPayslipRows(emp.id),
    ]);

    const monthlyLeaveDays = sumApprovedLeaveDaysInMonth(leaveRows);

    const alrRaw = emp.annual_leave_remaining;
    const annualLeaveRemaining =
      alrRaw != null && Number.isFinite(Number(alrRaw)) ? Number(alrRaw) : null;

    const payload: EmployeePortalPayload = {
      employee: {
        id: emp.id,
        full_name: emp.name,
        base_salary: baseSalary,
        annual_leave_remaining: annualLeaveRemaining,
      },
      stats: {
        monthly_salary_ntd: baseSalary,
        monthly_overtime_days: 0,
        monthly_leave_days: monthlyLeaveDays,
      },
      announcements: [] as AnnouncementRow[],
      tasks,
      leave_requests: leaveRows,
      work_progress_seed: workProgress,
      payslips,
    };

    return { ok: true, payload };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "error", message: msg || "載入失敗" };
  }
}
