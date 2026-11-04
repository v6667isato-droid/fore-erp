import { supabase } from "@/lib/supabase";
import { formatHoursAsDayHour, LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import {
  isAnnualLeaveTypeName,
  isCompLeaveTypeName,
  leaveRequestTotalHours,
} from "@/lib/leave-hours";

/**
 * 特休／補休「可申請額度」＝目前餘額 − 已送出待審的時數。
 * 假單核准當下就自餘額扣除（approve_leave_request），年資特休也是核准即入帳，
 * 所以已核准的時數都已反映在餘額上，只需再扣掉還在待審的。
 */

export type BalanceLeaveKind = "annual" | "comp";

export function balanceLeaveKindOf(leaveTypeName: string): BalanceLeaveKind | null {
  if (isAnnualLeaveTypeName(leaveTypeName)) return "annual";
  if (isCompLeaveTypeName(leaveTypeName)) return "comp";
  return null;
}

export type LeaveBalanceCommitments = {
  annual: { pendingHours: number };
  comp: { pendingHours: number };
};

export function emptyLeaveBalanceCommitments(): LeaveBalanceCommitments {
  return { annual: { pendingHours: 0 }, comp: { pendingHours: 0 } };
}

const PENDING_STATUSES = ["pending", "待審核"];

/**
 * 查詢員工特休／補休待審中的時數。
 * `excludeLeaveId`：審核時排除正在核准的那張假單。查詢失敗會 throw（呼叫端應擋下）。
 */
export async function fetchLeaveBalanceCommitments(
  employeeId: string,
  opts: { excludeLeaveId?: string } = {},
): Promise<LeaveBalanceCommitments> {
  const c = emptyLeaveBalanceCommitments();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, leave_type, status, hours_count, total_days, start_date, end_date")
    .eq("employee_id", employeeId)
    .in("status", PENDING_STATUSES);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    if (opts.excludeLeaveId && String(r.id) === opts.excludeLeaveId) continue;
    const kind = balanceLeaveKindOf(String(r.leave_type ?? ""));
    if (kind) c[kind].pendingHours += leaveRequestTotalHours(r);
  }
  return c;
}

/**
 * 可申請時數。`balance`：特休為 employees.annual_leave_remaining（天），
 * 補休為 employees.comp_leave_remaining（小時）；餘額未設定回 null（一律不可申請）。
 */
export function availableLeaveHours(
  kind: BalanceLeaveKind,
  balance: number | null | undefined,
  c: LeaveBalanceCommitments,
): number | null {
  if (balance == null || !Number.isFinite(balance)) return null;
  const balanceHours = kind === "annual" ? balance * LEAVE_WORK_DAY_HOURS : balance;
  return balanceHours - c[kind].pendingHours;
}

/** 浮點誤差容許（0.6 分鐘）：申請時數剛好等於可申請額度時仍可送出 */
export const LEAVE_HOURS_EPSILON = 0.01;

export function exceedsAvailable(requestHours: number, available: number | null): boolean {
  if (available == null) return true;
  return requestHours > available + LEAVE_HOURS_EPSILON;
}

/**
 * 額度明細：「剩餘 3 天 0 小時 − 待審 1 天 0 小時 ＝ 可再申請 2 天 0 小時」。
 * 沒有待審時只顯示「可再申請 …」。
 */
export function describeLeaveAvailability(
  kind: BalanceLeaveKind,
  balance: number | null | undefined,
  c: LeaveBalanceCommitments,
): string {
  const available = availableLeaveHours(kind, balance, c);
  if (available == null) return "尚未設定餘額";
  const balanceHours = kind === "annual" ? (balance ?? 0) * LEAVE_WORK_DAY_HOURS : (balance ?? 0);
  const availableText = `可再申請 ${formatHoursAsDayHour(available)}`;
  if (c[kind].pendingHours <= 0) return availableText;
  return `剩餘 ${formatHoursAsDayHour(balanceHours)} − 待審 ${formatHoursAsDayHour(c[kind].pendingHours)} ＝ ${availableText}`;
}

/** 送出／核准前的額度檢查；通過回 null，否則回傳給使用者看的錯誤訊息 */
export function leaveBalanceErrorMessage(
  kind: BalanceLeaveKind,
  leaveTypeName: string,
  balance: number | null | undefined,
  c: LeaveBalanceCommitments,
  requestHours: number,
): string | null {
  const available = availableLeaveHours(kind, balance, c);
  if (available == null) return `尚未設定${leaveTypeName}餘額，無法申請。請洽人資維護。`;
  if (!exceedsAvailable(requestHours, available)) return null;
  const detail = describeLeaveAvailability(kind, balance, c);
  if (available <= LEAVE_HOURS_EPSILON) {
    return `${leaveTypeName}可申請額度已用完（${detail}）。`;
  }
  return `本次 ${formatHoursAsDayHour(requestHours)} 超過${leaveTypeName}可申請額度（${detail}）。`;
}

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 員工目前特休（天）／補休（小時）餘額；comp_leave_remaining 缺欄的舊 schema 視為未設定 */
export async function fetchEmployeeLeaveBalances(
  employeeId: string,
): Promise<{ annual: number | null; comp: number | null }> {
  const full = await supabase
    .from("employees")
    .select("annual_leave_remaining, comp_leave_remaining")
    .eq("id", employeeId)
    .maybeSingle();
  if (!full.error) {
    const r = (full.data ?? {}) as { annual_leave_remaining?: unknown; comp_leave_remaining?: unknown };
    return {
      annual: finiteOrNull(r.annual_leave_remaining),
      comp: finiteOrNull(r.comp_leave_remaining),
    };
  }
  if (!/column|does not exist|schema cache/i.test(full.error.message)) {
    throw new Error(full.error.message);
  }
  const annualOnly = await supabase
    .from("employees")
    .select("annual_leave_remaining")
    .eq("id", employeeId)
    .maybeSingle();
  if (annualOnly.error) throw new Error(annualOnly.error.message);
  const r = (annualOnly.data ?? {}) as { annual_leave_remaining?: unknown };
  return { annual: finiteOrNull(r.annual_leave_remaining), comp: null };
}
