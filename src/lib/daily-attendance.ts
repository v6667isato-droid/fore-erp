import type { SupabaseClient } from "@supabase/supabase-js";

import type { WarRoomRow } from "@/lib/attendance-war-room";

/** 老闆核准加班轉補休後，應併入該日 status_tags（與 CSV 批次寫入合併時會保留） */
export const COMPOFF_DAILY_ATTENDANCE_TAG = "🔒 已轉補休";

/** 視為異常：遲到、早退、缺卡、工時不足、時數不足／超時等（請假列不寫入此組合） */
export const ABNORMAL_DAILY_ATTENDANCE_TAG_IDS = new Set([
  "missing",
  "late",
  "early",
  "short",
  "hours_low",
  "hours_high",
  "absent",
]);

const UPSERT_CHUNK = 120;

/**
 * 戰情室顯示為 HH:mm；PostgreSQL time 欄位寫入 HH:mm:ss。
 */
export function clockDisplayToDbTime(s: string | null): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === "—") return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = parts.length >= 3 ? Number(parts[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (!Number.isFinite(ss) || ss < 0 || ss > 59) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function rowKey(employeeId: string, attendanceDate: string): string {
  return `${employeeId}\t${attendanceDate}`;
}

/** 同員工同日多列時（例：CSV 無打卡列 + 戰情合成未出勤），保留較可信之一列再寫入 */
function rankWarRowForPersistence(r: WarRoomRow): number {
  if (r.uid.startsWith("absent:")) return 0;
  const hasPunch = r.clockIn != null || r.clockOut != null;
  if (hasPunch) return 3;
  if (r.uid.startsWith("leave-only:")) return 2;
  return 1;
}

export function dedupeWarRowsForPersistence(rows: WarRoomRow[]): WarRoomRow[] {
  const byKey = new Map<string, WarRoomRow[]>();
  for (const r of rows) {
    if (!r.employeeId) continue;
    const k = rowKey(r.employeeId, r.dateIso.slice(0, 10));
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  const out: WarRoomRow[] = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    let best = list[0];
    let bestR = rankWarRowForPersistence(best);
    for (let i = 1; i < list.length; i++) {
      const r = list[i];
      const rr = rankWarRowForPersistence(r);
      if (rr > bestR) {
        best = r;
        bestR = rr;
      }
    }
    out.push(best);
  }
  return out;
}

function mergePreservedCompOffTag(computed: string[], existing: string[] | null | undefined): string[] {
  const out = [...computed];
  if (!existing?.length) return out;
  if (existing.includes(COMPOFF_DAILY_ATTENDANCE_TAG) && !out.includes(COMPOFF_DAILY_ATTENDANCE_TAG)) {
    out.push(COMPOFF_DAILY_ATTENDANCE_TAG);
  }
  return out;
}

export function warRoomRowToDailyAttendancePayload(
  r: WarRoomRow,
  existingTags?: string[] | null,
): {
  employee_id: string;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  is_abnormal: boolean;
  status_tags: string[];
  updated_at: string;
} | null {
  if (!r.employeeId) return null;
  const fromPreview = r.tags.map((t) => t.label);
  const status_tags = mergePreservedCompOffTag(fromPreview, existingTags);
  const is_abnormal = r.tags.some((t) => ABNORMAL_DAILY_ATTENDANCE_TAG_IDS.has(t.id));
  return {
    employee_id: r.employeeId,
    attendance_date: r.dateIso,
    clock_in: clockDisplayToDbTime(r.clockIn),
    clock_out: clockDisplayToDbTime(r.clockOut),
    total_hours: r.hoursDay,
    is_abnormal,
    status_tags,
    updated_at: new Date().toISOString(),
  };
}

/**
 * 批次 upsert 戰情室預覽列。會先讀取區間內既有列，保留已存在的「🔒 已轉補休」標籤以免 CSV 重匯覆蓋。
 */
export async function bulkUpsertDailyAttendanceFromWarRows(
  client: SupabaseClient,
  warRows: WarRoomRow[],
): Promise<{ written: number; skipped: number; error: string | null }> {
  let skipped = 0;
  for (const r of warRows) {
    if (!r.employeeId) skipped += 1;
  }
  const withEmp = dedupeWarRowsForPersistence(warRows.filter((r) => r.employeeId));

  if (withEmp.length === 0) {
    return { written: 0, skipped, error: null };
  }

  const empIds = [...new Set(withEmp.map((r) => r.employeeId!))];
  let minD = withEmp[0]!.dateIso;
  let maxD = withEmp[0]!.dateIso;
  for (const r of withEmp) {
    if (r.dateIso < minD) minD = r.dateIso;
    if (r.dateIso > maxD) maxD = r.dateIso;
  }

  const { data: existingRows, error: fetchErr } = await client
    .from("daily_attendance")
    .select("employee_id, attendance_date, status_tags")
    .in("employee_id", empIds)
    .gte("attendance_date", minD)
    .lte("attendance_date", maxD);

  if (fetchErr) {
    return { written: 0, skipped, error: fetchErr.message };
  }

  const existingMap = new Map<string, string[]>();
  for (const row of existingRows ?? []) {
    const rec = row as {
      employee_id: string;
      attendance_date: string;
      status_tags: string[] | null;
    };
    const d =
      typeof rec.attendance_date === "string"
        ? rec.attendance_date.slice(0, 10)
        : String(rec.attendance_date).slice(0, 10);
    existingMap.set(rowKey(String(rec.employee_id), d), rec.status_tags ?? []);
  }

  const merged: NonNullable<ReturnType<typeof warRoomRowToDailyAttendancePayload>>[] = [];
  for (const r of withEmp) {
    const prev = r.employeeId
      ? existingMap.get(rowKey(r.employeeId, r.dateIso))
      : undefined;
    const p = warRoomRowToDailyAttendancePayload(r, prev);
    if (p) merged.push(p);
  }

  let written = 0;
  for (let i = 0; i < merged.length; i += UPSERT_CHUNK) {
    const chunk = merged.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from("daily_attendance").upsert(chunk, {
      onConflict: "employee_id,attendance_date",
    });
    if (error) {
      return { written, skipped, error: error.message };
    }
    written += chunk.length;
  }

  return { written, skipped, error: null };
}

/**
 * 老闆手動核准加班（轉補休）等流程：在已存在的 daily_attendance 列上追加標籤。
 * 若該日尚無出勤列則靜默略過（可先由戰情室匯入建立列）。
 */
export async function appendDailyAttendanceStatusTag(
  client: SupabaseClient,
  params: { employeeId: string; attendanceDate: string; tag?: string },
): Promise<{ ok: boolean; error: string | null }> {
  const tag = params.tag ?? COMPOFF_DAILY_ATTENDANCE_TAG;
  const date = params.attendanceDate.slice(0, 10);

  const { data, error } = await client
    .from("daily_attendance")
    .select("id, status_tags")
    .eq("employee_id", params.employeeId)
    .eq("attendance_date", date)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, error: null };

  const rec = data as { id: string; status_tags: string[] | null };
  const tags = [...(rec.status_tags ?? [])];
  if (!tags.includes(tag)) tags.push(tag);

  const { error: uErr } = await client
    .from("daily_attendance")
    .update({
      status_tags: tags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rec.id);

  if (uErr) return { ok: false, error: uErr.message };
  return { ok: true, error: null };
}
