import { supabase } from "@/lib/supabase";
import { formatHoursAsDayHour } from "@/lib/employee-leave-time";

/**
 * 特休／補休餘額相關 RPC（migration 20261104110000_leave_balance_ledger.sql）。
 * 一律回傳 { ok: true, data } 或 { ok: false, message }（中文錯誤訊息）。
 */

export type RpcResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; message: string };

function errorMessage(code: string | undefined, payload: Record<string, unknown>): string {
  switch (code) {
    case "forbidden":
      return "只有管理員可以執行此操作。";
    case "not_found":
      return "找不到資料，請重新整理後再試。";
    case "invalid_status":
      return "狀態已變更（可能已被其他人處理），請重新整理後再試。";
    case "invalid_hours":
      return "時數不正確。";
    case "invalid_days":
      return "天數必須大於 0。";
    case "invalid_kind":
      return "假別不正確。";
    case "no_balance":
      return "員工尚未設定餘額，請先到員工資料調整。";
    case "insufficient_balance": {
      const bal = Number(payload.balance_hours);
      const hrs = Number(payload.hours);
      return `餘額不足：剩 ${formatHoursAsDayHour(bal)}，本次 ${formatHoursAsDayHour(hrs)}。請先調整餘額或退回假單。`;
    }
    case "note_required":
      return "請填寫原因。";
    case "already_granted":
      return "這個年資特休已經核准過了。";
    case "employee_not_found":
      return "找不到員工資料。";
    case "leave_not_approved":
      return "假單已不是核准狀態，無法回補。";
    default:
      return code ? `操作失敗（${code}）` : "操作失敗";
  }
}

async function call<T = Record<string, unknown>>(
  fn: Parameters<typeof supabase.rpc>[0],
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各 RPC 參數型別不同，於下方包裝函式約束
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) {
    if (/could not find the function|does not exist|schema cache/i.test(error.message)) {
      return { ok: false, message: "資料庫尚未套用新版假勤 migration（leave_balance_ledger），請先套用後再操作。" };
    }
    return { ok: false, message: error.message };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) {
    return { ok: false, message: errorMessage(payload.error as string | undefined, payload) };
  }
  return { ok: true, data: payload as T };
}

/** 核准假單；特休／補休立即自餘額扣除。hours／note：扣掉送單後新增放假日時傳入 */
export function approveLeaveRequestRpc(leaveId: string, hours?: number | null, note?: string | null) {
  return call<{ kind: string | null; hours: number; balance_after_hours: number | null }>("approve_leave_request", {
    p_leave_id: leaveId,
    ...(hours != null ? { p_hours: hours } : {}),
    ...(note ? { p_note: note } : {}),
  });
}

/** 撤銷已核准假單；特休／補休自動退回 */
export function revokeLeaveRequestRpc(leaveId: string, reason: string | null) {
  return call<{ kind: string | null; refund_hours: number }>("revoke_leave_request", {
    p_leave_id: leaveId,
    p_reason: reason ?? "",
  });
}

/** 核准年資特休（天數可與法定不同，不同時原因必填），核准即入帳 */
export function approveAnnualLeaveGrantRpc(input: {
  employeeId: string;
  milestoneYears: number;
  days: number;
  statutoryDays: number;
  note: string | null;
}) {
  return call<{ grant_id: string; balance_after_hours: number }>("approve_annual_leave_grant", {
    p_employee_id: input.employeeId,
    p_milestone_years: input.milestoneYears,
    p_days: input.days,
    p_statutory_days: input.statutoryDays,
    p_note: input.note ?? "",
  });
}

/** 人工調整特休／補休（小時；正數增加、負數扣除），原因必填 */
export function adjustLeaveBalanceRpc(employeeId: string, kind: "annual" | "comp", deltaHours: number, note: string) {
  return call<{ balance_after_hours: number }>("adjust_leave_balance", {
    p_employee_id: employeeId,
    p_kind: kind,
    p_delta_hours: deltaHours,
    p_note: note,
  });
}

/** 假日回補單：核准（扣回假單時數、退回特休／補休）或不回補 */
export function decideHolidayRefundRpc(refundId: string, approve: boolean, reason?: string | null) {
  return call<{ approved: boolean; kind: string | null; hours: number; refund_hours: number }>(
    "decide_holiday_refund",
    { p_refund_id: refundId, p_approve: approve, p_reason: reason ?? "" },
  );
}

/** 薪資發放後：把列入備註的異動標記為該月份 */
export function markLedgerPayslipRpc(employeeId: string, period: string, ids: string[]) {
  return call<{ marked: number }>("mark_leave_ledger_payslip", {
    p_employee_id: employeeId,
    p_period: period,
    p_ids: ids,
  });
}

/** 刪除已發放薪資單：異動回到「尚未列入備註」 */
export function unmarkLedgerPayslipRpc(employeeId: string, period: string) {
  return call<{ unmarked: number }>("unmark_leave_ledger_payslip", {
    p_employee_id: employeeId,
    p_period: period,
  });
}
