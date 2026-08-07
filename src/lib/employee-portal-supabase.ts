import { supabase } from "@/lib/supabase";
import { LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import { buildPayslipAttendanceRemarks } from "@/lib/payslip-attendance-remarks";
import {
  normalizeWorkOrderStage,
  syncOrderStatusFromWorkOrders,
  type WorkOrderStage,
} from "@/lib/work-order-stages";
import type {
  AnnouncementRow,
  AssigneeWorkOrderRow,
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
  comp_leave_remaining?: number | null;
  hire_date?: string | null;
  unpaid_leave_months?: string[] | null;
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 快照欄位：舊資料（欄位不存在或 NULL）回傳 null 與 0 區分 */
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM */
function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function monthBoundsFromYm(ym: string): { start: string; end: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  const last = new Date(p.y, p.m, 0);
  const end = `${p.y}-${String(p.m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const start = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
  return { start, end };
}

function spanBoundsInclusive(minYm: string, maxYm: string): { start: string; end: string } | null {
  const a = parseYm(minYm);
  const b = parseYm(maxYm);
  if (!a || !b) return null;
  const start = `${a.y}-${String(a.m).padStart(2, "0")}-01`;
  const last = new Date(b.y, b.m, 0);
  const end = `${b.y}-${String(b.m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function monthCreatedAtFilterBounds(ym: string): { gte: string; lt: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  const start = new Date(p.y, p.m - 1, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(p.y, p.m, 1, 0, 0, 0, 0);
  return { gte: start.toISOString(), lt: nextMonthStart.toISOString() };
}

function wideCreatedBounds(minYm: string, maxYm: string): { gte: string; lt: string } | null {
  const a = monthCreatedAtFilterBounds(minYm);
  const b = monthCreatedAtFilterBounds(maxYm);
  if (!a || !b) return null;
  return { gte: a.gte, lt: b.lt };
}

function mergeLeaveRowsById(rowsA: unknown[], rowsB: unknown[]): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const r of rowsA) {
    const row = r as Record<string, unknown>;
    const id = row.id != null ? String(row.id) : "";
    if (id) merged.set(id, row);
  }
  for (const r of rowsB) {
    const row = r as Record<string, unknown>;
    const id = row.id != null ? String(row.id) : "";
    if (id) merged.set(id, row);
  }
  return Array.from(merged.values());
}

/**
 * payslips.notes 為空時，依 daily_attendance／假單／加班與薪資結算中心相同規則即時產生備註。
 * （若資料表不存在或 RLS 無法讀取，維持空白。）
 */
async function enrichPayslipNotesWithAttendanceRemarks(
  employeeId: string,
  rows: PayslipRow[],
): Promise<PayslipRow[]> {
  const need = rows.filter((r) => !String(r.notes ?? "").trim());
  if (need.length === 0) return rows;

  const yms = [...new Set(rows.map((r) => r.period_key).filter((pk) => parseYm(pk) != null))] as string[];
  if (yms.length === 0) return rows;
  yms.sort();
  const minYm = yms[0]!;
  const maxYm = yms[yms.length - 1]!;
  const span = spanBoundsInclusive(minYm, maxYm);
  const createdSpan = wideCreatedBounds(minYm, maxYm);
  if (!span || !createdSpan) return rows;

  const [leaveOverlapRes, leaveCreatedRes, attRes, otRes] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", employeeId)
      .lte("start_date", span.end)
      .gte("end_date", span.start),
    supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("created_at", createdSpan.gte)
      .lt("created_at", createdSpan.lt),
    supabase
      .from("daily_attendance")
      .select(
        "employee_id, attendance_date, clock_in, clock_out, total_hours, is_abnormal, status_tags",
      )
      .eq("employee_id", employeeId)
      .gte("attendance_date", span.start)
      .lte("attendance_date", span.end),
    supabase
      .from("overtime_records")
      .select("employee_id, overtime_date, hours, reason")
      .eq("employee_id", employeeId)
      .gte("overtime_date", span.start)
      .lte("overtime_date", span.end),
  ]);

  // 與薪資結算中心相同規則：放假日自動寫入備註、抑制請假／放假日的無打卡異常
  const holidayRes = await supabase
    .from("public_holidays")
    .select("holiday_date, name, is_workday")
    .gte("holiday_date", span.start)
    .lte("holiday_date", span.end);
  const spanHolidays = ((holidayRes.data ?? []) as {
    holiday_date?: string;
    name?: string | null;
    is_workday?: boolean | null;
  }[])
    .filter((h) => h.is_workday !== true && h.holiday_date)
    .map((h) => ({
      date: String(h.holiday_date).slice(0, 10),
      name: (h.name ?? "").trim() || "臨時假日",
    }));

  let mergedLeave: Record<string, unknown>[] = [];
  if (leaveOverlapRes.error) {
    if (!/does not exist|relation|column/i.test(leaveOverlapRes.error.message)) {
      console.warn("[employee-portal] leave_requests (overlap):", leaveOverlapRes.error.message);
    }
  } else {
    mergedLeave = mergeLeaveRowsById(
      leaveOverlapRes.data ?? [],
      leaveCreatedRes.error ? [] : (leaveCreatedRes.data ?? []),
    );
    if (leaveCreatedRes.error && !/does not exist|relation|column/i.test(leaveCreatedRes.error.message)) {
      console.warn("[employee-portal] leave_requests (created_at):", leaveCreatedRes.error.message);
    }
  }

  const attList: Record<string, unknown>[] = attRes.error
    ? []
    : ((attRes.data ?? []) as Record<string, unknown>[]);
  if (attRes.error && !/does not exist|relation|column/i.test(attRes.error.message)) {
    console.warn("[employee-portal] daily_attendance:", attRes.error.message);
  }

  const otList: Record<string, unknown>[] = otRes.error
    ? []
    : ((otRes.data ?? []) as Record<string, unknown>[]);
  if (otRes.error && !/does not exist|relation|column/i.test(otRes.error.message)) {
    console.warn("[employee-portal] overtime_records:", otRes.error.message);
  }

  return rows.map((r) => {
    if (String(r.notes ?? "").trim()) return r;
    const mb = monthBoundsFromYm(r.period_key);
    if (!mb) return r;
    const attFiltered = attList.filter((row) => {
      const d = String(row.attendance_date ?? "").slice(0, 10);
      return d >= mb.start && d <= mb.end;
    });
    const otFiltered = otList.filter((row) => {
      const d = String(row.overtime_date ?? "").slice(0, 10);
      return d >= mb.start && d <= mb.end;
    });
    const generated = buildPayslipAttendanceRemarks(employeeId, {
      bounds: mb,
      payPeriodYm: r.period_key,
      attendanceRows: attFiltered,
      leaveRows: mergedLeave,
      overtimeRows: otFiltered,
      holidays: spanHolidays.filter((h) => h.date >= mb.start && h.date <= mb.end),
    }).trim();
    if (!generated) return r;
    return { ...r, notes: generated };
  });
}

function mapProductionStatus(status: string | null | undefined): TaskStatus {
  const s = (status ?? "").trim();
  if (s === "進行中") return "in_progress";
  if (s === "已完成") return "done";
  return "todo";
}

/** production_tasks.status → 進度追蹤下拉初始值 */
function productionTaskStatusToWorkProgressUi(status: string | null | undefined): WorkProgressUiStatus {
  const s = mapProductionStatus(status);
  if (s === "done") return "done";
  if (s === "in_progress") return "in_progress";
  return "pending";
}

/** 與 Kanban / DB 欄位一致（中文） */
export function workProgressUiToDbStatus(ui: WorkProgressUiStatus): string {
  if (ui === "done") return "已完成";
  if (ui === "in_progress") return "進行中";
  return "待處理";
}

/**
 * 更新 production_tasks.status。
 * 承辦身分由 RLS（employees.is_production_task_actor）判斷：production_tasks.employee_id 或 work_orders.assignee_id（employees.id）。
 */
/**
 * 負責人更新自己工單之工序；可選回寫訂單狀態（若 RLS 不允許更新 orders 則僅回傳警告）。
 */
export async function updateWorkOrderStageForAssignee(
  workOrderId: string,
  employeeId: string,
  orderId: string | null,
  stage: WorkOrderStage,
): Promise<
  | { ok: true; syncMessage?: string; syncWarning?: string }
  | { ok: false; message: string }
> {
  const eid = employeeId.trim();
  if (!eid) {
    return { ok: false, message: "缺少員工識別" };
  }

  const { data, error } = await supabase
    .from("work_orders")
    .update({ stage })
    .eq("id", workOrderId)
    .eq("assignee_id", eid)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data) {
    return { ok: false, message: "無法更新工單（可能無權限或資料已變更）" };
  }

  if (!orderId?.trim()) {
    return { ok: true };
  }

  const sync = await syncOrderStatusFromWorkOrders(supabase, orderId.trim());
  if (!sync.ok) {
    return {
      ok: true,
      syncWarning: sync.error ?? "訂單狀態未能自動同步（工序已儲存）",
    };
  }
  if (sync.nextOrderStatus) {
    return {
      ok: true,
      syncMessage: `訂單狀態已同步為「${sync.nextOrderStatus}」`,
    };
  }
  return { ok: true };
}

export async function updateProductionTaskStatusForAssignee(
  taskId: string,
  _employeeId: string,
  ui: WorkProgressUiStatus,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const status = workProgressUiToDbStatus(ui);
  const { data, error } = await supabase
    .from("production_tasks")
    .update({ status })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data) {
    return {
      ok: false,
      message: "無法更新（任務不存在、非您負責，或無權限）",
    };
  }
  return { ok: true };
}

