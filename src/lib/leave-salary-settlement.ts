import { LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import {
  formatLeaveHoursLabel,
  hourlyWageFromMonthly,
  leaveRequestHoursInRange,
  type LeaveHolidayLookup,
} from "@/lib/leave-hours";

/**
 * 扣薪假別（事假、病假等）的薪資結算與跨月對帳。
 *
 * 每張薪資單在 payslips.leave_settlement 記下結算了哪些假單、屬於哪個月份、幾小時。
 * 下個月結算時，把「已發放月份現在應扣的時數」和「各張薪資單已結算的時數」對帳，差額列為：
 * - 前期補扣（正）：發薪後才核准的假單
 * - 前期補發（負）：發薪後才撤銷的假單、颱風假等回補
 * 沒有 leave_settlement 的舊薪資單（上線前發放）不對帳。
 */

export type LeaveSettlementItem = {
  leave_request_id: string;
  /** 該時數所屬月份 YYYY-MM */
  period: string;
  leave_type: string;
  /** 結算時數；前期調整可為負（補發） */
  hours: number;
  /** 扣薪比例（1 − pay_ratio） */
  ratio: number;
  /** 金額（元，未四捨五入） */
  amount: number;
};

export type PaidSlipForSettlement = {
  period: string;
  /** 該月月薪（payslips.base_salary），前期調整以當月時薪計 */
  baseSalary: number;
  /** null＝上線前的舊薪資單，不參與對帳 */
  items: LeaveSettlementItem[] | null;
};

type Row = Record<string, unknown>;

const EPS_HOURS = 0.01;

function isApproved(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

function leaveTypeOf(row: Row): string {
  return String(row.leave_type ?? row.type_label ?? row.type ?? "").trim() || "請假";
}

function isBalanceType(name: string): boolean {
  return name === "特休" || name.startsWith("補休");
}

export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 已核准扣薪假在某月份應扣的時數（特休／補休、全薪假別回 0） */
function expectedHours(
  row: Row,
  ym: string,
  ratioOf: (leaveType: string) => number,
  holidayLookup?: LeaveHolidayLookup,
): number {
  if (!isApproved(row.status)) return 0;
  const name = leaveTypeOf(row);
  if (isBalanceType(name) || ratioOf(name) <= 0) return 0;
  const { start, end } = monthRange(ym);
  return leaveRequestHoursInRange(row, start, end, holidayLookup);
}

export type LeaveSalarySettlement = {
  /** 本月扣薪假明細 */
  current: LeaveSettlementItem[];
  /** 前期補扣（正）／補發（負） */
  adjustments: LeaveSettlementItem[];
  /** 請假扣款合計（元，四捨五入；可為負＝補發大於扣款） */
  total: number;
  /** 本月扣薪假時數（不含前期調整）→ payslips.leave_days 以時數 ÷ 8 */
  currentHours: number;
};

export function computeLeaveSalarySettlement(input: {
  period: string;
  monthlyWage: number;
  leaves: readonly Row[];
  ratioOf: (leaveType: string) => number;
  holidayLookup?: LeaveHolidayLookup;
  /** 本員工其他已發放的薪資單（不含本月） */
  paidSlips: readonly PaidSlipForSettlement[];
}): LeaveSalarySettlement {
  const { period, monthlyWage, leaves, ratioOf, holidayLookup, paidSlips } = input;
  const hourly = hourlyWageFromMonthly(monthlyWage);

  const current: LeaveSettlementItem[] = [];
  for (const row of leaves) {
    const hours = expectedHours(row, period, ratioOf, holidayLookup);
    if (hours <= EPS_HOURS) continue;
    const name = leaveTypeOf(row);
    const ratio = ratioOf(name);
    current.push({
      leave_request_id: String(row.id),
      period,
      leave_type: name,
      hours: round2(hours),
      ratio,
      amount: hours * ratio * hourly,
    });
  }

  // 已結算時數：所有已發放薪資單（含後續月份的前期調整）合計，依（月份, 假單）彙整
  const settled = new Map<string, { hours: number; weighted: number; leaveType: string }>();
  for (const slip of paidSlips) {
    for (const it of slip.items ?? []) {
      const key = `${it.period}|${it.leave_request_id}`;
      const cur = settled.get(key) ?? { hours: 0, weighted: 0, leaveType: it.leave_type };
      cur.hours += it.hours;
      cur.weighted += it.hours * it.ratio;
      settled.set(key, cur);
    }
  }

  const leaveById = new Map(leaves.map((r) => [String(r.id), r]));
  const adjustments: LeaveSettlementItem[] = [];
  const tracked = paidSlips
    .filter((s) => s.items != null && s.period < period)
    .sort((a, b) => a.period.localeCompare(b.period));
  for (const slip of tracked) {
    const p = slip.period;
    const hourlyP = hourlyWageFromMonthly(slip.baseSalary);
    const { start, end } = monthRange(p);
    const ids = new Set<string>();
    for (const key of settled.keys()) {
      const [kp, id] = key.split("|");
      if (kp === p) ids.add(id);
    }
    for (const row of leaves) {
      const s = String(row.start_date ?? "").slice(0, 10);
      const e = String(row.end_date ?? s).slice(0, 10);
      if (s <= end && e >= start) ids.add(String(row.id));
    }
    for (const id of ids) {
      const row = leaveById.get(id);
      const exp = row ? expectedHours(row, p, ratioOf, holidayLookup) : 0;
      const prev = settled.get(`${p}|${id}`) ?? { hours: 0, weighted: 0, leaveType: row ? leaveTypeOf(row) : "請假" };
      const hoursDiff = exp - prev.hours;
      const name = row ? leaveTypeOf(row) : prev.leaveType;
      const ratioNow = row ? ratioOf(name) : 0;
      const weightedDiff = exp * ratioNow - prev.weighted;
      if (Math.abs(hoursDiff) <= EPS_HOURS && Math.abs(weightedDiff) <= EPS_HOURS) continue;
      adjustments.push({
        leave_request_id: id,
        period: p,
        leave_type: name,
        hours: round2(hoursDiff),
        ratio: ratioNow || (prev.hours ? prev.weighted / prev.hours : 0),
        amount: weightedDiff * hourlyP,
      });
    }
  }

  const total = Math.round(
    current.reduce((s, it) => s + it.amount, 0) + adjustments.reduce((s, it) => s + it.amount, 0),
  );
  const currentHours = current.reduce((s, it) => s + it.hours, 0);
  return { current, adjustments, total, currentHours };
}

/** 薪資單備註：「前期請假調整：10 月 事假 4 小時 補扣 NT$600」 */
export const PRIOR_LEAVE_ADJUST_REMARK_RE = /^前期請假調整：/;

export function formatPriorLeaveAdjustmentLines(adjustments: readonly LeaveSettlementItem[]): string[] {
  return adjustments
    .filter((a) => Math.round(Math.abs(a.amount)) > 0 || Math.abs(a.hours) > EPS_HOURS)
    .map((a) => {
      const month = Number(a.period.slice(5, 7));
      const verb = a.amount >= 0 ? "補扣" : "補發";
      const reason = a.hours >= 0 ? "發薪後才核准" : "發薪後撤銷／回補";
      return `前期請假調整：${month} 月 ${a.leave_type} ${formatLeaveHoursLabel(Math.abs(a.hours))}（${reason}）${verb} NT$${Math.abs(Math.round(a.amount)).toLocaleString("zh-TW")}`;
    });
}

/** 本月扣薪假別時數（顯示用）：假別 → 時數 */
export function currentHoursByType(items: readonly LeaveSettlementItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.leave_type, (m.get(it.leave_type) ?? 0) + it.hours);
  return m;
}

export function settlementLeaveDays(s: LeaveSalarySettlement): number {
  return s.currentHours / LEAVE_WORK_DAY_HOURS;
}
