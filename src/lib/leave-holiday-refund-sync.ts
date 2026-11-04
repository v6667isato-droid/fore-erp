import { supabase } from "@/lib/supabase";
import { fetchAllLeaveTypes } from "@/lib/leave-types";
import { isAnnualLeaveTypeName, isCompLeaveTypeName } from "@/lib/leave-hours";
import { postCreationHolidayHits, type HolidayRecord } from "@/lib/leave-holiday-refund";

/** 只掃描近期新增的放假日，避免把很久以前的歷史假日翻出來產生回補單 */
const SCAN_RECENT_DAYS = 90;

export type HolidayRefundRow = {
  id: string;
  leave_request_id: string;
  employee_id: string;
  employee_name: string;
  holiday_date: string;
  holiday_name: string | null;
  hours: number;
  status: "pending" | "approved" | "rejected";
  leave_type: string;
  leave_start: string;
  leave_end: string;
  created_at: string;
};

function isMissingRelation(message: string): boolean {
  return /does not exist|relation|schema cache|could not find/i.test(message);
}

/** 載入 public_holidays（含補班日與建立時間） */
export async function fetchHolidayRecords(): Promise<HolidayRecord[]> {
  const { data, error } = await supabase
    .from("public_holidays")
    .select("holiday_date, name, is_workday, created_at")
    .order("holiday_date", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => r.holiday_date)
    .map((r) => ({
      date: String(r.holiday_date).slice(0, 10),
      name: String(r.name ?? "").trim() || "臨時假日",
      isWorkday: r.is_workday === true,
      createdAt: r.created_at != null ? String(r.created_at) : null,
    }));
}

/**
 * 掃描近期新增的放假日：已核准、且送單時把那天算成上班日的特休／補休／扣薪假單，
 * 產生待審核的假日回補單（同一假單同一天只會建立一次，退回過的也不會重建）。
 */
export async function syncHolidayRefunds(): Promise<{ ok: true; created: number } | { ok: false; message: string }> {
  try {
    const since = Date.now() - SCAN_RECENT_DAYS * 86400000;
    const holidays = await fetchHolidayRecords();
    const recent = holidays.filter((h) => {
      if (h.isWorkday) return false;
      const t = h.createdAt ? new Date(h.createdAt).getTime() : NaN;
      return !Number.isFinite(t) || t >= since;
    });
    if (recent.length === 0) return { ok: true, created: 0 };
    const minDate = recent.reduce((m, h) => (h.date < m ? h.date : m), recent[0].date);
    const maxDate = recent.reduce((m, h) => (h.date > m ? h.date : m), recent[0].date);

    const [leaveRes, refundRes, types] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*")
        .in("status", ["approved", "已核准", "核准"])
        .lte("start_date", maxDate)
        .gte("end_date", minDate),
      supabase.from("leave_holiday_refunds").select("leave_request_id, holiday_date, status"),
      fetchAllLeaveTypes().catch(() => []),
    ]);
    if (leaveRes.error) return { ok: false, message: leaveRes.error.message };
    if (refundRes.error) {
      if (isMissingRelation(refundRes.error.message)) return { ok: true, created: 0 };
      return { ok: false, message: refundRes.error.message };
    }

    const payRatio = new Map(types.map((t) => [t.name, t.pay_ratio]));
    const refundedByLeave = new Map<string, Set<string>>();
    const existing = new Set<string>();
    for (const r of refundRes.data ?? []) {
      const key = `${r.leave_request_id}|${String(r.holiday_date).slice(0, 10)}`;
      existing.add(key);
      if (r.status === "approved") {
        const set = refundedByLeave.get(r.leave_request_id) ?? new Set<string>();
        set.add(String(r.holiday_date).slice(0, 10));
        refundedByLeave.set(r.leave_request_id, set);
      }
    }

    const recentDates = new Set(recent.map((h) => h.date));
    const items: { leave_request_id: string; holiday_date: string; holiday_name: string; hours: number }[] = [];
    for (const row of (leaveRes.data ?? []) as Record<string, unknown>[]) {
      const type = String(row.leave_type ?? "").trim();
      const balanceType = isAnnualLeaveTypeName(type) || isCompLeaveTypeName(type);
      const ratio = payRatio.has(type) ? 1 - (payRatio.get(type) ?? 1) : 0;
      if (!balanceType && ratio <= 0) continue;
      const id = String(row.id);
      const hits = postCreationHolidayHits(row, holidays, refundedByLeave.get(id));
      for (const h of hits) {
        if (!recentDates.has(h.date)) continue;
        if (existing.has(`${id}|${h.date}`)) continue;
        items.push({ leave_request_id: id, holiday_date: h.date, holiday_name: h.name, hours: h.hours });
      }
    }
    if (items.length === 0) return { ok: true, created: 0 };

    const { data, error } = await supabase.rpc("create_holiday_refunds", { p_items: items });
    if (error) return { ok: false, message: error.message };
    const res = (data ?? {}) as { ok?: boolean; created?: number; error?: string };
    if (!res.ok) return { ok: false, message: res.error ?? "建立回補單失敗" };
    return { ok: true, created: Number(res.created ?? 0) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 載入假日回補單（含員工姓名與假單摘要）；資料表尚未建立時回傳空陣列 */
export async function fetchHolidayRefunds(
  statuses: HolidayRefundRow["status"][] = ["pending"],
): Promise<HolidayRefundRow[]> {
  const { data, error } = await supabase
    .from("leave_holiday_refunds")
    .select(
      "id, leave_request_id, employee_id, holiday_date, holiday_name, hours, status, created_at, employees ( name ), leave_requests ( leave_type, start_date, end_date )",
    )
    .in("status", statuses)
    .order("holiday_date", { ascending: true });
  if (error) {
    if (isMissingRelation(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const emp = (Array.isArray(r.employees) ? r.employees[0] : r.employees) as { name?: string } | null;
    const lr = (Array.isArray(r.leave_requests) ? r.leave_requests[0] : r.leave_requests) as
      | { leave_type?: string; start_date?: string; end_date?: string }
      | null;
    return {
      id: String(r.id),
      leave_request_id: String(r.leave_request_id),
      employee_id: String(r.employee_id),
      employee_name: emp?.name ?? "—",
      holiday_date: String(r.holiday_date).slice(0, 10),
      holiday_name: r.holiday_name == null ? null : String(r.holiday_name),
      hours: Number(r.hours) || 0,
      status: (String(r.status) as HolidayRefundRow["status"]) ?? "pending",
      leave_type: String(lr?.leave_type ?? "").trim(),
      leave_start: String(lr?.start_date ?? "").slice(0, 10),
      leave_end: String(lr?.end_date ?? "").slice(0, 10),
      created_at: String(r.created_at),
    };
  });
}
