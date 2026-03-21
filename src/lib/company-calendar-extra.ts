import {
  isApprovedLeaveStatus,
  normalizePublicHolidayRows,
  type PublicHolidayEntry,
} from "@/lib/attendance-war-room";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

function embedEmployeeName(rel: unknown): string | null {
  if (rel == null) return null;
  const o = Array.isArray(rel) ? rel[0] : rel;
  if (o && typeof o === "object" && "name" in o) {
    const n = (o as { name?: unknown }).name;
    return n != null ? String(n) : null;
  }
  return null;
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 與行事曆可視範圍有日期重疊之已核准假單（含員工姓名、total_days） */
export type CalendarApprovedLeaveRow = {
  id: string;
  employeeName: string;
  leaveType: string;
  totalDays: number;
  startDate: string;
  endDate: string;
};

export async function fetchCalendarPublicHolidaysBetween(
  startIsoDate: string,
  endIsoDate: string,
): Promise<PublicHolidayEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("public_holidays")
    .select("*")
    .gte("holiday_date", startIsoDate)
    .lte("holiday_date", endIsoDate)
    .order("holiday_date", { ascending: true });
  if (error) throw error;
  return normalizePublicHolidayRows((data ?? []) as Record<string, unknown>[]);
}

export async function fetchCalendarApprovedLeavesOverlapping(
  rangeStart: string,
  rangeEnd: string,
): Promise<CalendarApprovedLeaveRow[]> {
  if (!isSupabaseConfigured) return [];
  const withJoin = `
    id,
    employee_id,
    leave_type,
    start_date,
    end_date,
    status,
    total_days,
    employees ( name )
  `;

  let data: Record<string, unknown>[] | null = null;

  const attempt1 = await supabase
    .from("leave_requests")
    .select(withJoin)
    .lte("start_date", rangeEnd)
    .gte("end_date", rangeStart);

  if (!attempt1.error) {
    data = attempt1.data as Record<string, unknown>[];
  } else {
    const plain = await supabase
      .from("leave_requests")
      .select("id, employee_id, leave_type, start_date, end_date, status, total_days")
      .lte("start_date", rangeEnd)
      .gte("end_date", rangeStart);
    if (plain.error) throw plain.error;
    data = plain.data as Record<string, unknown>[];
    const ids = [
      ...new Set(
        (data ?? [])
          .map((r) => String(r.employee_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const nameById = new Map<string, string>();
    if (ids.length) {
      const { data: emps } = await supabase.from("employees").select("id, name").in("id", ids);
      for (const e of emps ?? []) {
        const rec = e as { id: string; name?: string };
        if (rec.id) nameById.set(String(rec.id), String(rec.name ?? "—"));
      }
    }
    return (data ?? [])
      .filter((r) => isApprovedLeaveStatus(String(r.status ?? "")))
      .map((r) => mapLeaveRow(r, nameById));
  }

  return (data ?? [])
    .filter((r) => isApprovedLeaveStatus(String(r.status ?? "")))
    .map((r) => mapLeaveRow(r, new Map()));
}

function mapLeaveRow(
  r: Record<string, unknown>,
  nameById: Map<string, string>,
): CalendarApprovedLeaveRow {
  const id = String(r.id ?? "");
  const eid = String(r.employee_id ?? "").trim();
  const joined = embedEmployeeName(r.employees);
  const startDate = String(r.start_date ?? "").slice(0, 10);
  const endDate = String(r.end_date ?? startDate).slice(0, 10);
  return {
    id,
    employeeName: joined ?? (eid ? nameById.get(eid) ?? "—" : "—"),
    leaveType: String(r.leave_type ?? "請假").trim() || "請假",
    totalDays: num(r.total_days ?? r.days_count, 0),
    startDate,
    endDate,
  };
}

/** 將 start..end（含）之間的 YYYY-MM-DD 列出 */
export function enumerateInclusiveYmd(startYmd: string, endYmd: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return [];
  if (endYmd < startYmd) return [];
  const [y0, m0, d0] = startYmd.split("-").map((x) => Number(x));
  const [y1, m1, d1] = endYmd.split("-").map((x) => Number(x));
  const out: string[] = [];
  const cur = new Date(y0, m0 - 1, d0);
  const last = new Date(y1, m1 - 1, d1);
  while (cur.getTime() <= last.getTime()) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${mo}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function groupPublicHolidaysByDateKey(
  holidays: PublicHolidayEntry[],
): Map<string, PublicHolidayEntry[]> {
  const m = new Map<string, PublicHolidayEntry[]>();
  for (const h of holidays) {
    const k = h.holiday_date.slice(0, 10);
    const list = m.get(k) ?? [];
    list.push(h);
    m.set(k, list);
  }
  return m;
}

export function groupApprovedLeavesByDateKey(
  leaves: CalendarApprovedLeaveRow[],
  /** 只納入此範圍內的曆日（通常為行事曆格起迄） */
  clipStart: string,
  clipEnd: string,
): Map<string, CalendarApprovedLeaveRow[]> {
  const m = new Map<string, CalendarApprovedLeaveRow[]>();
  for (const L of leaves) {
    const days = enumerateInclusiveYmd(L.startDate, L.endDate);
    for (const ymd of days) {
      if (ymd < clipStart || ymd > clipEnd) continue;
      const list = m.get(ymd) ?? [];
      list.push(L);
      m.set(ymd, list);
    }
  }
  return m;
}

export function formatTotalDaysLabel(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const r = Math.round(n * 10) / 10;
  return Math.abs(r - Math.round(r)) < 1e-6 ? String(Math.round(r)) : String(r);
}
