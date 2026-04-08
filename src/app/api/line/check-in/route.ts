import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { OAuth } from "@line/bot-sdk";
import { haversineDistanceMeters } from "@/lib/haversine-meters";

export const runtime = "nodejs";

/** 工廠中心點（WGS84） */
const FACTORY_LAT = 22.97719574793936;
const FACTORY_LNG = 120.27564517465072;
/** 允許打卡半徑（公尺） */
const GEOFENCE_RADIUS_M = 100;

function getServiceSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
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

/**
 * LIFF `getIDToken()` 取得之 ID Token；client_id 為 LINE Developers 上該 LINE Login / Messaging 通道的 Channel ID。
 */
export async function POST(request: NextRequest) {
  const channelId = (
    process.env.LINE_LOGIN_CHANNEL_ID ??
    process.env.LINE_CHANNEL_ID ??
    ""
  ).trim();
  if (!channelId) {
    console.error("[line/check-in] LINE_LOGIN_CHANNEL_ID or LINE_CHANNEL_ID is required");
    return NextResponse.json(
      { ok: false, error: "伺服器未設定 LINE Channel ID，無法驗證身份" },
      { status: 500 }
    );
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase 未設定" },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = typeof body.id_token === "string" ? body.id_token.trim() : "";
  const checkType = typeof body.check_type === "string" ? body.check_type.trim() : "";
  const lat = parseNumber(body.latitude);
  const lng = parseNumber(body.longitude);

  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "缺少 id_token（請由 LIFF 傳入 liff.getIDToken()）" },
      { status: 400 }
    );
  }
  if (!checkType) {
    return NextResponse.json({ ok: false, error: "缺少 check_type" }, { status: 400 });
  }
  if (lat === null || lng === null) {
    return NextResponse.json({ ok: false, error: "latitude / longitude 無效" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    const oauth = new OAuth();
    const verified = (await oauth.verifyIdToken(idToken, channelId)) as { sub?: string };
    lineUserId = typeof verified.sub === "string" ? verified.sub : "";
    if (!lineUserId) {
      return NextResponse.json({ ok: false, error: "無法從 ID Token 取得使用者識別" }, { status: 401 });
    }
  } catch (e) {
    console.error("[line/check-in] verifyIdToken:", e);
    return NextResponse.json({ ok: false, error: "LINE 身份驗證失敗" }, { status: 401 });
  }

  const { data: empRaw, error: empErr } = await supabase
    .from("employees")
    .select("id")
    .eq("line_user_id", lineUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (empErr) {
    console.error("[line/check-in] employee lookup:", empErr);
    return NextResponse.json({ ok: false, error: "查詢員工失敗" }, { status: 500 });
  }

  const employee = empRaw as { id: string } | null;
  if (!employee?.id) {
    return NextResponse.json(
      {
        ok: false,
        error: "此 LINE 尚未與員工資料綁定，請先於官方帳號傳送驗證碼完成綁定。",
      },
      { status: 403 }
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
    employee_id: employee.id,
    check_type: checkType,
    latitude: lat,
    longitude: lng,
    distance_meters: distanceRounded,
    source: "line",
  });

  if (insErr) {
    console.error("[line/check-in] attendance_logs insert:", insErr);
    const msg = String(insErr.message ?? "");
    if (/relation|does not exist|column/i.test(msg)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "資料表 attendance_logs 或欄位尚未建立。請於 Supabase 執行 migration：20260408130000_employees_line_bind_attendance_logs.sql",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: false, error: "寫入打卡紀錄失敗" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "打卡成功",
    distance_meters: distanceRounded,
    check_type: checkType,
  });
}
