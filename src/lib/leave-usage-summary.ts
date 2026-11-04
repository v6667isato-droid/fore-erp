import { formatHoursAsDayHour, LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import { balanceLeaveKindOf } from "@/lib/leave-balance-availability";
import { PERSONAL_FAMILY_ANNUAL_LIMIT_DAYS } from "@/lib/leave-types";

/**
 * 待審假單的額度／累計摘要（審核卡片用；與 fore-telegram-bot lib/leave-balance.ts 規則一致）：
 * - 特休／補休：目前剩餘、核准後剩餘、同假別其他待審
 * - 婚假：累計已核准／法定天數（通常一輩子一次）
 * - 其他有法定天數的假（喪假、產檢、陪產等）：今年已核准／法定天數
 * - 事假＋家庭照顧假：今年已核准／上限 14 天
 * - 病假、生理假：回 null（審核卡片另有含保護線的病假累計）
 * - 其他假別：今年已核准（有才顯示）
 */

export type UsageLeave = {
  id: string;
  leave_type: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  /** YYYY-MM-DD */
  start_date: string;
  hours: number;
};

export type LeaveUsageSummary = { text: string; warn: boolean };

function fmtDays(days: number): string {
  return `${days.toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 天`;
}

export function summarizeLeaveUsage(input: {
  leaveId: string;
  leaveType: string;
  thisHours: number;
  /** 同一員工的全部假單（任何狀態） */
  employeeLeaves: readonly UsageLeave[];
  /** 特休（小時）或補休（小時）餘額；undefined＝尚未載入，null＝未設定 */
  balanceHours: number | null | undefined;
  /** leave_types.statutory_days */
  statutoryDays: number | null;
  /** 今年（YYYY） */
  year: string;
}): LeaveUsageSummary | null {
  const type = input.leaveType.trim();
  const kind = balanceLeaveKindOf(type);

  if (kind) {
    const label = kind === "annual" ? "特休" : "補休";
    if (input.balanceHours === undefined) return null;
    if (input.balanceHours === null) return { text: `${label}餘額：尚未設定`, warn: true };
    const otherPending = input.employeeLeaves
      .filter((l) => l.status === "pending" && l.id !== input.leaveId && balanceLeaveKindOf(l.leave_type) === kind)
      .reduce((s, l) => s + l.hours, 0);
    const after = input.balanceHours - input.thisHours;
    const extra = otherPending > 0 ? `；另有待審 ${formatHoursAsDayHour(otherPending)}` : "";
    return {
      text: `${label}剩餘：${formatHoursAsDayHour(input.balanceHours)}（核准後剩 ${formatHoursAsDayHour(after)}${extra}）`,
      warn: after < -0.01,
    };
  }

  if (type === "病假" || type === "生理假") return null;

  const approved = input.employeeLeaves.filter((l) => l.status === "approved" && l.id !== input.leaveId);
  const daysOf = (pred: (l: UsageLeave) => boolean) =>
    approved.filter(pred).reduce((s, l) => s + l.hours, 0) / LEAVE_WORK_DAY_HOURS;
  const thisYear = (l: UsageLeave) => l.start_date.startsWith(input.year);
  const thisDays = input.thisHours / LEAVE_WORK_DAY_HOURS;

  if (type === "事假" || type === "家庭照顧假") {
    const used = daysOf((l) => thisYear(l) && (l.leave_type === "事假" || l.leave_type === "家庭照顧假"));
    return {
      text: `今年已核准事假＋家照：${fmtDays(used)}／上限 ${PERSONAL_FAMILY_ANNUAL_LIMIT_DAYS} 天`,
      warn: used + thisDays > PERSONAL_FAMILY_ANNUAL_LIMIT_DAYS + 0.001,
    };
  }

  if (type === "婚假") {
    const used = daysOf((l) => l.leave_type === "婚假");
    return {
      text: `累計已核准婚假：${fmtDays(used)}${input.statutoryDays ? `／法定 ${input.statutoryDays} 天` : ""}`,
      warn: input.statutoryDays != null && used + thisDays > input.statutoryDays + 0.001,
    };
  }

  const used = daysOf((l) => thisYear(l) && l.leave_type === type);
  if (input.statutoryDays) {
    return {
      text: `今年已核准${type}：${fmtDays(used)}／法定 ${input.statutoryDays} 天`,
      warn: used + thisDays > input.statutoryDays + 0.001,
    };
  }
  return used > 0 ? { text: `今年已核准${type}：${fmtDays(used)}`, warn: false } : null;
}
