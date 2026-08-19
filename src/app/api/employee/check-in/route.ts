import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { haversineDistanceMeters } from "@/lib/haversine-meters";
import {
  FACTORY_LAT,
  FACTORY_LNG,
  GEOFENCE_RADIUS_M,
  PORTAL_CHECKIN_SCOPE_KEY,
  normalizeCheckinType,
  normalizePortalCheckinScope,
  taipeiDayRangeUtc,
  type PortalCheckinScope,
} from "@/lib/attendance-checkin";

export const runtime = "nodejs";

/**
 * 員工儀表板線上打卡（attendance_logs, source='portal'）。
 * 測試期僅作為補卡審核佐證，不進月底出勤統計；開放範圍由 app_settings.portal_checkin_scope 控制。
 * 身分以 Supabase session（Authorization: Bearer <access_token>）驗證，employee_id 由 user_profiles 反查、不信任 client。
 */

function getServiceSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type CallerContext = {
  employeeId: string | null;
  isAdmin: boolean;
  scope: PortalCheckinScope;
  allowed: boolean;
};

async function resolveCaller(
  supabase: SupabaseClient,
  request: NextRequest,
): Promise<{ ok: true; ctx: CallerContext } | { ok: false; status: number; error: string }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, error: "未登入" };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return { ok: false, status: 401, error: "登入已失效，請重新登入" };
  }

  const [{ data: profileRaw, error: profileErr }, { data: scopeRaw }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("employee_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", PORTAL_CHECKIN_SCOPE_KEY)
      .maybeSingle(),
  ]);

  if (profileErr) {
    console.error("[employee/check-in] user_profiles lookup:", profileErr);
    return { ok: false, status: 500, error: "查詢使用者資料失敗" };
  }

  const profile = profileRaw as { employee_id: string | null; role: unknown } | null;
  const employeeId = profile?.employee_id != null ? String(profile.employee_id) : null;
  const isAdmin =
    String(profile?.role ?? "")
      .trim()
      .toLowerCase() === "admin";
  const scope = normalizePortalCheckinScope(
    (scopeRaw as { value?: unknown } | null)?.value,
  );

  const allowed =
    employeeId != null && (scope === "all" || (scope === "admin" && isAdmin));

  return { ok: true, ctx: { employeeId, isAdmin, scope, allowed } };
}

function taipeiTodayYmd(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

async function fetchTodayLogs(supabase: SupabaseClient, employeeId: string) {
  const { startIso, endIso } = taipeiDayRangeUtc(taipeiTodayYmd());
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("check_type, distance_meters, source, created_at")
    .eq("employee_id", employeeId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[employee/check-in] attendance_logs fetch:", error);
    return [];
  }
  return data ?? [];
}

/** 目前開放狀態＋自己今日的線上打卡紀錄 */
export async function GET(request: NextRequest) {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const caller = await resolveCaller(supabase, request);
  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  const { ctx } = caller;
  const logs =
    ctx.allowed && ctx.employeeId ? await fetchTodayLogs(supabase, ctx.employeeId) : [];

  return NextResponse.json({
    ok: true,
    scope: ctx.scope,
    allowed: ctx.allowed,
    geofence_radius_m: GEOFENCE_RADIUS_M,
    logs,
  });
}

export async function POST(request: NextRequest) {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const caller = await resolveCaller(supabase, request);
  if (!caller.ok) {
    return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });
  }

  const { ctx } = caller;
  if (!ctx.allowed || !ctx.employeeId) {
    return NextResponse.json(
      { ok: false, error: "儀表板打卡尚未對你開放" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const checkType = normalizeCheckinType(body.check_type);
  const lat = parseNumber(body.latitude);
  const lng = parseNumber(body.longitude);

  if (!checkType) {
    return NextResponse.json({ ok: false, error: "check_type 須為 in 或 out" }, { status: 400 });
  }
  if (lat === null || lng === null) {
    return NextResponse.json(
      { ok: false, error: "無法取得定位（latitude / longitude 無效）" },
      { status: 400 },
    );
  }

  const distanceM = haversineDistanceMeters(lat, lng, FACTORY_LAT, FACTORY_LNG);
  const distanceRounded = Math.round(distanceM * 100) / 100;

  if (distanceM > GEOFENCE_RADIUS_M) {
    return NextResponse.json({
      ok: false,
      warning: `目前位置距離工廠約 ${distanceRounded} 公尺，超過允許範圍 ${GEOFENCE_RADIUS_M} 公尺，無法完成打卡。`,
      distance_meters: distanceRounded,
    });
  }

  const { error: insErr } = await supabase.from("attendance_logs").insert({
    employee_id: ctx.employeeId,
    check_type: checkType,
    latitude: lat,
    longitude: lng,
    distance_meters: distanceRounded,
    source: "portal",
  });

  if (insErr) {
    console.error("[employee/check-in] attendance_logs insert:", insErr);
    return NextResponse.json({ ok: false, error: "寫入打卡紀錄失敗" }, { status: 500 });
  }

  const logs = await fetchTodayLogs(supabase, ctx.employeeId);

  return NextResponse.json({
    ok: true,
    message: "打卡成功",
    check_type: checkType,
    distance_meters: distanceRounded,
    logs,
  });
}
