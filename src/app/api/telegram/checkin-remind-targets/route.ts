import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  TELEGRAM_CHECKIN_SCOPE_KEY,
  normalizeCheckinType,
  normalizePortalCheckinScope,
  taipeiDayRangeUtc,
} from "@/lib/attendance-checkin";
import { isApprovedLeaveStatus } from "@/lib/attendance-war-room";

export const runtime = "nodejs";

/**
 * Telegram 打卡提醒對象查詢（由 fore-telegram-bot 的提醒排程呼叫，pg_cron → bot → 這裡）。
 * 驗證同 /api/telegram/check-in（Vault 共用密鑰 leave_notify_secret）。
 *
 * GET ?kind=in|out
 * - in：今天還沒打上班卡的人（08:50 提醒與 09:10 檢查共用）
 * - out：今天有上班卡但還沒打下班卡的人（18:30 檢查）
 *
 * 名單條件：在職員工 × telegram_bot_users 綁定且啟用；telegram_checkin_scope=admin 時僅 bot 管理員。
 * 自動跳過：週六日（除非是補班日）與國定假日（非補班日）→ 回空名單；當天有已核准休假的員工。
 */

function getServiceSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function taipeiTodayYmd(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

async function verifySecret(supabase: SupabaseClient, request: NextRequest): Promise<boolean> {
  const secret = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const { data, error } = await supabase.rpc("verify_leave_notify_secret", {
    p_secret: secret,
  });
  if (error) {
    console.error("[telegram/checkin-remind-targets] verify secret:", error);
    return false;
  }
  return data === true;
}

export async function GET(request: NextRequest) {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 未設定" }, { status: 500 });
  }

  if (!(await verifySecret(supabase, request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const kind = (request.nextUrl.searchParams.get("kind") ?? "").trim().toLowerCase();
  if (kind !== "in" && kind !== "out") {
    return NextResponse.json({ ok: false, error: "kind 須為 in 或 out" }, { status: 400 });
  }

  const todayYmd = taipeiTodayYmd();
  const { startIso, endIso } = taipeiDayRangeUtc(todayYmd);

  const [{ data: scopeRaw }, { data: holidayRaw }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", TELEGRAM_CHECKIN_SCOPE_KEY)
      .maybeSingle(),
    supabase
      .from("public_holidays")
      .select("holiday_date, is_workday")
      .eq("holiday_date", todayYmd),
  ]);

  const scope = normalizePortalCheckinScope((scopeRaw as { value?: unknown } | null)?.value);
  if (scope === "off") {
    return NextResponse.json({ ok: true, kind, today: todayYmd, targets: [], skipped: "scope_off" });
  }

  const holidayRows = (holidayRaw ?? []) as { is_workday: boolean | null }[];
  const isHolidayOff = holidayRows.some((h) => h.is_workday !== true);
  if (isHolidayOff) {
    return NextResponse.json({ ok: true, kind, today: todayYmd, targets: [], skipped: "holiday" });
  }

  // 週六日不提醒，除非該日在 public_holidays 標為補班日
  const isMakeupWorkday = holidayRows.some((h) => h.is_workday === true);
  const weekday = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  });
  if ((weekday === "Sat" || weekday === "Sun") && !isMakeupWorkday) {
    return NextResponse.json({ ok: true, kind, today: todayYmd, targets: [], skipped: "weekend" });
  }

  const [tgUsersRes, logsRes, leavesRes] = await Promise.all([
    supabase
      .from("telegram_bot_users")
      .select("chat_id, name, role, employee_id, is_active")
      .eq("is_active", true),
    supabase
      .from("attendance_logs")
      .select("employee_id, check_type")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabase
      .from("leave_requests")
      .select("employee_id, status, start_date, end_date")
      .lte("start_date", todayYmd)
      .gte("end_date", todayYmd),
  ]);

  if (tgUsersRes.error || logsRes.error || leavesRes.error) {
    console.error(
      "[telegram/checkin-remind-targets] fetch:",
      tgUsersRes.error ?? logsRes.error ?? leavesRes.error,
    );
    return NextResponse.json({ ok: false, error: "查詢失敗" }, { status: 500 });
  }

  const punchedIn = new Set<string>();
  const punchedOut = new Set<string>();
  for (const log of (logsRes.data ?? []) as { employee_id: string; check_type: string }[]) {
    const t = normalizeCheckinType(log.check_type);
    if (t === "in") punchedIn.add(String(log.employee_id));
    if (t === "out") punchedOut.add(String(log.employee_id));
  }

  const onLeave = new Set<string>();
  for (const L of (leavesRes.data ?? []) as { employee_id: string; status: string | null }[]) {
    if (isApprovedLeaveStatus(L.status)) onLeave.add(String(L.employee_id));
  }

  type TgUserRow = {
    chat_id: string;
    name: string | null;
    role: string | null;
    employee_id: string | null;
    is_active: boolean | null;
  };
  const tgUsers = ((tgUsersRes.data ?? []) as TgUserRow[]).filter((u) => u.employee_id != null);

  // 在職過濾
  const employeeIds = tgUsers.map((u) => String(u.employee_id));
  const activeEmployees = new Set<string>();
  if (employeeIds.length > 0) {
    const { data: empRaw, error: empErr } = await supabase
      .from("employees")
      .select("id, employment_status")
      .in("id", employeeIds);
    if (empErr) {
      console.error("[telegram/checkin-remind-targets] employees:", empErr);
      return NextResponse.json({ ok: false, error: "查詢員工失敗" }, { status: 500 });
    }
    for (const e of (empRaw ?? []) as { id: string; employment_status: boolean | null }[]) {
      if (e.employment_status === true) activeEmployees.add(String(e.id));
    }
  }

  const targets = tgUsers
    .filter((u) => {
      const eid = String(u.employee_id);
      if (!activeEmployees.has(eid)) return false;
      if (scope === "admin" && String(u.role ?? "").trim().toLowerCase() !== "admin") {
        return false;
      }
      if (onLeave.has(eid)) return false;
      if (kind === "in") return !punchedIn.has(eid);
      // out：有上班卡但還沒打下班卡
      return punchedIn.has(eid) && !punchedOut.has(eid);
    })
    .map((u) => ({
      chat_id: u.chat_id,
      name: u.name ?? "",
      employee_id: String(u.employee_id),
    }));

  return NextResponse.json({ ok: true, kind, today: todayYmd, targets });
}