function mapLeaveStatus(raw: string | null | undefined): LeaveRequestStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved" || s === "已核准" || s === "核准") return "approved";
  if (s === "rejected" || s === "退回" || s === "拒絕") return "rejected";
  if (s === "revoked" || s === "已撤銷" || s === "撤銷") return "revoked";
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
  const clrRaw = emp.comp_leave_remaining;
  const hireRaw = emp.hire_date;
  const unpaidRaw = emp.unpaid_leave_months;
  return {
    id: String(emp.id ?? ""),
    name: String(emp.name ?? ""),
    monthly_wage: (emp.monthly_wage as number | null) ?? null,
    annual_leave_remaining:
      alrRaw != null && alrRaw !== "" && Number.isFinite(Number(alrRaw)) ? Number(alrRaw) : null,
    comp_leave_remaining:
      clrRaw != null && clrRaw !== "" && Number.isFinite(Number(clrRaw)) ? Number(clrRaw) : null,
    hire_date: hireRaw != null && String(hireRaw).trim() ? String(hireRaw).slice(0, 10) : null,
    unpaid_leave_months: Array.isArray(unpaidRaw)
      ? unpaidRaw.map((v) => String(v)).filter((v) => v.trim() !== "")
      : null,
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

  let { data, error } = await run(
    "id,name,monthly_wage,annual_leave_remaining,comp_leave_remaining,hire_date,unpaid_leave_months",
  );
  if (error && isMissingColumnError(error.message)) {
    const r = await run(
      "id,name,monthly_wage,annual_leave_remaining,comp_leave_remaining,hire_date",
    );
    data = r.data;
    error = r.error;
  }
  if (error && isMissingColumnError(error.message)) {
    const r = await run("id,name,monthly_wage,annual_leave_remaining");
    data = r.data;
    error = r.error;
  }
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

function mergeProductionTaskRowsById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of a) map.set(String(r.id), r);
  for (const r of b) {
    const id = String(r.id);
    if (!map.has(id)) map.set(id, r);
  }
  return [...map.values()].sort((x, y) => String(y.id).localeCompare(String(x.id), undefined, { numeric: true }));
}

