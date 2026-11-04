import { supabase } from "@/lib/supabase";
import { formatHoursAsDayHour, LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import {
  isAnnualLeaveTypeName,
  isCompLeaveTypeName,
  leaveRequestTotalHours,
} from "@/lib/leave-hours";

/**
 * 特休／補休「可申請額度」：
 *   可申請 ＝ 目前餘額 − 已送出待審 − 已核准但尚未在薪資結算扣除（特休另加已核准待入帳的年資新增）
 *
 * 現行流程特休／補休於「假單建立月」的薪資發放時才自餘額扣除，
 * 所以建立月份晚於該員工最新已發放薪資月份的已核准假單，都還沒反映在餘額上。
 */

export type BalanceLeaveKind = "annual" | "comp";

export function balanceLeaveKindOf(leaveTypeName: string): BalanceLeaveKind | null {
  if (isAnnualLeaveTypeName(leaveTypeName)) return "annual";
  if (isCompLeaveTypeName(leaveTypeName)) return "comp";
  return null;
}

export type LeaveBalanceCommitments = {
  annual: { pendingHours: number; unsettledHours: number };
  comp: { pendingHours: number; unsettledHours: number };
  /** 已核准、下次發放薪資時才入帳的年資新增特休（天） */
  annualPendingGrantDays: number;
};

export function emptyLeaveBalanceCommitments(): LeaveBalanceCommitments {
  return {
    annual: { pendingHours: 0, unsettledHours: 0 },
    comp: { pendingHours: 0, unsettledHours: 0 },
    annualPendingGrantDays: 0,
  };
}

const PENDING_STATUSES = ["pending", "待審核"];
const APPROVED_STATUSES = ["approved", "已核准", "核准"];

function isPaidStatus(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "paid" || s === "已發放" || s === "發放";
}

/** YYYY-MM 的下個月月初（本地時間）→ ISO，與薪資結算「假單建立月」的判斷一致 */
function startOfMonthAfterIso(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]), 1, 0, 0, 0, 0).toISOString();
}

/** 最新已發放薪資月份；沒有任何已發放紀錄回 null，查詢失敗回 undefined */
async function fetchLatestPaidPeriod(employeeId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase
    .from("payslips")
    .select("period_key, status")
    .eq("employee_id", employeeId);
  if (error) {
    console.warn("[leave-balance] payslips:", error.message);
    return undefined;
  }
  let latest: string | null = null;
  for (const r of (data ?? []) as { period_key?: unknown; status?: unknown }[]) {
    if (!isPaidStatus(r.status)) continue;
    const pk = String(r.period_key ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(pk)) continue;
    if (latest == null || pk > latest) latest = pk;
  }
  return latest;
}

function addHours(c: LeaveBalanceCommitments, row: Record<string, unknown>, bucket: "pendingHours" | "unsettledHours") {
  const kind = balanceLeaveKindOf(String(row.leave_type ?? ""));
  if (!kind) return;
  c[kind][bucket] += leaveRequestTotalHours(row);
}

/**
 * 查詢員工特休／補休已占用的時數。
 * `excludeLeaveId`：審核時排除正在核准的那張假單，避免自己算進「待審」。
 * 假單查詢失敗會 throw（無法確認額度時呼叫端應擋下）；薪資單、授予紀錄查不到時視為 0。
 */
