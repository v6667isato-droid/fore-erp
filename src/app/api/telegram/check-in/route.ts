import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  TELEGRAM_CHECKIN_SCOPE_KEY,
  normalizePortalCheckinScope,
} from "@/lib/attendance-checkin";
import { performCheckin } from "@/lib/attendance-checkin-server";

export const runtime = "nodejs";

/**
 * Telegram bot 線上打卡（attendance_logs, source='telegram'）。
 * 由 fore-telegram-bot 在收到員工分享位置後呼叫；以 Vault 共用密鑰 leave_notify_secret 驗證
 * （public.verify_leave_notify_secret RPC，僅 service_role 可執行）。
 * 員工身分由 telegram_bot_users.chat_id 對應 employee_id；開放範圍由
 * app_settings.telegram_checkin_scope 控制（off／admin 測試／all）。
 * 回應的 message 為可直接回覆給員工的文字。
 */

function getServiceSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
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

export async function POST(request: NextRequest) {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const secret = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const { data: secretOk, error: secretErr } = await supabase.rpc(
    "verify_leave_notify_secret",
    { p_secret: secret },
  );
  if (secretErr || secretOk !== true) {
    if (secretErr) console.error("[telegram/check-in] verify secret:", secretErr);
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = String(body.chat_id ?? "").trim();
  const lat = parseNumber(body.latitude);
  const lng = parseNumber(body.longitude);
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "chat_id 必填" }, { status: 400 });
  }
  if (lat === null || lng === null) {
    return NextResponse.json(
      { ok: false, message: "沒有收到定位資訊，請重新分享位置後再打卡。" },
      { status: 400 },
    );
  }

  const [{ data: tgUserRaw, error: tgErr }, { data: scopeRaw }] = await Promise.all([
    supabase
      .from("telegram_bot_users")
      .select("chat_id, name, role, employee_id, is_active")
      .eq("chat_id", chatId)
      .maybeSingle(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", TELEGRAM_CHECKIN_SCOPE_KEY)
      .maybeSingle(),
  ]);

  if (tgErr) {
    console.error("[telegram/check-in] telegram_bot_users lookup:", tgErr);
    return NextResponse.json({ ok: false, error: "查詢使用者失敗" }, { status: 500 });
  }

  const tgUser = tgUserRaw as {
    chat_id: string;
    name: string | null;
    role: string | null;
    employee_id: string | null;
    is_active: boolean | null;
  } | null;

  if (!tgUser || tgUser.is_active !== true || !tgUser.employee_id) {
    return NextResponse.json({
      ok: false,
      message: "你的 Telegram 尚未綁定員工帳號，請聯絡管理員設定。",
    });
  }

  const scope = normalizePortalCheckinScope((scopeRaw as { value?: unknown } | null)?.value);
  const isAdmin = String(tgUser.role ?? "").trim().toLowerCase() === "admin";
  if (!(scope === "all" || (scope === "admin" && isAdmin))) {
    return NextResponse.json({ ok: false, message: "Telegram 打卡尚未對你開放。" });
  }

  const result = await performCheckin(supabase, tgUser.employee_id, lat, lng, "telegram");

  if (!result.ok) {
    if (result.reason === "insert_failed") {
      return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
    }
    return NextResponse.json({ ok: false, message: result.message });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    check_type: result.checkType,
    distance_meters: result.distanceMeters,
  });
}