/** 您為負責人之工單（work_orders.assignee_id）；需能 SELECT work_orders */
async function getWorkOrdersForAssignee(employeeId: string): Promise<
  { id: string; order_item_id: string | null }[]
> {
  const eid = employeeId.trim();
  if (!eid) return [];
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, order_item_id")
    .eq("assignee_id", eid)
    .order("id", { ascending: false })
    .limit(300);

  if (error) {
    if (/column .*assignee_id|does not exist/i.test(error.message)) {
      return [];
    }
    console.warn("[employee-portal] work_orders.assignee_id:", error.message);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ""),
    order_item_id: r.order_item_id != null && String(r.order_item_id).trim() ? String(r.order_item_id) : null,
  }));
}

async function fetchProductionTasksInColumn(
  column: "work_order_id" | "order_item_id",
  ids: string[],
  select: string,
): Promise<any[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return [];

  const out: any[] = [];
  const batchSize = 120;
  for (let i = 0; i < uniq.length; i += batchSize) {
    const chunk = uniq.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("production_tasks")
      .select(select)
      .in(column, chunk)
      .order("id", { ascending: false })
      .limit(120);

    if (error) {
      if (/column .*does not exist|Could not find|schema cache/i.test(error.message)) {
        return [];
      }
      console.warn(`[employee-portal] production_tasks.${column}:`, error.message);
      return [];
    }
    if (data?.length) out.push(...data);
  }
  return out;
}

