import { supabase } from "@/lib/supabase";

/**
 * 員工補打卡申請（makeup_punch_requests）：
 * 員工忘打卡時送出 pending → 管理員於「假單/加班審核」核准／退回；
 * 核准後由 RPC 即時寫回 daily_attendance（已匯入時），月底出勤戰情室匯入時亦會自動併入缺卡側。
 * 已發放（paid）月份不可核准／撤銷。
 */

export type MakeupPunchRequestStatus = "pending" | "approved" | "rejected" | "revoked";

export type MakeupPunchRequestRow = {
  id: string;
  /** YYYY-MM-DD */
  punch_date: string;
  /** HH:MM；null 表示不補這側 */
  clock_in: string | null;
  clock_out: string | null;
  status: MakeupPunchRequestStatus;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MakeupPunchRequestAdminRow = MakeupPunchRequestRow & {
  employee_id: string;
  employee_name: string;
  approved_at: string | null;
};

export function normalizeMakeupPunchStatus(
  raw: string | null | undefined,
): MakeupPunchRequestStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "revoked") return "revoked";
  return "pending";
}

/** DB time 欄位（HH:MM:SS）→ HH:MM；null 保持 null */
function toHmOrNull(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : s;
}

function mapRow(r: Record<string, unknown>): MakeupPunchRequestRow {
  return {
    id: String(r.id ?? ""),
    punch_date: String(r.punch_date ?? "").slice(0, 10),
    clock_in: toHmOrNull(r.clock_in),
    clock_out: toHmOrNull(r.clock_out),
    status: normalizeMakeupPunchStatus(r.status as string | null),
    reason: r.reason != null && String(r.reason).trim() ? String(r.reason) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export async function fetchEmployeeMakeupPunchRequests(
  employeeId: string,
): Promise<MakeupPunchRequestRow[]> {
  const { data, error } = await supabase
    .from("makeup_punch_requests")
    .select("id, punch_date, clock_in, clock_out, status, reason, created_at, updated_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.warn("[employee-makeup-punch-requests] fetch:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

export type InsertEmployeeMakeupPunchInput = {
  employeeId: string;
  /** YYYY-MM-DD */
  punchDate: string;
  /** HH:MM；null 表示不補這側（至少一側必填，DB 亦有 CHECK） */
  clockIn: string | null;
  clockOut: string | null;
  reason: string | null;
};

export async function insertEmployeeMakeupPunchRequest(
  input: InsertEmployeeMakeupPunchInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("makeup_punch_requests").insert({
    employee_id: input.employeeId,
    punch_date: input.punchDate,
    clock_in: input.clockIn,
    clock_out: input.clockOut,
    status: "pending",
    reason: input.reason,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

function embedName(rel: unknown): string | null {
  if (rel == null) return null;
  const o = Array.isArray(rel) ? rel[0] : rel;
  if (o && typeof o === "object" && "name" in o) {
    const n = (o as { name?: unknown }).name;
    return n != null ? String(n) : null;
  }
  return null;
}

/** 管理端：全部補卡申請單（含員工姓名） */
export async function fetchAllMakeupPunchRequests(): Promise<
  { ok: true; rows: MakeupPunchRequestAdminRow[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from("makeup_punch_requests")
    .select(
      "id, employee_id, punch_date, clock_in, clock_out, status, reason, created_at, updated_at, approved_at, employees ( name )",
    )
    .order("created_at", { ascending: false });
  if (error) return { ok: false, message: error.message };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...mapRow(r),
    employee_id: String(r.employee_id ?? ""),
    employee_name: embedName(r.employees) ?? "—",
    approved_at: r.approved_at != null ? String(r.approved_at) : null,
  }));
  return { ok: true, rows };
}

const MAKEUP_RPC_ERROR_MESSAGES: Record<string, string> = {
  forbidden: "僅管理員可執行此操作",
  request_not_found: "找不到此申請單，請重新整理",
  invalid_status: "申請單狀態已變更，請重新整理後再操作",
  employee_not_found: "找不到對應員工（可能已刪除）",
  month_settled: "該月份薪資已發放，出勤依據已凍結；如需調整請人工處理",
};

async function callMakeupRpc(
  fn:
    | "approve_makeup_punch_request"
    | "reject_makeup_punch_request"
    | "revoke_makeup_punch_request",
  requestId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc(fn, { p_request_id: requestId });
  if (error) return { ok: false, message: error.message };
  const res = data as { ok?: boolean; error?: string } | null;
  if (res?.ok) return { ok: true };
  const code = res?.error ?? "unknown";
  return { ok: false, message: MAKEUP_RPC_ERROR_MESSAGES[code] ?? `操作失敗（${code}）` };
}

export function approveMakeupPunchRequest(requestId: string) {
  return callMakeupRpc("approve_makeup_punch_request", requestId);
}

export function rejectMakeupPunchRequest(requestId: string) {
  return callMakeupRpc("reject_makeup_punch_request", requestId);
}

export function revokeMakeupPunchRequest(requestId: string) {
  return callMakeupRpc("revoke_makeup_punch_request", requestId);
}
