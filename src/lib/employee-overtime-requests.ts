import { supabase } from "@/lib/supabase";

/**
 * 員工加班申報（overtime_requests）：
 * 員工送出 pending → 管理員於「加班審核」核准／退回；核准時由 RPC 寫入 overtime_records，
 * 折抵「補休」者同步累加 employees.comp_leave_remaining。
 */

export type OvertimeCompensationType = "pay" | "comp_leave";

export type OvertimeRequestStatus = "pending" | "approved" | "rejected" | "revoked";

export const OVERTIME_COMPENSATION_LABELS: Record<OvertimeCompensationType, string> = {
  pay: "加班費",
  comp_leave: "補休",
};

export type OvertimeRequestRow = {
  id: string;
  overtime_date: string;
  /** HH:MM */
  start_time: string;
  end_time: string;
  hours: number;
  compensation_type: OvertimeCompensationType;
  status: OvertimeRequestStatus;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OvertimeRequestAdminRow = OvertimeRequestRow & {
  employee_id: string;
  employee_name: string;
  approved_at: string | null;
  /**
   * request＝員工申報單（overtime_requests）；record＝無對應申報單的 overtime_records
   * （管理端手動補登／週末戰情核准），一律視為已核准，撤銷走 revoke_overtime_comp_leave。
   */
  source: "request" | "record";
};

export function normalizeOvertimeStatus(
  raw: string | null | undefined,
): OvertimeRequestStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "revoked") return "revoked";
  return "pending";
}

/** DB time 欄位（HH:MM:SS）→ HH:MM */
function toHm(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : s;
}

function parseHmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 起訖（HH:MM，同日）→ 小時數；格式錯誤或結束不晚於開始回 null */
export function computeOvertimeHoursFromTimes(
  startTime: string,
  endTime: string,
): number | null {
  const s = parseHmToMinutes(startTime);
  const e = parseHmToMinutes(endTime);
  if (s == null || e == null || e <= s) return null;
  return (e - s) / 60;
}

/** 是否為 0.5 小時的整數倍（DB 亦有同樣 CHECK） */
export function isHalfHourStep(hours: number): boolean {
  return Math.abs(hours * 2 - Math.round(hours * 2)) < 1e-9;
}