export async function fetchLeaveBalanceCommitments(
  employeeId: string,
  opts: { excludeLeaveId?: string } = {},
): Promise<LeaveBalanceCommitments> {
  const c = emptyLeaveBalanceCommitments();
  const cols = "id, leave_type, status, hours_count, total_days, start_date, end_date, created_at";

  const [pendingRes, latestPaid, grantsRes] = await Promise.all([
    supabase
      .from("leave_requests")
      .select(cols)
      .eq("employee_id", employeeId)
      .in("status", PENDING_STATUSES),
    fetchLatestPaidPeriod(employeeId),
    supabase
      .from("annual_leave_grants")
      .select("days, applied_at")
      .eq("employee_id", employeeId)
      .is("applied_at", null),
  ]);

  if (pendingRes.error) throw new Error(pendingRes.error.message);
  for (const r of (pendingRes.data ?? []) as Record<string, unknown>[]) {
    if (opts.excludeLeaveId && String(r.id) === opts.excludeLeaveId) continue;
    addHours(c, r, "pendingHours");
  }

  // 薪資單查詢失敗時無法判斷哪些已結算，略過「已核准待結算」以免誤擋
  if (latestPaid !== undefined) {
    let q = supabase
      .from("leave_requests")
      .select(cols)
      .eq("employee_id", employeeId)
      .in("status", APPROVED_STATUSES);
    const cutoff = latestPaid ? startOfMonthAfterIso(latestPaid) : null;
    if (cutoff) q = q.gte("created_at", cutoff);
    const approvedRes = await q;
    if (approvedRes.error) throw new Error(approvedRes.error.message);
    for (const r of (approvedRes.data ?? []) as Record<string, unknown>[]) {
      if (opts.excludeLeaveId && String(r.id) === opts.excludeLeaveId) continue;
      addHours(c, r, "unsettledHours");
    }
  }

  if (grantsRes.error) {
    if (!/does not exist|relation|schema cache/i.test(grantsRes.error.message)) {
      console.warn("[leave-balance] annual_leave_grants:", grantsRes.error.message);
    }
  } else {
    for (const g of (grantsRes.data ?? []) as { days?: unknown }[]) {
      const d = Number(g.days);
      if (Number.isFinite(d)) c.annualPendingGrantDays += d;
    }
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
  if (kind === "annual") {
    return (
      (balance + c.annualPendingGrantDays) * LEAVE_WORK_DAY_HOURS -
      c.annual.pendingHours -
      c.annual.unsettledHours
    );
  }
  return balance - c.comp.pendingHours - c.comp.unsettledHours;
}

/** 浮點誤差容許（0.6 分鐘）：申請時數剛好等於可申請額度時仍可送出 */
export const LEAVE_HOURS_EPSILON = 0.01;

export function exceedsAvailable(requestHours: number, available: number | null): boolean {
  if (available == null) return true;
  return requestHours > available + LEAVE_HOURS_EPSILON;
}

/**
 * 額度明細：「剩餘 3 天 0 小時 − 待審 1 天 0 小時 − 已核准待結算 4 小時 ＝ 可再申請 1 天 4 小時」。
 * 沒有任何占用時只顯示「可再申請 …」。
 */
export function describeLeaveAvailability(
  kind: BalanceLeaveKind,
  balance: number | null | undefined,
  c: LeaveBalanceCommitments,
): string {
  const available = availableLeaveHours(kind, balance, c);
  if (available == null) return "尚未設定餘額";
  const balanceHours = kind === "annual" ? (balance ?? 0) * LEAVE_WORK_DAY_HOURS : (balance ?? 0);
  const k = c[kind];
  const parts: string[] = [];
  if (kind === "annual" && c.annualPendingGrantDays > 0) {
    parts.push(`＋ 待入帳新增特休 ${formatHoursAsDayHour(c.annualPendingGrantDays * LEAVE_WORK_DAY_HOURS)}`);
  }
  if (k.pendingHours > 0) parts.push(`− 待審 ${formatHoursAsDayHour(k.pendingHours)}`);
  if (k.unsettledHours > 0) parts.push(`− 已核准待結算 ${formatHoursAsDayHour(k.unsettledHours)}`);
  const availableText = `可再申請 ${formatHoursAsDayHour(available)}`;
  if (parts.length === 0) return availableText;
  return `剩餘 ${formatHoursAsDayHour(balanceHours)} ${parts.join(" ")} ＝ ${availableText}`;
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