/**
 * 依工單負責人找 production_tasks：
 * 1) 巢狀篩選 work_orders.assignee_id（略過須先讀 work_orders 的 RLS）
 * 2) work_order_id / order_item_id 批次查詢（兩種 FK 並存時合併）
 */
async function fetchProductionTasksByWorkOrderAssigneeId(employeeId: string, select: string): Promise<any[]> {
  const eid = employeeId.trim();
  if (!eid) return [];

  const selectInnerWo = select.includes("work_orders!inner")
    ? select
    : select.replace(/work_orders\s*\(/, "work_orders!inner(");

  const { data: nested, error: nestedErr } = await supabase
    .from("production_tasks")
    .select(selectInnerWo)
    .eq("work_orders.assignee_id", eid)
    .order("id", { ascending: false })
    .limit(80);

  if (!nestedErr && nested?.length) {
    return nested as any[];
  }
  if (nestedErr && !/column|could not find|schema cache|assignee_id|work_orders|PGRST/i.test(nestedErr.message)) {
    console.warn("[employee-portal] production_tasks work_orders.assignee_id filter:", nestedErr.message);
  }

  const woRows = await getWorkOrdersForAssignee(employeeId);
  if (woRows.length === 0) return [];

  const woIds = woRows.map((r) => r.id).filter(Boolean);
  const oiIds = woRows.map((r) => r.order_item_id).filter((x): x is string => Boolean(x));

  const byId = new Map<string, any>();

  const add = (rows: any[]) => {
    for (const r of rows) {
      const id = String(r?.id ?? "");
      if (id) byId.set(id, r);
    }
  };

  add(await fetchProductionTasksInColumn("work_order_id", woIds, select));
  add(await fetchProductionTasksInColumn("order_item_id", oiIds, select));

  return [...byId.values()].sort((a, b) =>
    String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
  );
}

/** production_tasks 巢狀列 → 所屬訂單物件（用於排除已軟刪除之訂單） */
function orderOfProductionTaskRow(r: any): { deleted_at?: string | null } | null {
  const wo = Array.isArray(r?.work_orders) ? r.work_orders[0] : r?.work_orders;
  const oi = wo?.order_items?.[0] ?? wo?.order_items;
  const oiOne = Array.isArray(oi) ? oi[0] : oi;
  const ord = oiOne?.orders;
  return (Array.isArray(ord) ? ord[0] : ord) ?? null;
}

async function fetchTasksForEmployee(employeeId: string): Promise<EmployeeTaskRow[]> {
  const select = `
      id,
      status,
      step_name,
      notes,
      work_orders(
        planned_end_date,
        order_items(
          orders(order_number, deleted_at),
          product_variants(product_code),
          custom_name
        )
      )
    `;

  const { data: byEmp, error } = await supabase
    .from("production_tasks")
    .select(select)
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

  const taskSelectWo = `
      id,
      status,
      step_name,
      notes,
      work_orders(
        assignee_id,
        planned_end_date,
        order_items(
          orders(order_number, deleted_at),
          product_variants(product_code),
          custom_name
        )
      )
    `;
  const byWoAssignee = await fetchProductionTasksByWorkOrderAssigneeId(employeeId, taskSelectWo);
  const rows = mergeProductionTaskRowsById((byEmp ?? []) as any[], byWoAssignee).slice(0, 40);

  return rows
    .filter((r) => !orderOfProductionTaskRow(r)?.deleted_at)
    .map((r) => {
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

/**
 * 生產交辦：production_tasks.employee_id 為您，或所屬工單之負責人為您（work_orders.assignee_id = 登入員工 id）。
 */
async function fetchWorkProgressFromProductionTasks(employeeId: string): Promise<WorkProgressSeedRow[]> {
  const select = `
      id,
      status,
      step_name,
      work_orders(
        assignee_id,
        planned_end_date,
        order_items(
          orders(order_number, expected_delivery_date, deleted_at),
          product_variants(product_code),
          custom_name
        )
      )
    `;

  const { data: byEmp, error } = await supabase
    .from("production_tasks")
    .select(select)
    .eq("employee_id", employeeId)
    .order("id", { ascending: false })
    .limit(40);

  if (error) {
    if (/column .*employee_id|does not exist/i.test(error.message)) {
      return [];
    }
    console.warn("[employee-portal] production_tasks (work progress):", error.message);
    return [];
  }

  const byWoAssignee = await fetchProductionTasksByWorkOrderAssigneeId(employeeId, select);
  const rows = mergeProductionTaskRowsById((byEmp ?? []) as any[], byWoAssignee).slice(0, 40);

  return rows
    .filter((r) => !orderOfProductionTaskRow(r)?.deleted_at)
    .map((r) => {
    const wo = Array.isArray(r.work_orders) ? r.work_orders[0] : r.work_orders;
    const oi = wo?.order_items?.[0] ?? wo?.order_items;
    const oiOne = Array.isArray(oi) ? oi[0] : oi;
    const ord = oiOne?.orders;
    const orderNum = ord?.order_number ? String(ord.order_number) : "";
    const piece =
      oiOne?.custom_name ||
      oiOne?.product_variants?.product_code ||
      (orderNum ? `訂單 ${orderNum}` : "生產物件");
    const orderRef = orderNum ? `WO · ${orderNum}` : String(piece);
    const exp =
      wo?.planned_end_date != null
        ? String(wo.planned_end_date).slice(0, 10)
        : ord?.expected_delivery_date != null
          ? String(ord.expected_delivery_date).slice(0, 10)
          : "—";
    return {
      id: String(r.id),
      order_ref: orderRef,
      stage_label: String(r.step_name ?? "—").trim() || "—",
      expected_complete_date: exp,
      initial_ui_status: productionTaskStatusToWorkProgressUi(r.status),
    };
  });
}

function mapLeaveRow(row: Record<string, unknown>, index: number): LeaveRequestRow {
  const typeLabel = String(row.leave_type ?? row.type_label ?? row.type ?? "假別");
  const start = String(row.start_date ?? row.start ?? "").slice(0, 10);
  const end = String(row.end_date ?? row.end ?? start).slice(0, 10);
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
  // total_days 舊欄位曾為 numeric(4,1)（0.125 天會被進位成 0.1），優先以 hours_count 反推
  const days =
    hoursCount != null && hoursCount > 0
      ? hoursCount / LEAVE_WORK_DAY_HOURS
      : num(row.total_days ?? row.days_count ?? row.days ?? 1, 1);
  const reasonRaw = row.reason;
  const reason =
    reasonRaw != null && String(reasonRaw).trim() !== "" ? String(reasonRaw).trim() : null;
  const createdAt =
    row.created_at != null ? String(row.created_at) : row.inserted_at != null ? String(row.inserted_at) : null;
  const updatedAt = row.updated_at != null ? String(row.updated_at) : null;
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
    created_at: createdAt,
    updated_at: updatedAt,
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

/** 與員工維護頁相同欄位；health 為健保自付「合計」（每人 × 加保人數，與結算一致） */
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
    /** 與 salary-settlement-center mapRowToSettlementEmployee：健保自付「每人」× 加保人數（人數未填或 ≤0 時乘數為 1） */
    const healthPerPerson = num(r.health_employee_burden ?? r.health_insurance, 0);
    const hp = r.health_employee_burden_number ?? r.health_insured_persons;
    const healthPersons =
      hp != null && hp !== "" && Number.isFinite(Number(hp))
        ? Math.max(0, Math.trunc(Number(hp)))
        : null;
    const healthMult =
      healthPersons != null && healthPersons > 0 ? healthPersons : 1;
    const health = Math.round(healthPerPerson * healthMult);
    return { labor, health, healthPersons };
  }
  return null;
}

/**
 * payslips 快照有值則用快照；缺欄／null 則用 employees 目前資料。
 * 若結算時曾剝除明細欄位（表尚無欄位），或 migration 的 DEFAULT 0 讓兩者皆為 0，
 * 但員工主檔已有勞健保金額，則改以主檔快照顯示（與薪資結算中心提示一致）。
 */
function payslipLaborHealth(
  row: Record<string, unknown>,
  snap: EmployeeInsuranceSnapshot | null,
): { labor: number; health: number; persons: number | null } {
  const laborSnap = row.labor_insurance_employee;
  const healthSnap = row.health_insurance_employee;
  const personsSnap = row.health_insured_persons;
  let labor =
    laborSnap !== undefined && laborSnap !== null && laborSnap !== ""
      ? num(laborSnap, 0)
      : (snap?.labor ?? 0);
  let health =
    healthSnap !== undefined && healthSnap !== null && healthSnap !== ""
      ? num(healthSnap, 0)
      : (snap?.health ?? 0);
  let persons =
    personsSnap !== undefined && personsSnap !== null && personsSnap !== ""
      ? Math.max(0, Math.trunc(num(personsSnap, 0)))
      : (snap?.healthPersons ?? null);

  /** 僅在薪資單像「未寫入明細」（預設 0 且無加保人數）時才用主檔，避免覆蓋已結算為 0 的紀錄 */
  const personsUnset =
    personsSnap === undefined || personsSnap === null || personsSnap === "";
  const slipLooksUnset =
    labor === 0 &&
    health === 0 &&
    personsUnset &&
    snap != null &&
    (snap.labor > 0 || snap.health > 0);
  if (slipLooksUnset) {
    labor = snap.labor;
    health = snap.health;
    persons = snap.healthPersons ?? null;
  }

  return { labor, health, persons };
}

function mapWorkOrderRowToAssigneePortal(r: Record<string, unknown>): AssigneeWorkOrderRow {
  const oiRaw = r.order_items as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const oi = Array.isArray(oiRaw) ? oiRaw[0] : oiRaw;
  const variant = oi?.product_variants as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const pv = Array.isArray(variant) ? variant[0] : variant;
  const ord = oi?.orders as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const orderObj = Array.isArray(ord) ? ord[0] : ord;
  const customerRel = orderObj?.customers as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const cust = Array.isArray(customerRel) ? customerRel[0] : customerRel;

  const customerName = cust?.name != null ? String(cust.name) : "";
  const customerAlias =
    cust?.alias != null && String(cust.alias).trim() ? String(cust.alias) : null;

  let itemName = "";
  if (oi?.custom_name) {
    itemName = String(oi.custom_name);
  } else if (pv?.product_code) {
    itemName = String(pv.product_code);
  }

  const cat = (oi?.custom_category as string | null | undefined)?.trim() ?? "";

  const w = oi?.custom_dimension_w ?? pv?.dimension_w ?? null;
  const d = oi?.custom_dimension_d ?? pv?.dimension_d ?? null;
  const h = oi?.custom_dimension_h ?? pv?.dimension_h ?? null;
  const parts = [w, d, h].filter((x) => x != null);
  const dim =
    parts.length === 0 ? "" : `W:${w ?? "—"} x D:${d ?? "—"} x H:${h ?? "—"}`;
  const fullNameParts = [itemName, dim].filter((s) => typeof s === "string" && s.trim()) as string[];
  const item_size_label = fullNameParts.length ? fullNameParts.join(" / ") : "—";

  const order_number = orderObj?.order_number != null ? String(orderObj.order_number) : "";
  const order_id = orderObj?.id != null ? String(orderObj.id) : null;
  const expected_delivery_date =
    orderObj?.expected_delivery_date != null
      ? String(orderObj.expected_delivery_date).slice(0, 10)
      : null;
  const order_status = orderObj?.status != null ? String(orderObj.status) : null;
  const shipping_contact_name =
    orderObj?.shipping_contact_name != null && String(orderObj.shipping_contact_name).trim()
      ? String(orderObj.shipping_contact_name).trim()
      : null;

  return {
    id: String(r.id ?? ""),
    order_id,
    order_number,
    customer_name: customerName,
    customer_alias: customerAlias,
    shipping_contact_name,
    item_size_label,
    quantity: Number(oi?.quantity ?? 0),
    category: cat,
    stage: normalizeWorkOrderStage(r.stage as string | null | undefined),
    planned_start_date:
      r.planned_start_date != null ? String(r.planned_start_date).slice(0, 10) : null,
    planned_end_date:
      r.planned_end_date != null ? String(r.planned_end_date).slice(0, 10) : null,
    expected_delivery_date,
    order_status,
  };
}

/** 生產交辦：您為負責人之工單（work_orders.assignee_id） */
async function fetchAssigneeWorkOrders(employeeId: string): Promise<AssigneeWorkOrderRow[]> {
  const eid = employeeId.trim();
  if (!eid) return [];

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      `
      id,
      stage,
      planned_start_date,
      planned_end_date,
      order_items(
        id,
        custom_name,
        custom_category,
        custom_dimension_w,
        custom_dimension_d,
        custom_dimension_h,
        quantity,
        orders(
          id,
          order_number,
          status,
          deleted_at,
          expected_delivery_date,
          shipping_contact_name,
          customers(name, alias)
        ),
        product_variants(
          product_code,
          dimension_w,
          dimension_d,
          dimension_h
        )
      )
    `,
    )
    .eq("assignee_id", eid)
    .order("planned_start_date", { ascending: true, nullsFirst: false })
    .limit(80);

  if (error) {
    if (/column .*assignee_id|does not exist/i.test(error.message)) {
      return [];
    }
    console.warn("[employee-portal] work_orders (assignee):", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row: any) => {
      const oi = Array.isArray(row.order_items) ? row.order_items[0] : row.order_items;
      const ord = Array.isArray(oi?.orders) ? oi.orders[0] : oi?.orders;
      return !ord?.deleted_at;
    })
    .map((row) => mapWorkOrderRowToAssigneePortal(row as Record<string, unknown>));
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

  const mapped = (data ?? []).map((row: Record<string, unknown>) => {
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
      special_leave_remaining_after: numOrNull(row.special_leave_remaining_after),
      comp_leave_remaining_after: numOrNull(row.comp_leave_remaining_after),
      leave_days: num(row.leave_days ?? row.deductible_leave_days, 0),
      other_leave_days: num(row.other_leave_days, 0),
      other_leave_detail:
        typeof row.other_leave_detail === "string" && row.other_leave_detail.trim()
          ? row.other_leave_detail.trim()
          : null,
      payroll_bonus: num(row.payroll_bonus, 0),
      leave_deduction: deduct,
      other_adjust: num(row.other_adjust, 0),
      net_pay: net,
    };
    const notesStr = String(row.notes ?? "").trim();
    const notes = notesStr ? notesStr : null;

    return {
      id: String(row.id),
      period_key: pk,
      month_label,
      net_pay: net,
      status: payslipStatus(String(row.status ?? "")),
      breakdown,
      notes,
    };
  });

  return enrichPayslipNotesWithAttendanceRemarks(employeeId, mapped);
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
    const [tasks, workProgress, assigneeWorkOrders, leaveRows, payslips] = await Promise.all([
      fetchTasksForEmployee(emp.id),
      fetchWorkProgressFromProductionTasks(emp.id),
      fetchAssigneeWorkOrders(emp.id),
      fetchLeaveRows(emp.id),
      fetchPayslipRows(emp.id),
    ]);

    const monthlyLeaveDays = sumApprovedLeaveDaysInMonth(leaveRows);

    const alrRaw = emp.annual_leave_remaining;
    const annualLeaveRemaining =
      alrRaw != null && Number.isFinite(Number(alrRaw)) ? Number(alrRaw) : null;
    const clrRaw = emp.comp_leave_remaining;
    const compLeaveRemaining =
      clrRaw != null && Number.isFinite(Number(clrRaw)) ? Number(clrRaw) : null;

    const payload: EmployeePortalPayload = {
      employee: {
        id: emp.id,
        full_name: emp.name,
        base_salary: baseSalary,
        annual_leave_remaining: annualLeaveRemaining,
        comp_leave_remaining: compLeaveRemaining,
        hire_date: emp.hire_date ?? null,
        unpaid_leave_months: emp.unpaid_leave_months ?? null,
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
      assignee_work_orders: assigneeWorkOrders,
      payslips,
    };

    return { ok: true, payload };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "error", message: msg || "載入失敗" };
  }
}
