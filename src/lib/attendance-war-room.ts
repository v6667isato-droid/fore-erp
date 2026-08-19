import type { AttendanceDayRow } from "@/lib/attendance-csv";

export type WarRoomTag = {
  id: string;
  label: string;
  className: string;
};

export type WarRoomRow = {
  dateIso: string;
  dateDisplay: string;
  weekdayLabel: string;
  uid: string;
  employeeName: string;
  employeeId: string | null;
  clockIn: string | null;
  clockOut: string | null;
  hoursDay: number | null;
  tags: WarRoomTag[];
};

export type CalendarDayEntry = {
  employeeName: string;
  shortLabel: string;
  tagId: string;
};

/**
 * 假日出勤 **或** 時數超時（>9h）：已對應 employee_id、上下班皆打卡且可算工時 →
 * 可「核准／確認加班」轉補休（若該日尚未寫入 overtime_records）。
 */
export function isOvertimeCompApprovable(r: WarRoomRow): boolean {
  if (!r.employeeId) return false;
  if (r.clockIn == null || r.clockOut == null) return false;
  if (r.hoursDay == null || !(r.hoursDay > 0)) return false;
  return (
    r.tags.some((t) => t.id === "weekend") ||
    r.tags.some((t) => t.id === "hours_high") ||
    r.tags.some((t) => t.id === "holiday_work") ||
    r.tags.some((t) => t.id === "holiday_work_unpaid")
  );
}

/** 操作欄按鈕：平日超時用「確認加班」，假日用「核准加班」。 */
export function overtimeApprovalButtonLabel(r: WarRoomRow): string {
  const hi = r.tags.some((t) => t.id === "hours_high");
  const wk = r.tags.some((t) => t.id === "weekend");
  const hw =
    r.tags.some((t) => t.id === "holiday_work") ||
    r.tags.some((t) => t.id === "holiday_work_unpaid");
  if (hi && !wk && !hw) return "✅ 確認加班";
  return "✅ 核准加班";
}

/** @deprecated 請改用 isOvertimeCompApprovable */
export function isWeekendOvertimeApprovable(r: WarRoomRow): boolean {
  return isOvertimeCompApprovable(r);
}

/** "2025/10/1" → "2025-10" */
export function dateStrToYm(dateStr: string): string | null {
  const m = /^(\d{4})[\/\-.](\d{1,2})/.exec(dateStr.trim());
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
}

/** "2025/10/1" → "2025-10-01" */
export function dateStrToIso(dateStr: string): string | null {
  const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(dateStr.trim());
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

export function pickDominantMonth(rows: AttendanceDayRow[]): {
  ym: string;
  filtered: AttendanceDayRow[];
} {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const ym = dateStrToYm(r.date);
    if (!ym) continue;
    counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  let bestYm = "";
  let bestCount = -1;
  for (const [ym, c] of counts) {
    if (c > bestCount || (c === bestCount && ym > bestYm)) {
      bestCount = c;
      bestYm = ym;
    }
  }
  if (!bestYm) return { ym: "", filtered: [] };
  const filtered = rows.filter((r) => dateStrToYm(r.date) === bestYm);
  return { ym: bestYm, filtered };
}

function clockToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  const h = Number(parts[0]);
  const mi = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h * 60 + mi;
}

/** 與午休 12:00–13:00 重疊的分鐘數，最多 60 */
function lunchOverlapMinutes(inM: number, outM: number): number {
  const L0 = 12 * 60;
  const L1 = 13 * 60;
  if (outM <= L0 || inM >= L1) return 0;
  return Math.min(60, Math.min(outM, L1) - Math.max(inM, L0));
}

export function effectiveWorkMinutes(inM: number, outM: number): number {
  return outM - inM - lunchOverlapMinutes(inM, outM);
}

