import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineDistanceMeters } from "@/lib/haversine-meters";
import {
  CHECKIN_WINDOW_HINT,
  FACTORY_LAT,
  FACTORY_LNG,
  GEOFENCE_RADIUS_M,
  normalizeCheckinType,
  resolveCheckinTypeByTime,
  taipeiDayRangeUtc,
  type CheckinType,
} from "@/lib/attendance-checkin";

/**
 * 線上打卡伺服器端共用邏輯（員工儀表板 /api/employee/check-in 與 Telegram /api/telegram/check-in 共用）：
 * 時段判定（上班卡／下班卡）→ 同類型一天限一次 → 廠區 100 公尺圍欄 → 寫入 attendance_logs。
 */

export type CheckinLogRow = {
  check_type: string;
  distance_meters: number;
  source: string;
  created_at: string;
};

function taipeiTodayYmd(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

export async function fetchTodayCheckinLogs(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<CheckinLogRow[]> {
  const { startIso, endIso } = taipeiDayRangeUtc(taipeiTodayYmd());
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("check_type, distance_meters, source, created_at")
    .eq("employee_id", employeeId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[attendance-checkin-server] attendance_logs fetch:", error);
    return [];
  }
  return (data ?? []) as CheckinLogRow[];
}

export type PerformCheckinResult =
  | {
      ok: true;
      checkType: CheckinType;
      distanceMeters: number;
      logs: CheckinLogRow[];
      message: string;
    }
  | {
      ok: false;
      reason: "outside_window" | "duplicate" | "too_far" | "insert_failed";
      message: string;
      distanceMeters?: number;
      logs?: CheckinLogRow[];
    };

export async function performCheckin(
  supabase: SupabaseClient,
  employeeId: string,
  latitude: number,
  longitude: number,
  source: string,
): Promise<PerformCheckinResult> {
  const checkType = resolveCheckinTypeByTime();
  if (!checkType) {
    return {
      ok: false,
      reason: "outside_window",
      message: `目前非打卡時段（${CHECKIN_WINDOW_HINT}）。`,
    };
  }

  const todayLogs = await fetchTodayCheckinLogs(supabase, employeeId);
  if (todayLogs.some((l) => normalizeCheckinType(l.check_type) === checkType)) {
    return {
      ok: false,
      reason: "duplicate",
      message: `今日${checkType === "in" ? "上班" : "下班"}已打過卡。`,
      logs: todayLogs,
    };
  }

  const distanceM = haversineDistanceMeters(latitude, longitude, FACTORY_LAT, FACTORY_LNG);
  const distanceRounded = Math.round(distanceM * 100) / 100;

  if (distanceM > GEOFENCE_RADIUS_M) {
    return {
      ok: false,
      reason: "too_far",
      message: `目前位置距離工廠約 ${distanceRounded} 公尺，超過允許範圍 ${GEOFENCE_RADIUS_M} 公尺，無法完成打卡。`,
      distanceMeters: distanceRounded,
    };
  }

  const { error: insErr } = await supabase.from("attendance_logs").insert({
    employee_id: employeeId,
    check_type: checkType,
    latitude,
    longitude,
    distance_meters: distanceRounded,
    source,
  });

  if (insErr) {
    console.error("[attendance-checkin-server] attendance_logs insert:", insErr);
    return { ok: false, reason: "insert_failed", message: "寫入打卡紀錄失敗" };
  }

  const logs = await fetchTodayCheckinLogs(supabase, employeeId);
  return {
    ok: true,
    checkType,
    distanceMeters: distanceRounded,
    logs,
    message: `${checkType === "in" ? "上班" : "下班"}打卡成功（距廠區 ${distanceRounded} 公尺）`,
  };
}
