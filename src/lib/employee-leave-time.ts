/** 單日實際計薪工時（扣除午休），特休「日↔小時」換算與此一致 */
export const LEAVE_WORK_DAY_HOURS = 8;

/** 上班時段（含起迄；與午休不重疊部分計入） */
export const LEAVE_WORKDAY_START_HOUR = 9;
export const LEAVE_WORKDAY_END_HOUR = 18;

/** 午休不計入請假時數 */
export const LEAVE_LUNCH_START_HOUR = 12;
export const LEAVE_LUNCH_END_HOUR = 13;

/** 將資料庫「剩餘天數（可含小數）」拆成 整數日 + 小時 */
export function splitRemainingDaysToDayHour(dayDecimal: number): { days: number; hours: number } {
  const safe = Number.isFinite(dayDecimal) && dayDecimal >= 0 ? dayDecimal : 0;
  const wholeDays = Math.floor(safe + 1e-9);
  const frac = Math.max(0, safe - wholeDays);
  const hours = Math.round(frac * LEAVE_WORK_DAY_HOURS * 100) / 100;
  return { days: wholeDays, hours };
}

/** 顯示用：將 employees.annual_leave_remaining 等小數「日」換成「X 天 Y 小時」 */
export function formatDayDecimalAsDayHour(dayDecimal: number | null | undefined): string {
  if (dayDecimal == null || !Number.isFinite(dayDecimal) || dayDecimal < 0) return "—";
  const { days, hours } = splitRemainingDaysToDayHour(dayDecimal);
  return `${days} 天 ${hours} 小時`;
}

/** 顯示用：同 {@link formatDayDecimalAsDayHour}，但允許負值（結算後餘額可能透支），顯示為「−X 天 Y 小時」 */
export function formatSignedDayDecimalAsDayHour(
  dayDecimal: number | null | undefined,
): string {
  if (dayDecimal == null || !Number.isFinite(dayDecimal)) return "—";
  if (dayDecimal < 0) return `−${formatDayDecimalAsDayHour(-dayDecimal)}`;
  return formatDayDecimalAsDayHour(dayDecimal);
}

/** 表單「日 + 小時」→ 寫入 DB 的 annual_leave_remaining（小數日）；日／小時皆可小數，合計為 日 + 小時/8 */
export function annualLeavePartsToDecimal(daysStr: string, hoursStr: string): number | null {
  const dTrim = daysStr.trim();
  const hTrim = hoursStr.trim();
  if (dTrim === "" && hTrim === "") return null;
  const dParsed = dTrim === "" ? 0 : Number(dTrim);
  const hParsed = hTrim === "" ? 0 : Number(hTrim);
  if (
    (dTrim !== "" && !Number.isFinite(dParsed)) ||
    (hTrim !== "" && !Number.isFinite(hParsed))
  ) {
    return null;
  }
  const d = Math.max(0, dParsed);
  const h = Math.max(0, hParsed);
  return d + h / LEAVE_WORK_DAY_HOURS;
}

/** 總時數 → ?日?小時（餘數可含小數） */
export function hoursToDayHourParts(totalHours: number): { days: number; hours: number } {
  const raw = Math.max(0, Number(totalHours) || 0);
  const days = Math.floor(raw / LEAVE_WORK_DAY_HOURS);
  const hours = Math.round((raw - days * LEAVE_WORK_DAY_HOURS) * 100) / 100;
  return { days, hours };
}

/** 顯示用：employees.comp_leave_remaining 為「總小時」→「X 天 Y 小時」（8 小時 = 1 日） */
export function formatHoursAsDayHour(totalHours: number | null | undefined): string {
  if (totalHours == null || !Number.isFinite(totalHours) || totalHours < 0) return "—";
  const { days, hours } = hoursToDayHourParts(totalHours);
  return `${days} 天 ${hours} 小時`;
}

/**
 * 表單「日 + 小時」→ 寫入 DB 的 comp_leave_remaining（總小時）；日／小時皆可小數（8 小時 = 1 日）。
 */
