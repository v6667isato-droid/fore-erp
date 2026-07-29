import { supabase } from "@/lib/supabase";

/**
 * 資料庫 `leave_requests.start_date` / `end_date` 建議型別：`date`
 * 寫入／讀取請一律使用 **ISO 日曆日字串 `YYYY-MM-DD`**（與 `<input type="date">` 一致，不含時分秒）。
 */
export function normalizeLeaveRequestDate(raw: string): string | null {
  const s = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

export type InsertEmployeeLeaveInput = {
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  /** 舊欄位：與起始日區間相同，供僅有 start_hour/end_hour 的環境 */
  startHour: number | null;
  endHour: number | null;
  startDayStartHour: number | null;
  startDayEndHour: number | null;
  endDayStartHour: number | null;
  endDayEndHour: number | null;
  hoursCount: number | null;
  daysCount: number;
  reason: string | null;
  /** leave-attachments bucket 內的物件路徑（無附件時為 null） */
  attachmentUrl?: string | null;
};

function isUnknownColumnError(message: string): boolean {
  return /could not find|column .* does not exist|schema cache/i.test(message);
}

export async function insertEmployeeLeaveRequest(
  input: InsertEmployeeLeaveInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const startDate = normalizeLeaveRequestDate(input.startDate);
  const endDate = normalizeLeaveRequestDate(input.endDate);
  if (!startDate || !endDate) {
    return {
      ok: false,
      message: "請假起始日、結束日格式須為 YYYY-MM-DD（例如 2026-03-20）",
    };
  }

  const base: Record<string, unknown> = {
    employee_id: input.employeeId,
    leave_type: input.leaveType,
    start_date: startDate,
    end_date: endDate,
    hours_count: input.hoursCount,
    total_days: input.daysCount,
    status: "pending",
    reason: input.reason,
    ...(input.attachmentUrl ? { attachment_url: input.attachmentUrl } : {}),
  };

  const withLegacyHours: Record<string, unknown> = {
    ...base,
    start_hour: input.startHour,
    end_hour: input.endHour,
  };

  const withExtendedHours: Record<string, unknown> = {
    ...withLegacyHours,
    reason: input.reason,
    start_day_start_hour: input.startDayStartHour,
    start_day_end_hour: input.startDayEndHour,
    end_day_start_hour: input.endDayStartHour,
    end_day_end_hour: input.endDayEndHour,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 漸進相容舊 schema，欄位組合因環境而異
  let { error } = await supabase.from("leave_requests").insert(withExtendedHours as any);

  if (error && isUnknownColumnError(error.message)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await supabase.from("leave_requests").insert(withLegacyHours as any);
    error = r.error;
  }

  if (error && isUnknownColumnError(error.message)) {
    const bare: Record<string, unknown> = {
      ...base,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await supabase.from("leave_requests").insert(bare as any);
    error = r.error;
  }

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
