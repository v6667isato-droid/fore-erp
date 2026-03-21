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
  const [h, mi] = t.split(":").map((x) => Number(x));
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
} as const;

function normalizeLeaveApproved(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

export type LeaveSpan = {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
};

/** 當日是否在核准假單區間內（含首尾，以 ISO 日期字串比較） */
export function approvedLeaveTypeForDay(
  leaves: LeaveSpan[],
  employeeId: string,
  dayIso: string,
): string | null {
  for (const L of leaves) {
    if (!normalizeLeaveApproved(L.status)) continue;
    if (String(L.employee_id) !== String(employeeId)) continue;
    const s = String(L.start_date).slice(0, 10);
    const e = String(L.end_date).slice(0, 10);
    if (dayIso >= s && dayIso <= e) return String(L.leave_type ?? "請假").trim() || "請假";
  }
  return null;
}

const LATE_AFTER_MIN = 9 * 60 + 15; // > 09:15 → 遲到（分鐘精度，等同 09:15:59 寬限）
const EARLY_BEFORE_MIN = 17 * 60 + 45; // < 17:45 → 早退
const MIN_WORK_MINUTES = 7 * 60 + 45; // 7h45m

function weekdayLabelFromIso(iso: string): string {
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
  missing: "缺卡",
  late: "遲到",
  early: "早退",
  short: "工時不足",
  weekend: "假日出勤",
};

function calendarShortLabel(tag: WarRoomTag): string {
  return CALENDAR_SHORT[tag.id] ?? tag.label;
}

/**
 * 建構戰情列：需已對應 employeeId（無則無法比對假單，但仍可算打卡異常）。
 */
export function buildWarRoomRows(
  rows: AttendanceDayRow[],
  nameByUid: Map<string, { employeeId: string | null; name: string }>,
  leaves: LeaveSpan[],
): WarRoomRow[] {
  const out: WarRoomRow[] = [];

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

    const leaveType =
      employeeId != null ? approvedLeaveTypeForDay(leaves, employeeId, iso) : null;

    if (leaveType) {
      tags.push({
        id: TAG.leave.id,
        label: `🌴 已請假 (${leaveType})`,
        className: TAG.leave.className,
      });
    }

    if (!leaveType && missingPunch) {
      tags.push({ ...TAG.missing, label: TAG.missing.label });
    }

    if (isWeekendIso(iso) && hasPunch) {
      tags.push({ ...TAG.weekend, label: TAG.weekend.label });
    }

    if (!leaveType && !missingPunch && inM != null && outM != null && outM > inM) {
      if (!isWeekendIso(iso)) {
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

/** 日曆用：僅顯示「有異常標籤」或「假日出勤」的日期之條目 */
export function buildCalendarEntriesByDay(
  warRows: WarRoomRow[],
): Map<number, CalendarDayEntry[]> {
  const map = new Map<number, CalendarDayEntry[]>();

  for (const r of warRows) {
    const day = Number(r.dateIso.slice(8, 10));
    if (!Number.isFinite(day)) continue;

    const interest = r.tags.filter(
      (t) =>
        t.id !== "leave" &&
        (t.id === "weekend" ||
          t.id === "missing" ||
          t.id === "late" ||
          t.id === "early" ||
          t.id === "short"),
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