export function compLeavePartsToTotalHours(
  daysStr: string,
  hoursStr: string,
): number | null {
  const dTrim = daysStr.trim();
  const hTrim = hoursStr.trim();
  if (dTrim === "" && hTrim === "") return null;
  const dParsed = dTrim === "" ? 0 : Number(dTrim);
  const hParsed = hTrim === "" ? 0 : Number(hTrim);
  if (
    (dTrim !== "" && !Number.isFinite(dParsed)) ||
    (hTrim !== "" && !Number.isFinite(hParsed))
  ) {
    return null;
  }
  const d = Math.max(0, dParsed);
  const h = Math.max(0, hParsed);
  return d * LEAVE_WORK_DAY_HOURS + h;
}

const MS_MIN = 60_000;

/** 與 public_holidays 對齊：放假列 is_workday=false；補班日 is_workday=true（週末亦計入請假工作日） */
export type LeaveHolidayRow = { holiday_date: string; is_workday: boolean };

export function ymdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export function buildLeaveHolidayLookup(
  holidays: readonly LeaveHolidayRow[],
): Map<string, { is_workday: boolean }> {
  const m = new Map<string, { is_workday: boolean }>();
  for (const h of holidays) {
    const d = String(h.holiday_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    m.set(d, { is_workday: Boolean(h.is_workday) });
  }
  return m;
}

/**
 * 請假「工作日」：排除週六、週日；若該日在 public_holidays 有列，則以 is_workday 為準（放假不計、補班計）。
 * `holidayLookup` 省略或該日無列時，僅依週末判斷。
 */
export function isCountedDayForLeave(
  localDate: Date,
  holidayLookup?: Map<string, { is_workday: boolean }>,
): boolean {
  const ymd = ymdFromLocalDate(localDate);
  const h = holidayLookup?.get(ymd);
  if (h !== undefined) return h.is_workday === true;
  const dow = localDate.getDay();
  if (dow === 0 || dow === 6) return false;
  return true;
}

/** 起迄日（含）之間，符合 {@link isCountedDayForLeave} 的曆日數 */
export function countLeaveWorkdaysInclusive(
  startYmd: string,
  endYmd: string,
  holidayLookup?: Map<string, { is_workday: boolean }>,
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return 0;
  if (endYmd < startYmd) return 0;
  const [y0, m0, d0] = startYmd.split("-").map((x) => Number(x));
  const [y1, m1, d1] = endYmd.split("-").map((x) => Number(x));
  const cur = new Date(y0, m0 - 1, d0);
  const last = new Date(y1, m1 - 1, d1);
  let count = 0;
  while (cur.getTime() <= last.getTime()) {
    if (isCountedDayForLeave(cur, holidayLookup)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** `YYYY-MM-DD` + `HH:MM`（或 `HH:MM:SS`）→ 本地 Date；無效則 null */
export function parseLocalDateTime(ymd: string, timeHm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = timeHm.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] != null ? Number(m[3]) : 0;
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59 ||
    ss < 0 ||
    ss > 59
  ) {
    return null;
  }
  const [y, mo, d] = ymd.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d, hh, mm, ss, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== hh
  ) {
    return null;
  }
  return dt;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * 請假區間與每日工時 [WORKDAY_START, WORKDAY_END) 取交集後，再扣除午休 [LUNCH_START, LUNCH_END)。
 * 中間完整曆日若整段落在工時內，每日淨值為 LEAVE_WORK_DAY_HOURS。
 * 週六、週日及 public_holidays 放假列不計入；補班日（is_workday=true）計入。
 */
export function computeNetWorkMinutesExcludingLunch(
  leaveStart: Date,
  leaveEnd: Date,
  holidayLookup?: Map<string, { is_workday: boolean }>,
): number {
  if (leaveEnd.getTime() <= leaveStart.getTime()) return 0;
  let totalMin = 0;
  const cursor = new Date(
    leaveStart.getFullYear(),
    leaveStart.getMonth(),
    leaveStart.getDate()
  );
  const lastDay = new Date(leaveEnd.getFullYear(), leaveEnd.getMonth(), leaveEnd.getDate());

  while (cursor.getTime() <= lastDay.getTime()) {
    if (!isCountedDayForLeave(cursor, holidayLookup)) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const y = cursor.getFullYear();
    const mo = cursor.getMonth();
    const d = cursor.getDate();
    const ws = new Date(y, mo, d, LEAVE_WORKDAY_START_HOUR, 0, 0, 0).getTime();
    const we = new Date(y, mo, d, LEAVE_WORKDAY_END_HOUR, 0, 0, 0).getTime();
    const ls = leaveStart.getTime();
    const le = leaveEnd.getTime();
    const seg0 = Math.max(ls, ws);
    const seg1 = Math.min(le, we);
    if (seg1 > seg0) {
      const lunch0 = new Date(y, mo, d, LEAVE_LUNCH_START_HOUR, 0, 0, 0).getTime();
      const lunch1 = new Date(y, mo, d, LEAVE_LUNCH_END_HOUR, 0, 0, 0).getTime();
      const gross = seg1 - seg0;
      const lunchOverlap = overlapMs(seg0, seg1, lunch0, lunch1);
      totalMin += (gross - lunchOverlap) / MS_MIN;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(totalMin);
}

/** 特休：起始日時～結束日時，已排除午休、週末與國定放假；回傳「小時」可含小數（由分鐘換算） */
export function computeSpecialLeaveNetHoursFromRange(
  startYmd: string,
  startTimeHm: string,
  endYmd: string,
  endTimeHm: string,
  holidayLookup?: Map<string, { is_workday: boolean }>,
): number {
  const a = parseLocalDateTime(startYmd, startTimeHm);
  const b = parseLocalDateTime(endYmd, endTimeHm);
  if (!a || !b || b.getTime() <= a.getTime()) return 0;
  const minutes = computeNetWorkMinutesExcludingLunch(a, b, holidayLookup);
  return minutes / 60;
}

/**
 * 對應 leave_requests 既有整點欄位（審核畫面用）：首日區間、末日區間。
 * 跨日時首日結束固定為 LEAVE_WORKDAY_END_HOUR、末日起始為 LEAVE_WORKDAY_START_HOUR。
 */
export function deriveLegacyHourFieldsForDb(leaveStart: Date, leaveEnd: Date): {
  firstStartHour: number;
  firstEndHour: number;
  lastStartHour: number | null;
  lastEndHour: number | null;
} {
  const same = ymdLocal(leaveStart) === ymdLocal(leaveEnd);
  if (same) {
    return {
      firstStartHour: leaveStart.getHours(),
      firstEndHour: leaveEnd.getHours(),
      lastStartHour: null,
      lastEndHour: null,
    };
  }
  return {
    firstStartHour: leaveStart.getHours(),
    firstEndHour: LEAVE_WORKDAY_END_HOUR,
    lastStartHour: LEAVE_WORKDAY_START_HOUR,
    lastEndHour: leaveEnd.getHours(),
  };
}

/** 同曆日整點區間 [start, end) 的時數；end 須大於 start，皆為 0–23 */
export function computeLeaveHourSpan(startHour: number, endHour: number): number {
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return 0;
  if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) return 0;
  if (endHour <= startHour) return 0;
  return endHour - startHour;
}

/**
 * @deprecated 改為 {@link computeSpecialLeaveNetHoursFromRange}（含午休扣除與 9–18 工時裁剪）
 */
export function computeSpecialLeaveTotalHours(
  startYmd: string,
  endYmd: string,
  startDayStart: number,
  startDayEnd: number,
  endDayStart: number,
  endDayEnd: number
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return 0;
  if (endYmd < startYmd) return 0;
  const first = computeLeaveHourSpan(startDayStart, startDayEnd);
  if (first <= 0) return 0;
  if (startYmd === endYmd) return first;
  const last = computeLeaveHourSpan(endDayStart, endDayEnd);
  if (last <= 0) return 0;
  const a = new Date(`${startYmd}T12:00:00`).getTime();
  const b = new Date(`${endYmd}T12:00:00`).getTime();
  const diffDays = Math.round((b - a) / 86400000);
  const middle = Math.max(0, diffDays - 1) * LEAVE_WORK_DAY_HOURS;
  return first + middle + last;
}

/** @deprecated 請假天數請改用 {@link countLeaveWorkdaysInclusive}（排除週末／國定放假） */
export function calendarDaysInclusive(startYmd: string, endYmd: string): number {
  const a = new Date(`${startYmd}T12:00:00`);
  const b = new Date(`${endYmd}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return Math.max(1, diff + 1);
}
