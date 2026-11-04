import {
  LEAVE_WORK_DAY_HOURS,
  LEAVE_WORKDAY_END_HOUR,
  LEAVE_WORKDAY_START_HOUR,
  computeNetWorkMinutesExcludingLunch,
  countLeaveWorkdaysInclusive,
  hoursToDayHourParts,
  parseLocalDateTime,
} from "@/lib/employee-leave-time";

/**
 * 假單時數計算（薪資扣款、餘額檢查共用）。
 *
 * 時數來源一律以 leave_requests.hours_count 為準（申請當下已排除週末、國定放假與午休）；
 * 跨月假單依各月實際工時比例分攤，各段加總仍等於 hours_count。
 */

/** 勞基法日薪＝月薪 ÷ 30；時薪再 ÷ 8 */
export const PAYROLL_DAYS_PER_MONTH = 30;

export function hourlyWageFromMonthly(monthlyWage: number): number {
  if (!Number.isFinite(monthlyWage)) return 0;
  return monthlyWage / PAYROLL_DAYS_PER_MONTH / LEAVE_WORK_DAY_HOURS;
}

export type LeaveHolidayLookup = Map<string, { is_workday: boolean }>;

type Row = Record<string, unknown>;

function ymdOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** start_time／end_time 欄位（time 型別回傳 HH:MM:SS）→ HH:MM */
function timeOrNull(v: unknown): string | null {
  if (v == null) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function hourToTime(h: number | null): string | null {
  if (h == null || h < 0 || h > 23) return null;
  return `${String(Math.trunc(h)).padStart(2, "0")}:00`;
}

/**
 * 假單起訖日與時間（HH:MM）。優先讀 start_time／end_time（分鐘精度），
 * 舊假單只有整點欄位時由 start_day_start_hour／end_day_end_hour 等推回。
 */
export function leaveRequestTimes(row: Row): {
  startYmd: string;
  endYmd: string;
  startTime: string;
  endTime: string;
} | null {
  const startYmd = ymdOrNull(row.start_date ?? row.start);
  if (!startYmd) return null;
  const endYmd = ymdOrNull(row.end_date ?? row.end) ?? startYmd;
  const sameDay = startYmd === endYmd;
  const startTime =
    timeOrNull(row.start_time) ??
    hourToTime(finiteOrNull(row.start_day_start_hour ?? row.start_hour)) ??
    hourToTime(LEAVE_WORKDAY_START_HOUR)!;
  const endTime =
    timeOrNull(row.end_time) ??
    hourToTime(
      sameDay
        ? finiteOrNull(row.start_day_end_hour ?? row.end_hour)
        : finiteOrNull(row.end_day_end_hour),
    ) ??
    hourToTime(LEAVE_WORKDAY_END_HOUR)!;
  return { startYmd, endYmd, startTime, endTime };
}

/** 假單總時數：hours_count 優先；舊資料退回 total_days × 8；皆無時以起訖工作日 × 8 */
export function leaveRequestTotalHours(
  row: Row,
  holidayLookup?: LeaveHolidayLookup,
): number {
  const hc = finiteOrNull(row.hours_count);
  if (hc != null && hc > 0) return hc;
  const td = finiteOrNull(row.total_days ?? row.days_count);
  if (td != null && td > 0) return td * LEAVE_WORK_DAY_HOURS;
  const t = leaveRequestTimes(row);
  if (!t) return 0;
  return countLeaveWorkdaysInclusive(t.startYmd, t.endYmd, holidayLookup) * LEAVE_WORK_DAY_HOURS;
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}

function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * 假單落在 [rangeStartYmd, rangeEndYmd]（含）的請假時數。
 * - 整張假單都在區間內：直接回傳總時數（hours_count）。
 * - 跨區間（例如跨月）：依區間內實際工時（9–18、扣午休、排除放假日）佔整張假單工時的比例分攤，
 *   各區間加總等於總時數；工時算不出來時退回工作日比例。
 */
export function leaveRequestHoursInRange(
  row: Row,
  rangeStartYmd: string,
  rangeEndYmd: string,
  holidayLookup?: LeaveHolidayLookup,
): number {
  const t = leaveRequestTimes(row);
  if (!t) return 0;
  if (t.endYmd < rangeStartYmd || t.startYmd > rangeEndYmd) return 0;
  const total = leaveRequestTotalHours(row, holidayLookup);
  if (total <= 0) return 0;
  if (t.startYmd >= rangeStartYmd && t.endYmd <= rangeEndYmd) return total;

  const a = parseLocalDateTime(t.startYmd, t.startTime);
  const b = parseLocalDateTime(t.endYmd, t.endTime);
  if (a && b && b.getTime() > a.getTime()) {
    const fullMin = computeNetWorkMinutesExcludingLunch(a, b, holidayLookup);
    if (fullMin > 0) {
      const rs = parseLocalDateTime(rangeStartYmd, "00:00");
      const re = parseLocalDateTime(addDaysYmd(rangeEndYmd, 1), "00:00");
      if (rs && re) {
        const ca = a.getTime() > rs.getTime() ? a : rs;
        const cb = b.getTime() < re.getTime() ? b : re;
        const partMin =
          cb.getTime() > ca.getTime()
            ? computeNetWorkMinutesExcludingLunch(ca, cb, holidayLookup)
            : 0;
        return (total * partMin) / fullMin;
      }
    }
  }

  const fullDays = countLeaveWorkdaysInclusive(t.startYmd, t.endYmd, holidayLookup);
  if (fullDays <= 0) return 0;
  const partDays = countLeaveWorkdaysInclusive(
    maxYmd(t.startYmd, rangeStartYmd),
    minYmd(t.endYmd, rangeEndYmd),
    holidayLookup,
  );
  return (total * partDays) / fullDays;
}

/** 顯示用：時數 → 「4 小時」「1 天」「1 天 4 小時」（8 小時＝1 天） */
export function formatLeaveHoursLabel(hours: number): string {
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 0;
  const { days, hours: h } = hoursToDayHourParts(Math.round(safe * 100) / 100);
  const hDisp = h.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  if (days === 0) return `${hDisp} 小時`;
  if (h === 0) return `${days} 天`;
  return `${days} 天 ${hDisp} 小時`;
}

/** 假別是否為特休 */
export function isAnnualLeaveTypeName(name: string): boolean {
  return name.trim() === "特休";
}

/** 假別是否為補休（含「補休假」等變體） */
export function isCompLeaveTypeName(name: string): boolean {
  return name.trim().startsWith("補休");
}