const TAG = {
  missing: {
    id: "missing",
    label: "⚠️ 缺卡",
    className:
      "border-red-300 bg-red-600 text-white dark:border-red-800 dark:bg-red-700",
  },
  leave: {
    id: "leave",
    label: "🌴 已請假",
    className:
      "border-emerald-600/40 bg-emerald-700/90 text-white dark:bg-emerald-800",
  },
  late: {
    id: "late",
    label: "⏰ 遲到",
    className:
      "border-amber-600/50 bg-amber-600 text-amber-950 dark:bg-amber-700 dark:text-amber-50",
  },
  early: {
    id: "early",
    label: "🏃 早退",
    className:
      "border-orange-500/50 bg-orange-600 text-white dark:bg-orange-700",
  },
  short: {
    id: "short",
    label: "📉 工時不足",
    className:
      "border-violet-500/40 bg-violet-700 text-violet-50 dark:bg-violet-800",
  },
  weekend: {
    id: "weekend",
    label: "💰 假日出勤",
    className:
      "border-sky-500/50 bg-sky-600 text-white dark:border-sky-700 dark:bg-sky-700",
  },
  /** 當日有效工時 ≤7h（與 7h45「工時不足」閾值不同，提示小時假等） */
  hoursLow: {
    id: "hours_low",
    label: "📉 時數不足：可能有請小時計算的假",
    className:
      "border-amber-600/45 bg-amber-100/95 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-50",
  },
  /** 當日有效工時 >9h */
  hoursHigh: {
    id: "hours_high",
    label: "時間超時",
    className:
      "border-red-500 bg-red-600 text-white dark:border-red-700 dark:bg-red-700",
  },
  /** 上下班欄位皆有值，但無法算出有效時數（格式異常、下班早於上班等） */
  hoursInvalid: {
    id: "hours_invalid",
    label: "⏱️ 時數異常",
    className:
      "border-rose-600/50 bg-rose-600 text-white dark:border-rose-700 dark:bg-rose-700",
  },
  absent: {
    id: "absent",
    label: "🚫 未出勤（無打卡紀錄）",
    className:
      "border-red-600/45 bg-red-700/95 text-white dark:border-red-800 dark:bg-red-950/80",
  },
} as const;

/** leave_requests.status：視為已核准（與假單審核頁一致） */
export function isApprovedLeaveStatus(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

export type LeaveSpan = {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
  /** leave_requests.total_days（跨日假單之申請天數，可為小數） */
  total_days?: number | null;
};

/** Supabase `public_holidays`：is_workday=false 放假；true=補班（視同平日）；is_paid 放假是否支薪 */
export type PublicHolidayEntry = {
  holiday_date: string;
  name: string;
  is_workday: boolean;
  is_paid: boolean;
};

function coerceIsWorkday(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "t" || s === "1";
  }
  if (typeof v === "number" && v === 1) return true;
  return false;
}

function coerceIsPaid(v: unknown): boolean {
  if (v === false) return false;
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "f") return false;
    if (s === "true" || s === "1" || s === "t") return true;
  }
  if (typeof v === "number" && v === 0) return false;
  return true;
}

/**
 * 將 API／Table Editor 可能回傳的日期統一為 YYYY-MM-DD（斜線、單數月日、含 T 的 ISO 皆可）。
 * 避免 `2026/02/19` 或 `2026-2-3` 導致正規化失敗、月曆整月空白。
 */
