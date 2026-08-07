/**
 * 薪資結算「出勤故事」備註：彙整 daily_attendance、leave_requests、overtime_records。
 */

import {
  hoursToDayHourParts,
  splitRemainingDaysToDayHour,
} from "@/lib/employee-leave-time";

export type PayslipRemarkBounds = {
  start: string;
  end: string;
};

/** 結算月內的臨時／國定放假日（public_holidays，is_workday=false），供備註自動寫入與異常抑制 */
export type PayslipRemarkHoliday = {
  /** YYYY-MM-DD */
  date: string;
  name: string;
};

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseLocalYmd(s: string): Date {
  const [yy, mm, dd] = s.slice(0, 10).split("-").map((x) => Number(x));
  return new Date(yy, mm - 1, dd);
}

function formatMdFromIso(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  const [, mo, day] = d.split("-").map((x) => Number(x));
  if (!Number.isFinite(mo) || !Number.isFinite(day)) return d;
  return `${mo}/${day}`;
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isLeaveApproved(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

function leaveTypeRaw(row: Record<string, unknown>): string {
  return String(row.leave_type ?? row.type_label ?? row.type ?? "").trim();
}

function isSpecialAnnualLeaveType(leaveType: string): boolean {
  return leaveType.trim() === "特休";
}

/** 補休（含「補休假」等變體）：與特休同樣以「假單建立月」歸屬結算月 */
function isCompLeaveType(leaveType: string): boolean {
  return leaveType.trim().startsWith("補休");
}

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

/** 與薪資結算「特休以假單建立月」一致：created_at 落在結算曆月內 */
function createdAtInPayPeriodMonth(row: Record<string, unknown>, payPeriodYm: string): boolean {
  const p = parseYm(payPeriodYm);
  if (!p) return false;
  const start = new Date(p.y, p.m - 1, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(p.y, p.m, 1, 0, 0, 0, 0);
  const gte = start.toISOString();
  const lt = nextMonthStart.toISOString();
  const raw = row.created_at ?? row.createdAt;
  if (raw == null) return false;
  const t = new Date(String(raw)).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(gte).getTime() && t < new Date(lt).getTime();
}

/** 特休備註：X天Y小時；小時為 0 不顯示「Y小時」；僅小時時不顯示 0天 */
function formatSpecialLeaveDurationForNote(days: number, hours: number): string {
  const d = Math.max(0, Math.trunc(days));
  const hRaw = Math.max(0, Number(hours) || 0);
  const hRounded = Math.round(hRaw * 100) / 100;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (hRounded > 0) {
    const hDisp = Number.isInteger(hRounded)
      ? String(hRounded)
      : String(hRounded);
    parts.push(`${hDisp}小時`);
  }
  return parts.join("");
}

/** 與結算中心一致：09:00 基準，逾 09:15 視為遲到並回傳「超過 9:00 的分鐘數」 */
function lateMinutesFromClockIn(clockIn: unknown): number | null {
  if (clockIn == null || clockIn === "") return null;
  const raw = String(clockIn).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  const actual = h * 60 + mi;
  const graceEnd = 9 * 60 + 15;
  if (actual <= graceEnd) return null;
  return actual - 9 * 60;
}

/**
 * 依上下班打卡有無區分備註（薪資結算出勤欄）：
 * 僅缺上班／僅缺下班／兩者皆無；若資料顯示兩者皆有但標籤仍含「缺卡」則保留「缺卡」。
 */
/** 歷史查詢月曆等處與薪資備註共用之缺卡文案 */
export function missingPunchRemark(
  hasIn: boolean,
  hasOut: boolean,
  tagHasMissingCard: boolean,
): string | null {
  if (hasIn && hasOut) {
    return tagHasMissingCard ? "缺卡" : null;
  }
  if (!hasIn && !hasOut) return "無打卡紀錄";
  if (hasIn && !hasOut) return "缺下班卡";
  return "缺上班卡";
}

function attendanceLineForRow(row: Record<string, unknown>): string | null {
  const dateIso = String(row.attendance_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;

  const tags = Array.isArray(row.status_tags)
    ? (row.status_tags as string[]).filter(Boolean)
    : [];
  const clockIn = row.clock_in;
  const clockOut = row.clock_out;
  const hasIn = clockIn != null && String(clockIn).trim() !== "";
  const hasOut = clockOut != null && String(clockOut).trim() !== "";

  const parts: string[] = [];

  const tagText = tags.join(" ");
  const punchRm = missingPunchRemark(hasIn, hasOut, tagText.includes("缺卡"));
  /** 戰情寫入之「未出勤」列：標籤已含未出勤，備註只寫「未出勤」，避免與「無打卡紀錄」重複 */
  if (tagText.includes("未出勤")) {
    parts.push("未出勤");
  } else if (punchRm) {
    parts.push(punchRm);
  }

  if (tagText.includes("遲到")) {
    const lm = lateMinutesFromClockIn(clockIn);
    parts.push(lm != null && lm > 0 ? `遲到 ${lm}分` : "遲到");
  }
  if (tagText.includes("早退")) parts.push("早退");
  if (tagText.includes("工時不足")) parts.push("工時不足");
  if (tagText.includes("時數不足")) parts.push("時數不足");
  /** 「時間超時」「時數異常」不列入薪資備註（老闆要求略過） */

  const onlyLeaveTags =
    tags.length > 0 &&
    tags.every(
      (t) =>
        t.includes("請假") ||
        t.includes("🌴") ||
        t.includes("已請假"),
    );
  if (onlyLeaveTags && parts.length === 0) return null;

  const mentionsTrackedIssue =
    punchRm != null ||
    tagText.includes("遲到") ||
    tagText.includes("早退") ||
    tagText.includes("未出勤") ||
    tagText.includes("工時不足") ||
    tagText.includes("時數不足");

  if (
    parts.length === 0 &&
    row.is_abnormal === true &&
    !mentionsTrackedIssue &&
    (tagText.includes("時數異常") || tagText.includes("超時"))
  ) {
    return null;
  }

  if (parts.length === 0 && row.is_abnormal === true) {
    parts.push("出勤異常");
  }
  if (parts.length === 0) return null;

  return `${formatMdFromIso(dateIso)} ${parts.join("、")}`;
}

function formatSpecialLeaveNoteLine(
  row: Record<string, unknown>,
  datePart: string,
): string {
  const hc = num(row.hours_count, 0);
  let d = 0;
  let h = 0;
  if (hc > 0) {
    const p = hoursToDayHourParts(hc);
    d = p.days;
    h = p.hours;
  } else {
    const td = num(row.total_days, 0);
    if (td > 0) {
      const p = splitRemainingDaysToDayHour(td);
      d = p.days;
      h = p.hours;
    }
  }
  const dur = formatSpecialLeaveDurationForNote(d, h);
  return dur ? `${datePart} 特休 ${dur}` : `${datePart} 特休`;
}

function leaveLineForRow(
  row: Record<string, unknown>,
  bounds: PayslipRemarkBounds,
  payPeriodYm?: string,
): string | null {
  if (!isLeaveApproved(String(row.status ?? ""))) return null;

  const start = String(row.start_date ?? "").slice(0, 10);
  const end = String(row.end_date ?? start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }

  const leaveType = leaveTypeRaw(row) || "請假";

  const a = parseLocalYmd(start);
  const b = parseLocalYmd(end);
  const x = parseLocalYmd(bounds.start);
  const y = parseLocalYmd(bounds.end);
  const s = a.getTime() > x.getTime() ? a : x;
  const e = b.getTime() < y.getTime() ? b : y;
  const hasOverlap = s.getTime() <= e.getTime();

  if (isSpecialAnnualLeaveType(leaveType)) {
    if (payPeriodYm) {
      // 本月申請（created_at 落於結算月）或本月執行（請假區間與結算月重疊）
      const inMonthCreated = createdAtInPayPeriodMonth(row, payPeriodYm);
      if (!inMonthCreated && !hasOverlap) return null;
      let datePart: string;
      if (inMonthCreated) {
        const d0 = formatMdFromIso(ymdFromDate(a));
        const d1 = formatMdFromIso(ymdFromDate(b));
        datePart = d0 === d1 ? d0 : `${d0}–${d1}`;
      } else {
        const d0 = formatMdFromIso(ymdFromDate(s));
        const d1 = formatMdFromIso(ymdFromDate(e));
        datePart = d0 === d1 ? d0 : `${d0}–${d1}`;
      }
      return formatSpecialLeaveNoteLine(row, datePart);
    }
    if (!hasOverlap) return null;
    const d0 = formatMdFromIso(ymdFromDate(s));
    const d1 = formatMdFromIso(ymdFromDate(e));
    const datePart = d0 === d1 ? d0 : `${d0}–${d1}`;
    return formatSpecialLeaveNoteLine(row, datePart);
  }

  // 補休：發放時自補休金庫扣時數，以建立月為準；請在前月才申請時也要列入備註
  if (isCompLeaveType(leaveType) && payPeriodYm) {
    const inMonthCreated = createdAtInPayPeriodMonth(row, payPeriodYm);
    if (!inMonthCreated && !hasOverlap) return null;
    const from = inMonthCreated ? a : s;
    const to = inMonthCreated ? b : e;
    const d0 = formatMdFromIso(ymdFromDate(from));
    const d1 = formatMdFromIso(ymdFromDate(to));
    const datePart = d0 === d1 ? d0 : `${d0}–${d1}`;
    const h = num(row.hours_count, 0) || num(row.total_days, 0) * 8;
    const hDisp = h > 0 ? ` ${h}hr` : "";
    return inMonthCreated
      ? `${datePart} ${leaveType}${hDisp}（本月扣補休）`
      : `${datePart} ${leaveType}${hDisp}`;
  }

  if (!hasOverlap) return null;

  const d0 = formatMdFromIso(ymdFromDate(s));
  const d1 = formatMdFromIso(ymdFromDate(e));
  const datePart = d0 === d1 ? d0 : `${d0}–${d1}`;

  const hours = num(row.hours_count, 0);
  if (hours > 0) {
    const hDisp = Number.isInteger(hours) ? String(hours) : String(hours);
    return `${datePart} ${leaveType} ${hDisp}hr`;
  }
  const td = num(row.total_days, 0);
  if (td > 0 && td !== 1) {
    const tdDisp = Number.isInteger(td) ? String(td) : String(td);
    return `${datePart} ${leaveType} ${tdDisp}天`;
  }
  return `${datePart} ${leaveType}`;
}

/**
 * 折抵「加班費」之加班紀錄：approve_overtime_request 寫入 overtime_records 時 reason 前綴【加班費】；
 * 其餘（含【補休】前綴與手動補登／週末戰情核准之舊紀錄）一律視為轉補休。
 */
export function isPayOvertimeRecord(row: Record<string, unknown>): boolean {
  return String(row.reason ?? "").trim().startsWith("【加班費】");
}

function overtimeLineForRow(
  row: Record<string, unknown>,
  overtimeDailyRate?: number,
): string | null {
  const d = String(row.overtime_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const h = num(row.hours, 0);
  if (h <= 0) return null;
  const hDisp = Number.isInteger(h) ? String(h) : String(h);
  const md = formatMdFromIso(d);
  if (!isPayOvertimeRecord(row)) {
    return `${md} 加班轉補休 ${hDisp}hr`;
  }
  const rate = overtimeDailyRate ?? 0;
  if (rate > 0) {
    const amt = Math.round((rate * h) / 8);
    return `${md} 加班費${amt.toLocaleString("zh-TW")}元`;
  }
  return `${md} 加班 ${hDisp}hr（計薪）`;
}

export function sumApprovedOvertimeHoursForEmployee(
  employeeId: string,
  overtimeRows: Record<string, unknown>[],
): number {
  let sum = 0;
  for (const r of overtimeRows) {
    if (String(r.employee_id ?? "") !== employeeId) continue;
    sum += num(r.hours, 0);
  }
  return sum;
}

/** 將加班時數換算為「天數」（8 小時 = 1 天），並四捨五入至 0.5 步階 */
export function overtimeHoursToHalfDaySteps(hours: number): number {
  if (hours <= 0) return 0;
  const days = hours / 8;
  return Math.round(days * 2) / 2;
}

type SortableRemark = { sortKey: string; text: string };

/**
 * 產生單一員工本月備註字串（逗號分隔）。
 */
export function buildPayslipAttendanceRemarks(
  employeeId: string,
  opts: {
    bounds: PayslipRemarkBounds;
    /** 結算月 YYYY-MM：傳入時，特休列於備註若「本月申請」或「本月執行」（起迄與結算月重疊） */
    payPeriodYm?: string;
    attendanceRows: Record<string, unknown>[];
    leaveRows: Record<string, unknown>[];
    overtimeRows: Record<string, unknown>[];
    /** 員工的加班日費率：折抵加班費之紀錄顯示「M/D加班費N元」（時數 × 費率 ÷ 8） */
    overtimeDailyRate?: number;
    /** 結算月內放假日（is_workday=false）：該日不再列出勤異常，並自動寫入「M/D 假日名」 */
    holidays?: PayslipRemarkHoliday[];
  },
): string {
  const {
    bounds,
    payPeriodYm,
    attendanceRows,
    leaveRows,
    overtimeRows,
    overtimeDailyRate,
    holidays,
  } = opts;
  const items: SortableRemark[] = [];

  /** 本員工已核准請假涵蓋的日期：該日打卡異常（無打卡等）不列入備註 */
  const isOnApprovedLeave = (dateIso: string): boolean => {
    for (const row of leaveRows) {
      if (String(row.employee_id ?? "") !== employeeId) continue;
      if (!isLeaveApproved(String(row.status ?? ""))) continue;
      const s = String(row.start_date ?? "").slice(0, 10);
      const e = String(row.end_date ?? s).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s) && dateIso >= s && dateIso <= e) return true;
    }
    return false;
  };

  const holidayList = (holidays ?? []).filter(
    (h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.date >= bounds.start && h.date <= bounds.end,
  );
  const holidayDateSet = new Set(holidayList.map((h) => h.date));

  for (const row of attendanceRows) {
    if (String(row.employee_id ?? "") !== employeeId) continue;
    const dateIso = String(row.attendance_date ?? "").slice(0, 10);
    // 已請假或放假日且當天完全沒有打卡：無打卡是正常的，不列出勤異常。
    // （仍有打卡者照常判斷，例如請半天假但遲到）
    const hasAnyPunch =
      (row.clock_in != null && String(row.clock_in).trim() !== "") ||
      (row.clock_out != null && String(row.clock_out).trim() !== "");
    if (!hasAnyPunch && (isOnApprovedLeave(dateIso) || holidayDateSet.has(dateIso))) continue;
    const line = attendanceLineForRow(row);
    if (!line) continue;
    const sortKey = dateIso;
    items.push({ sortKey, text: line });
  }

  for (const h of holidayList) {
    items.push({ sortKey: h.date, text: `${formatMdFromIso(h.date)} ${h.name}` });
  }

  for (const row of leaveRows) {
    if (String(row.employee_id ?? "") !== employeeId) continue;
    const line = leaveLineForRow(row, bounds, payPeriodYm);
    if (!line) continue;
    const start = String(row.start_date ?? "").slice(0, 10);
    items.push({ sortKey: start, text: line });
  }

  for (const row of overtimeRows) {
    if (String(row.employee_id ?? "") !== employeeId) continue;
    const line = overtimeLineForRow(row, overtimeDailyRate);
    if (!line) continue;
    const sortKey = String(row.overtime_date ?? "").slice(0, 10);
    items.push({ sortKey, text: line });
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const { text } of items) {
    if (seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
  }

  return deduped.join(", ");
}