function mapRow(r: Record<string, unknown>): OvertimeRequestRow {
  const comp = String(r.compensation_type ?? "comp_leave");
  return {
    id: String(r.id ?? ""),
    overtime_date: String(r.overtime_date ?? "").slice(0, 10),
    start_time: toHm(r.start_time),
    end_time: toHm(r.end_time),
    hours: Number(r.hours ?? 0),
    compensation_type: comp === "pay" ? "pay" : "comp_leave",
    status: normalizeOvertimeStatus(r.status as string | null),
    reason: r.reason != null && String(r.reason).trim() ? String(r.reason) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export async function fetchEmployeeOvertimeRequests(
  employeeId: string,
): Promise<OvertimeRequestRow[]> {
  const { data, error } = await supabase
    .from("overtime_requests")
    .select(
      "id, overtime_date, start_time, end_time, hours, compensation_type, status, reason, created_at, updated_at",
    )
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.warn("[employee-overtime-requests] fetch:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

export type InsertEmployeeOvertimeInput = {
  employeeId: string;
  /** YYYY-MM-DD */
  overtimeDate: string;
  /** HH:MM */
  startTime: string;
  endTime: string;
  hours: number;
  compensationType: OvertimeCompensationType;
  reason: string | null;
};

export async function insertEmployeeOvertimeRequest(
  input: InsertEmployeeOvertimeInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("overtime_requests").insert({
    employee_id: input.employeeId,
    overtime_date: input.overtimeDate,
    start_time: input.startTime,
    end_time: input.endTime,
    hours: input.hours,
    compensation_type: input.compensationType,
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

/**
 * 管理端：全部申報單（含員工姓名）＋無對應申報單的 overtime_records
 * （手動補登／週末戰情核准），後者以「已核准」列入歷史供撤銷（立即扣回補休）。
 */
export async function fetchAllOvertimeRequests(): Promise<
  { ok: true; rows: OvertimeRequestAdminRow[] } | { ok: false; message: string }
> {
  const [reqRes, recRes] = await Promise.all([
    supabase
      .from("overtime_requests")
      .select(
        "id, employee_id, overtime_date, start_time, end_time, hours, compensation_type, status, reason, record_id, created_at, updated_at, approved_at, employees ( name )",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("overtime_records")
      .select("id, employee_id, overtime_date, hours, reason, created_at, employees ( name )")
      .order("overtime_date", { ascending: false }),
  ]);
  if (reqRes.error) return { ok: false, message: reqRes.error.message };

  const reqRows = (reqRes.data ?? []) as Record<string, unknown>[];
  const rows: OvertimeRequestAdminRow[] = reqRows.map((r) => ({
    ...mapRow(r),
    employee_id: String(r.employee_id ?? ""),
    employee_name: embedName(r.employees) ?? "—",
    approved_at: r.approved_at != null ? String(r.approved_at) : null,
    source: "request" as const,
  }));

  if (recRes.error) {
    console.warn("[employee-overtime-requests] overtime_records:", recRes.error.message);
    return { ok: true, rows };
  }

  const linkedRecordIds = new Set(
    reqRows
      .map((r) => (r.record_id != null ? String(r.record_id) : ""))
      .filter(Boolean),
  );
  for (const raw of (recRes.data ?? []) as Record<string, unknown>[]) {
    const id = String(raw.id ?? "");
    if (!id || linkedRecordIds.has(id)) continue;
    const reason = raw.reason != null && String(raw.reason).trim() ? String(raw.reason) : null;
    rows.push({
      id,
      overtime_date: String(raw.overtime_date ?? "").slice(0, 10),
      start_time: "",
      end_time: "",
      hours: Number(raw.hours ?? 0),
      // 手動補登／週末戰情皆走轉補休 RPC；reason 前綴為保險再判斷一次
      compensation_type: (reason ?? "").startsWith("【加班費】") ? "pay" : "comp_leave",
      status: "approved",
      reason,
      created_at: raw.created_at != null ? String(raw.created_at) : null,
      updated_at: null,
      employee_id: String(raw.employee_id ?? ""),
      employee_name: embedName(raw.employees) ?? "—",
      approved_at: raw.created_at != null ? String(raw.created_at) : null,
      source: "record",
    });
  }
  return { ok: true, rows };
}

/** 撤銷手動補登的加班紀錄：刪紀錄、扣回補休、移除出勤標籤（revoke_overtime_comp_leave） */
export async function revokeOvertimeRecord(
  recordId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("revoke_overtime_comp_leave", {
    p_record_id: recordId,
  });
  if (error) return { ok: false, message: error.message };
  const res = data as { ok?: boolean; error?: string } | null;
  if (res?.ok) return { ok: true };
  const code = res?.error ?? "unknown";
  const msg =
    code === "record_not_found"
      ? "找不到此加班紀錄（可能已被刪除），請重新整理"
      : (OVERTIME_RPC_ERROR_MESSAGES[code] ?? `操作失敗（${code}）`);
  return { ok: false, message: msg };
}

const OVERTIME_RPC_ERROR_MESSAGES: Record<string, string> = {
  forbidden: "僅管理員可執行此操作",
  request_not_found: "找不到此申報單，請重新整理",
  invalid_status: "申報單狀態已變更，請重新整理後再操作",
  employee_not_found: "找不到對應員工（可能已刪除）",
  already_exists: "該員工當日已有加班紀錄（可能已由手動補登建立），無法重複核准",
};

async function callOvertimeRpc(
  fn:
    | "approve_overtime_request"
    | "reject_overtime_request"
    | "revoke_overtime_request",
  requestId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc(fn, { p_request_id: requestId });
  if (error) return { ok: false, message: error.message };
  const res = data as { ok?: boolean; error?: string } | null;
  if (res?.ok) return { ok: true };
  const code = res?.error ?? "unknown";
  return { ok: false, message: OVERTIME_RPC_ERROR_MESSAGES[code] ?? `操作失敗（${code}）` };
}

export function approveOvertimeRequest(requestId: string) {
  return callOvertimeRpc("approve_overtime_request", requestId);
}

export function rejectOvertimeRequest(requestId: string) {
  return callOvertimeRpc("reject_overtime_request", requestId);
}

export function revokeOvertimeRequest(requestId: string) {
  return callOvertimeRpc("revoke_overtime_request", requestId);
}