export function parsePublicHolidayDateKey(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    const dash = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (dash) {
      const y = dash[1];
      const mo = Number(dash[2]);
      const da = Number(dash[3]);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
    const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
    if (slash) {
      const y = slash[1];
      const mo = Number(slash[2]);
      const da = Number(slash[3]);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
    return null;
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const mo = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const da = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

/** 主力月 `YYYY-M` 或 `YYYY-MM` → 與 holiday_date 比對用的前綴 `YYYY-MM-`（月固定兩位） */
export function normalizeYmMonthPrefix(ym: string): string | null {
  const t = ym.trim();
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const y = m[1];
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-`;
}

/** 將 Supabase 列正規化（相容 `holiday_date` 或 `date` 欄） */
export function normalizePublicHolidayRows(
  rows: Record<string, unknown>[],
): PublicHolidayEntry[] {
  const out: PublicHolidayEntry[] = [];
  for (const r of rows) {
    const raw = r.holiday_date ?? r.date;
    const d = parsePublicHolidayDateKey(raw);
    if (!d) continue;
    const name = String(r.name ?? "國定假日").trim() || "國定假日";
    const hasPaidKey = Object.prototype.hasOwnProperty.call(r, "is_paid");
    out.push({
      holiday_date: d,
      name,
      is_workday: coerceIsWorkday(r.is_workday),
      is_paid: hasPaidKey ? coerceIsPaid(r.is_paid) : true,
    });
  }
  return out;
}

function buildHolidayMap(holidays: PublicHolidayEntry[]): Map<string, PublicHolidayEntry> {
  const m = new Map<string, PublicHolidayEntry>();
  for (const h of holidays) {
    m.set(h.holiday_date.slice(0, 10), h);
  }
  return m;
}

function parseTotalDaysField(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 某日落在核准假單區間內時，回傳假別與該筆假單之 total_days（供標籤顯示）。
 */
export function approvedLeaveDetailForDay(
  targetDate: string,
  employeeId: string,
  leaveRequests: LeaveSpan[],
): { leaveType: string; totalDays: number | null } | null {
  const eid = String(employeeId).trim();
  if (!eid) return null;
  const dayIso = dateStrToIso(targetDate.trim());
  if (!dayIso) return null;

  for (const L of leaveRequests) {
    if (!isApprovedLeaveStatus(L.status)) continue;
    if (String(L.employee_id) !== eid) continue;
    const s = String(L.start_date).slice(0, 10);
    const e = String(L.end_date).slice(0, 10);
    if (dayIso >= s && dayIso <= e) {
      const leaveType = String(L.leave_type ?? "請假").trim() || "請假";
      const rawTd =
        L.total_days !== undefined && L.total_days !== null
          ? L.total_days
          : (L as Record<string, unknown>).days_count;
      const totalDays = parseTotalDaysField(rawTd);
      return { leaveType, totalDays };
    }
  }
  return null;
}

/** 請假標籤用：total_days 顯示字串 */
export function formatLeaveTotalDaysSnippet(totalDays: number | null): string | null {
  if (totalDays == null || !Number.isFinite(totalDays)) return null;
  const r = Math.round(totalDays * 10) / 10;
  const s =
    Math.abs(r - Math.round(r)) < 1e-6
      ? String(Math.round(r))
      : r.toLocaleString("zh-TW", { maximumFractionDigits: 1 });
  return `${s}天`;
}

function buildApprovedLeaveTagLabel(leaveType: string, totalDays: number | null): string {
  const snip = formatLeaveTotalDaysSnippet(totalDays);
  if (snip) return `🌴 已請假（${leaveType}·${snip}）`;
  return `🌴 已請假（${leaveType}）`;
}

function rowHasBothClockStrings(r: AttendanceDayRow): boolean {
  const a = r.clockIn != null && String(r.clockIn).trim() !== "";
  const b = r.clockOut != null && String(r.clockOut).trim() !== "";
  return a && b;
}

/**
 * 判定某日是否落在該員工任一「已核准」假單的 start_date～end_date（含首尾）。
 * @param targetDate 出勤日，支援 YYYY/MM/DD、YYYY-M-D 等（與 CSV 日期欄一致）
 * @returns 假別 leave_type；無則 null
 */
export function isDateInLeaveRange(
  targetDate: string,
  employeeId: string,
  leaveRequests: LeaveSpan[],
): string | null {
  return approvedLeaveDetailForDay(targetDate, employeeId, leaveRequests)?.leaveType ?? null;
}

/** @deprecated 請優先使用 isDateInLeaveRange(targetDate, employeeId, leaves) */
export function approvedLeaveTypeForDay(
  leaves: LeaveSpan[],
  employeeId: string,
  dayIso: string,
): string | null {
  return isDateInLeaveRange(dayIso, employeeId, leaves);
}

const LATE_AFTER_MIN = 9 * 60 + 15; // > 09:15 → 遲到（分鐘精度，等同 09:15:59 寬限）
const EARLY_BEFORE_MIN = 17 * 60 + 45; // < 17:45 → 早退
const MIN_WORK_MINUTES = 7 * 60 + 45; // 7h45m
/** 戰情室：有效工時 ≤7h／>9h 之提示（扣午休後之 hoursDay） */
const DAY_HOURS_LOW_MAX = 7;
const DAY_HOURS_HIGH_MIN = 9;

export function weekdayLabelFromIso(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString("zh-TW", { weekday: "short" });
}

function isWeekendIso(iso: string): boolean {
  const [y, mo, d] = iso.split("-").map(Number);
  const w = new Date(y, mo - 1, d).getDay();
  return w === 0 || w === 6;
}

const CALENDAR_SHORT: Record<string, string> = {
  late: "遲到",
  early: "早退",
  short: "工時不足",
  weekend: "假日出勤",
  hours_low: "時數不足",
  hours_high: "時間超時",
  hours_invalid: "時數異常",
  absent: "未出勤",
  holiday_rest: "國定假日",
  holiday_work: "國定假日出勤",
  holiday_rest_unpaid: "無薪特殊假",
  holiday_work_unpaid: "無薪假出勤",
};

function calendarShortLabel(tag: WarRoomTag): string {
  if (tag.id === "leave") {
    const m = /[（(]([^）)]+)[）)]/.exec(tag.label);
    return m ? `已請假·${m[1]}` : "已請假";
  }
  if (
    tag.id === "holiday_rest" ||
    tag.id === "holiday_work" ||
    tag.id === "holiday_rest_unpaid" ||
    tag.id === "holiday_work_unpaid"
  ) {
    const dash = / — (.+)$/.exec(tag.label);
    if (dash) return `${CALENDAR_SHORT[tag.id] ?? tag.label}·${dash[1]}`;
    const m = /\(([^)]+)\)/.exec(tag.label);
    const base = CALENDAR_SHORT[tag.id] ?? tag.label;
    return m ? `${base}·${m[1]}` : base;
  }
  if (tag.id === "missing") {
    return tag.label.replace(/^⚠️\s*/, "").trim() || "缺卡";
  }
  return CALENDAR_SHORT[tag.id] ?? tag.label;
}

/** 僅有單邊打卡時：區分缺上班卡 / 缺下班卡 */
function missingPunchDisplayLabel(
  clockIn: string | null,
  clockOut: string | null,
): string {
  if (clockIn == null && clockOut != null) return "⚠️ 缺上班卡";
  if (clockIn != null && clockOut == null) return "⚠️ 缺下班卡";
  return TAG.missing.label;
}

/**
 * 建構戰情列：需已對應 employeeId（無則無法比對假單，但仍可算打卡異常）。
 * `publicHolidays`：國定假日／補班（`public_holidays`），放假日豁免缺卡／遲到等；補班日視同平日。
 */
export function buildWarRoomRows(
  rows: AttendanceDayRow[],
  nameByUid: Map<string, { employeeId: string | null; name: string }>,
  leaves: LeaveSpan[],
  publicHolidays: PublicHolidayEntry[] = [],
): WarRoomRow[] {
  const out: WarRoomRow[] = [];
  const holidayMap = buildHolidayMap(publicHolidays);

  const holidayRestClass =
    "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-700 dark:bg-emerald-800";
  const holidayRestUnpaidClass =
    "border-fuchsia-700 bg-fuchsia-600 text-white shadow-md ring-2 ring-fuchsia-400/60 dark:border-fuchsia-500 dark:bg-fuchsia-800 dark:ring-fuchsia-500/40";
  const holidayWorkClass =
    "border-amber-600 bg-amber-600 text-amber-950 dark:border-amber-700 dark:bg-amber-700 dark:text-amber-50";
  const holidayWorkUnpaidClass =
    "border-orange-600 bg-orange-600 text-white dark:border-orange-700 dark:bg-orange-800";

  for (const r of rows) {
    const iso = dateStrToIso(r.date);
    if (!iso) continue;

    const mapped = nameByUid.get(r.uid.trim()) ?? {
      employeeId: null,
      name: r.displayName || "—",
    };
    const employeeId = mapped.employeeId;
    const employeeName = mapped.name;

    const inM = clockToMinutes(r.clockIn);
    const outM = clockToMinutes(r.clockOut);
    const hasPunch = inM != null || outM != null;
    const missingPunch =
      (r.clockIn != null && r.clockOut == null) ||
      (r.clockIn == null && r.clockOut != null);

    let hoursDay: number | null = null;
    if (inM != null && outM != null && outM > inM) {
      hoursDay =
        Math.round((effectiveWorkMinutes(inM, outM) / 60) * 10) / 10;
    }

    const tags: WarRoomTag[] = [];

    const leaveDetail =
      employeeId != null ? approvedLeaveDetailForDay(r.date, employeeId, leaves) : null;

    if (leaveDetail) {
      tags.push({
        id: TAG.leave.id,
        label: buildApprovedLeaveTagLabel(leaveDetail.leaveType, leaveDetail.totalDays),
        className: TAG.leave.className,
      });
      if (rowHasBothClockStrings(r) && !missingPunch && hoursDay == null) {
        tags.push({ ...TAG.hoursInvalid, label: TAG.hoursInvalid.label });
      }
      const dateDisplay = iso.replace(/-/g, "/");
      out.push({
        dateIso: iso,
        dateDisplay,
        weekdayLabel: weekdayLabelFromIso(iso),
        uid: r.uid,
        employeeName,
        employeeId,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
        hoursDay,
        tags,
      });
      continue;
    }

    const hol = holidayMap.get(iso);
    if (hol && !hol.is_workday) {
      if (!hasPunch) {
        if (hol.is_paid) {
          tags.push({
            id: "holiday_rest",
            label: `🎉 國定假日 (${hol.name})`,
            className: holidayRestClass,
          });
        } else {
          tags.push({
            id: "holiday_rest_unpaid",
            label: `🌪️ 颱風/特殊假 (不支薪) — ${hol.name}`,
            className: holidayRestUnpaidClass,
          });
        }
      } else if (hol.is_paid) {
        tags.push({
          id: "holiday_work",
          label: `💰 國定假日出勤 (${hol.name})`,
          className: holidayWorkClass,
        });
      } else {
        tags.push({
          id: "holiday_work_unpaid",
          label: `💰 特殊假出勤 (不支薪)（${hol.name}）`,
          className: holidayWorkUnpaidClass,
        });
      }
      if (rowHasBothClockStrings(r) && !missingPunch && hoursDay == null) {
        tags.push({ ...TAG.hoursInvalid, label: TAG.hoursInvalid.label });
      }
      const dateDisplay = iso.replace(/-/g, "/");
      out.push({
        dateIso: iso,
        dateDisplay,
        weekdayLabel: weekdayLabelFromIso(iso),
        uid: r.uid,
        employeeName,
        employeeId,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
        hoursDay,
        tags,
      });
      continue;
    }

    const isMakeupWorkday = hol?.is_workday === true;
    const calendarWeekend = isWeekendIso(iso);
    const applyWeekdayDiscipline = !calendarWeekend || isMakeupWorkday;

    if (missingPunch && applyWeekdayDiscipline) {
      tags.push({
        ...TAG.missing,
        label: missingPunchDisplayLabel(r.clockIn, r.clockOut),
      });
    }

    if (calendarWeekend && hasPunch && !isMakeupWorkday) {
      tags.push({ ...TAG.weekend, label: TAG.weekend.label });
    }

    if (!missingPunch && inM != null && outM != null && outM > inM && applyWeekdayDiscipline) {
      if (inM > LATE_AFTER_MIN) {
        tags.push({ ...TAG.late, label: TAG.late.label });
      }
      if (outM < EARLY_BEFORE_MIN) {
        tags.push({ ...TAG.early, label: TAG.early.label });
      }
      const workM = effectiveWorkMinutes(inM, outM);
      if (workM < MIN_WORK_MINUTES) {
        tags.push({ ...TAG.short, label: TAG.short.label });
      }
    }

    if (
      !missingPunch &&
      inM != null &&
      outM != null &&
      outM > inM &&
      hoursDay != null
    ) {
      if (hoursDay <= DAY_HOURS_LOW_MAX) {
        tags.push({ ...TAG.hoursLow, label: TAG.hoursLow.label });
      } else if (hoursDay > DAY_HOURS_HIGH_MIN) {
        tags.push({ ...TAG.hoursHigh, label: TAG.hoursHigh.label });
      }
    }

    if (rowHasBothClockStrings(r) && !missingPunch && hoursDay == null) {
      tags.push({ ...TAG.hoursInvalid, label: TAG.hoursInvalid.label });
    }

    const dateDisplay = iso.replace(/-/g, "/");

    out.push({
      dateIso: iso,
      dateDisplay,
      weekdayLabel: weekdayLabelFromIso(iso),
      uid: r.uid,
      employeeName,
      employeeId,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      hoursDay,
      tags,
    });
  }

  out.sort((a, b) => {
    const dc = a.dateIso.localeCompare(b.dateIso);
    if (dc !== 0) return dc;
    return a.employeeName.localeCompare(b.employeeName, "zh-Hant");
  });

  return out;
}

/** 已核准補打卡申請（makeup_punch_requests；時間取 HH:MM） */
export type MakeupPunchSpan = {
  employee_id: string;
  /** YYYY-MM-DD */
  punch_date: string;
  clock_in: string | null;
  clock_out: string | null;
};

export const MAKEUP_PUNCH_TAG: WarRoomTag = {
  id: "makeup",
  label: "📝 已補卡",
  className:
    "border-teal-600/45 bg-teal-600 text-white dark:border-teal-700 dark:bg-teal-800",
};

function makeupKey(employeeId: string, iso: string): string {
  return `${employeeId}\t${iso}`;
}

/**
 * 匯入統計前，將已核准的補卡單併入 CSV 打卡列：
 * 既有列只補「缺的那側」（實卡不覆蓋）；該員工該日完全無 CSV 列時合成一列。
 * 回傳 patchedKeys（`employeeId\tYYYY-MM-DD`）供 appendMakeupPunchTags 標示，
 * extraNameByUid 為合成列使用之替代 uid（員工無 timeclock_uid 時）→ 員工對應。
 */
export function applyApprovedMakeupPunches(
  rows: AttendanceDayRow[],
  makeups: MakeupPunchSpan[],
  empByUid: Map<string, { id: string; name: string }>,
): {
  rows: AttendanceDayRow[];
  patchedKeys: Set<string>;
  extraNameByUid: Map<string, { employeeId: string | null; name: string }>;
} {
  const patchedKeys = new Set<string>();
  const extraNameByUid = new Map<string, { employeeId: string | null; name: string }>();
  if (makeups.length === 0) return { rows, patchedKeys, extraNameByUid };

  const uidByEmpId = new Map<string, string>();
  const nameByEmpId = new Map<string, string>();
  for (const [uid, emp] of empByUid) {
    if (!uidByEmpId.has(emp.id)) uidByEmpId.set(emp.id, uid);
    if (!nameByEmpId.has(emp.id)) nameByEmpId.set(emp.id, emp.name);
  }

  const out = [...rows];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!;
    const empId = empByUid.get(r.uid.trim())?.id;
    if (!empId) continue;
    const iso = dateStrToIso(r.date);
    if (!iso) continue;
    const k = makeupKey(empId, iso);
    if (!indexByKey.has(k)) indexByKey.set(k, i);
  }

  for (const m of makeups) {
    const empId = String(m.employee_id ?? "").trim();
    const iso = String(m.punch_date ?? "").slice(0, 10);
    if (!empId || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const mIn = m.clock_in != null ? m.clock_in.slice(0, 5) : null;
    const mOut = m.clock_out != null ? m.clock_out.slice(0, 5) : null;
    if (mIn == null && mOut == null) continue;

    const k = makeupKey(empId, iso);
    const idx = indexByKey.get(k);
    if (idx != null) {
      const r = out[idx]!;
      const newIn = r.clockIn ?? mIn;
      const newOut = r.clockOut ?? mOut;
      if (newIn === r.clockIn && newOut === r.clockOut) continue;
      out[idx] = {
        ...r,
        clockIn: newIn,
        clockOut: newOut,
        missingPunch: (newIn == null) !== (newOut == null),
      };
      patchedKeys.add(k);
      continue;
    }

    const uid = uidByEmpId.get(empId) ?? `makeup:${empId}`;
    if (!uidByEmpId.has(empId)) {
      extraNameByUid.set(uid, { employeeId: empId, name: nameByEmpId.get(empId) ?? "—" });
    }
    out.push({
      uid,
      displayName: nameByEmpId.get(empId) ?? "—",
      date: iso,
      clockIn: mIn,
      clockOut: mOut,
      missingPunch: (mIn == null) !== (mOut == null),
    });
    indexByKey.set(k, out.length - 1);
    patchedKeys.add(k);
  }

  return { rows: out, patchedKeys, extraNameByUid };
}

/** 於戰情列補上「📝 已補卡」標籤（合併過補卡單的員工日） */
export function appendMakeupPunchTags(
  warRows: WarRoomRow[],
  patchedKeys: Set<string>,
): WarRoomRow[] {
  if (patchedKeys.size === 0) return warRows;
  return warRows.map((r) => {
    if (!r.employeeId) return r;
    if (!patchedKeys.has(makeupKey(r.employeeId, r.dateIso.slice(0, 10)))) return r;
    if (r.tags.some((t) => t.id === MAKEUP_PUNCH_TAG.id)) return r;
    return { ...r, tags: [...r.tags, MAKEUP_PUNCH_TAG] };
  });
}

/** 週一至週五（曆日 ISO） */
export function isWeekdayCalendarIso(iso: string): boolean {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  const w = new Date(y, mo - 1, d).getDay();
  return w >= 1 && w <= 5;
}

/**
 * 在職員工於主力月份之**應出勤日**（平日或補班週末）：若該日無任何打卡紀錄且非核准假單涵蓋日、非國定放假日，補上一列警示（uid 前綴 `absent:`）。
 */
export function appendAbsentEmployeeWarnings(
  warRows: WarRoomRow[],
  ym: string,
  activeEmployees: { id: string; name: string }[],
  leaves: LeaveSpan[],
  publicHolidays: PublicHolidayEntry[] = [],
): WarRoomRow[] {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return warRows;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return warRows;

  const holidayMap = buildHolidayMap(publicHolidays);

  function isExpectedWorkdayForAbsent(iso: string): boolean {
    const h = holidayMap.get(iso);
    if (h && !h.is_workday) return false;
    if (isWeekdayCalendarIso(iso)) return true;
    return h?.is_workday === true;
  }

  const punchByEmpDate = new Set<string>();
  for (const r of warRows) {
    if (!r.employeeId) continue;
    if (r.clockIn == null && r.clockOut == null) continue;
    punchByEmpDate.add(`${r.employeeId}\t${r.dateIso.slice(0, 10)}`);
  }

  const lastDay = new Date(y, mo, 0).getDate();
  const extra: WarRoomRow[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const iso = `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
    if (!isExpectedWorkdayForAbsent(iso)) continue;

    for (const emp of activeEmployees) {
      if (isDateInLeaveRange(iso, emp.id, leaves)) continue;
      const key = `${emp.id}\t${iso}`;
      if (punchByEmpDate.has(key)) continue;

      extra.push({
        dateIso: iso,
        dateDisplay: iso.replace(/-/g, "/"),
        weekdayLabel: weekdayLabelFromIso(iso),
        uid: `absent:${emp.id}`,
        employeeName: emp.name,
        employeeId: emp.id,
        clockIn: null,
        clockOut: null,
        hoursDay: null,
        tags: [{ id: TAG.absent.id, label: TAG.absent.label, className: TAG.absent.className }],
      });
    }
  }

  const merged = [...warRows, ...extra];
  merged.sort((a, b) => {
    const dc = a.dateIso.localeCompare(b.dateIso);
    if (dc !== 0) return dc;
    const aAbs = a.uid.startsWith("absent:") ? 1 : 0;
    const bAbs = b.uid.startsWith("absent:") ? 1 : 0;
    if (aAbs !== bAbs) return aAbs - bAbs;
    return a.employeeName.localeCompare(b.employeeName, "zh-Hant");
  });
  return merged;
}

/**
 * 主力月內：該日有核准假單，但 CSV 戰情列尚無該員工該日之列（例如完全沒打卡紀錄）時，
 * 補上一列僅顯示請假標籤（uid 前綴 `leave-only:`）。已存在之列（含雙邊／單邊打卡）不重複。
 */
export function appendLeaveOnlyRowsWithoutPunch(
  warRows: WarRoomRow[],
  ym: string,
  activeEmployees: { id: string; name: string }[],
  leaves: LeaveSpan[],
): WarRoomRow[] {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return warRows;

  const covered = new Set<string>();
  for (const r of warRows) {
    const iso = r.dateIso.slice(0, 10);
    const key = r.employeeId ? `${r.employeeId}\t${iso}` : `${r.uid}\t${iso}`;
    covered.add(key);
  }

  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return warRows;

  const lastDay = new Date(y, mo, 0).getDate();
  const extra: WarRoomRow[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const iso = `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
    for (const emp of activeEmployees) {
      const key = `${emp.id}\t${iso}`;
      if (covered.has(key)) continue;
      const leaveDetail = approvedLeaveDetailForDay(iso, emp.id, leaves);
      if (!leaveDetail) continue;
      extra.push({
        dateIso: iso,
        dateDisplay: iso.replace(/-/g, "/"),
        weekdayLabel: weekdayLabelFromIso(iso),
        uid: `leave-only:${emp.id}:${iso}`,
        employeeName: emp.name,
        employeeId: emp.id,
        clockIn: null,
        clockOut: null,
        hoursDay: null,
        tags: [
          {
            id: TAG.leave.id,
            label: buildApprovedLeaveTagLabel(
              leaveDetail.leaveType,
              leaveDetail.totalDays,
            ),
            className: TAG.leave.className,
          },
        ],
      });
      covered.add(key);
    }
  }

  const merged = [...warRows, ...extra];
  merged.sort((a, b) => {
    const dc = a.dateIso.localeCompare(b.dateIso);
    if (dc !== 0) return dc;
    return a.employeeName.localeCompare(b.employeeName, "zh-Hant");
  });
  return merged;
}

/** 日曆用：顯示請假豁免、假日出勤與其餘異常 */
export function buildCalendarEntriesByDay(
  warRows: WarRoomRow[],
): Map<number, CalendarDayEntry[]> {
  const map = new Map<number, CalendarDayEntry[]>();

  for (const r of warRows) {
    const day = Number(r.dateIso.slice(8, 10));
    if (!Number.isFinite(day)) continue;

    const interest = r.tags.filter(
      (t) =>
        t.id === "leave" ||
        t.id === "weekend" ||
        t.id === "holiday_rest" ||
        t.id === "holiday_work" ||
        t.id === "holiday_rest_unpaid" ||
        t.id === "holiday_work_unpaid" ||
        t.id === "missing" ||
        t.id === "late" ||
        t.id === "early" ||
        t.id === "short" ||
        t.id === "hours_low" ||
        t.id === "hours_high" ||
        t.id === "hours_invalid" ||
        t.id === "absent",
    );
    if (interest.length === 0) continue;

    const list = map.get(day) ?? [];
    for (const t of interest) {
      list.push({
        employeeName: r.employeeName,
        shortLabel: calendarShortLabel(t),
        tagId: t.id,
      });
    }
    map.set(day, list);
  }

  return map;
}

export type CalendarLeaveEntry = {
  employeeName: string;
  leaveType: string;
  /** 有 total_days 時為「N天」字串 */
  totalDaysSnippet: string | null;
};

/**
 * 月曆第二層：依「該月 1 號～月底」逐日掃描，列出當日在核准假單區間內的在職員工。
 * `scopeEmployeeIds === null` 表示顯示所有 `activeEmployees`；空 Set 表示不顯示任何人。
 */
export function buildCalendarApprovedLeavesByDay(
  ym: string,
  leaves: LeaveSpan[],
  activeEmployees: readonly { id: string; name: string }[],
  scopeEmployeeIds: Set<string> | null,
): Map<number, CalendarLeaveEntry[]> {
  const map = new Map<number, CalendarLeaveEntry[]>();
  const trimmed = ym.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return map;
  const [yStr, mStr] = trimmed.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return map;

  const lastDay = new Date(y, m, 0).getDate();

  for (let d = 1; d <= lastDay; d++) {
    const dateIso = `${trimmed}-${String(d).padStart(2, "0")}`;
    const row: CalendarLeaveEntry[] = [];
    for (const emp of activeEmployees) {
      if (scopeEmployeeIds != null && !scopeEmployeeIds.has(emp.id)) continue;
      const det = approvedLeaveDetailForDay(dateIso, emp.id, leaves);
      if (det) {
        row.push({
          employeeName: emp.name,
          leaveType: det.leaveType,
          totalDaysSnippet: formatLeaveTotalDaysSnippet(det.totalDays),
        });
      }
    }
    if (row.length > 0) {
      row.sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName, "zh-Hant"),
      );
      map.set(d, row);
    }
  }
  return map;
}

/** 月曆第三層：排除已在假單圖層顯示的 leave 標籤，避免與核准假單列重複 */
export function buildCalendarAnomalyEntriesByDay(
  warRows: WarRoomRow[],
): Map<number, CalendarDayEntry[]> {
  const full = buildCalendarEntriesByDay(warRows);
  const next = new Map<number, CalendarDayEntry[]>();
  for (const [day, list] of full) {
    const filtered = list.filter((e) => e.tagId !== "leave");
    if (filtered.length > 0) next.set(day, filtered);
  }
  return next;
}

/** 月曆格頂層標示：放假／補班（與是否有 CSV 列無關） */
export type CalendarHolidayMark = {
  kind: "rest" | "makeup";
  name: string;
  /** 放假日是否支薪；補班日省略 */
  isPaid?: boolean;
};

export function buildCalendarHolidayMarksByDay(
  ym: string,
  holidays: PublicHolidayEntry[],
): Map<number, CalendarHolidayMark[]> {
  const map = new Map<number, CalendarHolidayMark[]>();
  const prefix = normalizeYmMonthPrefix(ym);
  if (!prefix) return map;

  for (const h of holidays) {
    const d = h.holiday_date.slice(0, 10);
    if (!d.startsWith(prefix)) continue;
    const day = Number(d.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    const kind: CalendarHolidayMark["kind"] = h.is_workday ? "makeup" : "rest";
    const list = map.get(day) ?? [];
    list.push({
      kind,
      name: h.name,
      isPaid: h.is_workday ? undefined : h.is_paid,
    });
    map.set(day, list);
  }
  return map;
}

/** 戰情室月曆頂部：主力月份內所有 public_holidays（依日期排序） */
export function listPublicHolidaysInYm(
  ym: string,
  holidays: PublicHolidayEntry[],
): PublicHolidayEntry[] {
  const prefix = normalizeYmMonthPrefix(ym);
  if (!prefix) return [];
  return holidays
    .filter((h) => h.holiday_date.slice(0, 10).startsWith(prefix))
    .sort((a, b) => {
      const dc = a.holiday_date.localeCompare(b.holiday_date);
      return dc !== 0 ? dc : a.name.localeCompare(b.name, "zh-Hant");
    });
}
