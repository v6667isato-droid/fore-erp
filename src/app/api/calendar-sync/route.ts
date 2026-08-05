import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeCompanyEventCategory,
  companyEventCategoryLabel,
  type CompanyEventCategory,
} from "@/lib/company-events";

export const maxDuration = 60;

/**
 * 公司行事曆（company_event）→ Google 行事曆單向同步。訂單交期（orders）不同步。
 * POST：需登入（Authorization: Bearer <supabase access token>）。
 *   action=upsert/delete：前端 CRUD 後即時推送單筆；
 *   action=reconcile：全量對帳（行事曆頁開啟時節流觸發）——補建漏同步的（含 Telegram bot
 *   建立的）、修正內容不一致的、刪除 ERP 已刪但 Google 還在的。
 * GET：同 reconcile，驗 CRON_SECRET。目前 Vercel Hobby cron 已滿額（2 個）故未掛排程，
 *      保留給日後 Cloudflare cron 或方案升級使用。
 * 環境變數：GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET（沿用 Gmail 那組 OAuth client）、
 * GOOGLE_CALENDAR_REFRESH_TOKEN（calendar.events scope）、GOOGLE_CALENDAR_ID（建議專用日曆）。
 */

/** 對帳範圍：台北今天往前推此天數起的所有事件（更早的視為封存，不再動） */
const SYNC_WINDOW_DAYS = 60;

/** Google Calendar colorId，對齊行事曆頁 EVENT_STYLES 配色（黃/藍/玫紅/綠/灰） */
const CATEGORY_COLOR_IDS: Record<CompanyEventCategory, string> = {
  delivery: "5", // Banana 黃
  visit: "7", // Peacock 藍
  task: "4", // Flamingo 玫紅
  company: "10", // Basil 綠
  other: "8", // Graphite 灰
};

/** 標記在 Google 事件上的私有屬性，對帳時用來過濾「本系統建立」的事件與反查 ERP id */
const PRIVATE_PROP_MANAGED = "fore_erp";
const PRIVATE_PROP_EVENT_ID = "fore_erp_event_id";

interface EventRow {
  id: string;
  title: string;
  event_date: string;
  category: string;
  description: string | null;
  google_event_id: string | null;
}

interface GoogleEventBody {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
  colorId: string;
  extendedProperties: { private: Record<string, string> };
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function taipeiTodayIso(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
}

function nextDayIso(dateIso: string): string {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
}

function buildGoogleEvent(row: EventRow, assigneeNames: string[]): GoogleEventBody {
  const cat = normalizeCompanyEventCategory(row.category) ?? "other";
  const parts: string[] = [];
  if (row.description?.trim()) parts.push(row.description.trim());
  if (assigneeNames.length > 0) parts.push(`負責人：${assigneeNames.join("、")}`);
  return {
    summary: `[${companyEventCategoryLabel[cat]}] ${row.title}`,
    description: parts.join("\n\n"),
    start: { date: row.event_date },
    end: { date: nextDayIso(row.event_date) },
    colorId: CATEGORY_COLOR_IDS[cat],
    extendedProperties: {
      private: { [PRIVATE_PROP_MANAGED]: "1", [PRIVATE_PROP_EVENT_ID]: row.id },
    },
  };
}

/** 內容是否已一致（對帳時避免無謂 PATCH） */
function googleEventMatches(g: GoogleEvent, want: GoogleEventBody): boolean {
  return (
    (g.summary ?? "") === want.summary &&
    (g.description ?? "") === want.description &&
    g.start?.date === want.start.date &&
    (g.colorId ?? "") === want.colorId
  );
}

// ─── Google API ───

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Google 授權更新失敗（${detail}）。refresh token 可能已失效，請重新取得。`);
  }
  return json.access_token as string;
}

async function gcalFetch(
  accessToken: string,
  calendarId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (res.status === 204) return { ok: true, status: 204, json: null };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, json };
}

function gcalErrorMessage(r: { status: number; json: Record<string, unknown> | null }): string {
  const detail =
    (r.json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`;
  return `Google Calendar API 失敗（${detail}）`;
}

/** 刪除 Google 事件；已不存在（404/410）視為成功 */
async function gcalDelete(accessToken: string, calendarId: string, googleEventId: string): Promise<void> {
  const r = await gcalFetch(accessToken, calendarId, "DELETE", `/${encodeURIComponent(googleEventId)}`);
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(gcalErrorMessage(r));
}

// ─── 同步核心 ───

interface SyncContext {
  admin: SupabaseClient;
  accessToken: string;
  calendarId: string;
}

async function fetchAssigneeNames(admin: SupabaseClient, eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (eventIds.length === 0) return map;
  const { data, error } = await admin
    .from("company_event_assignees")
    .select("company_event_id, employees(name)")
    .in("company_event_id", eventIds);
  if (error) throw new Error(`負責人查詢失敗：${error.message}`);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const evId = String(r.company_event_id ?? "");
    const emp = (r.employees ?? null) as { name?: unknown } | null;
    const name = emp && typeof emp.name === "string" ? emp.name : "";
    if (!evId || !name) continue;
    map.set(evId, [...(map.get(evId) ?? []), name]);
  }
  return map;
}

/**
 * 建立 Google 事件並把 id 寫回 company_event。
 * 併發防重：寫回時以「google_event_id 仍為原值」為條件；被別的請求搶先（或事件已刪）就
 * 刪掉剛建立的這顆，避免 Google 上出現重複事件。
 */
async function createGoogleEvent(ctx: SyncContext, row: EventRow, names: string[]): Promise<"created" | "raced"> {
  const r = await gcalFetch(ctx.accessToken, ctx.calendarId, "POST", "", buildGoogleEvent(row, names));
  if (!r.ok || typeof r.json?.id !== "string") throw new Error(gcalErrorMessage(r));
  const gid = r.json.id;

  let claim = ctx.admin
    .from("company_event")
    .update({ google_event_id: gid }, { count: "exact" })
    .eq("id", row.id);
  claim =
    row.google_event_id === null
      ? claim.is("google_event_id", null)
      : claim.eq("google_event_id", row.google_event_id);
  const { error, count } = await claim;
  if (error) throw new Error(`google_event_id 寫回失敗：${error.message}`);
  if (count === 0) {
    await gcalDelete(ctx.accessToken, ctx.calendarId, gid).catch(() => {});
    return "raced";
  }
  return "created";
}

/** 單筆 upsert：有 google_event_id 就 PATCH（Google 端已被刪則重建），沒有就建立 */
async function upsertEvent(ctx: SyncContext, row: EventRow, names: string[]): Promise<string> {
  if (row.google_event_id) {
    const r = await gcalFetch(
      ctx.accessToken,
      ctx.calendarId,
      "PATCH",
      `/${encodeURIComponent(row.google_event_id)}`,
      buildGoogleEvent(row, names),
    );
    if (r.ok) return "updated";
    if (r.status !== 404 && r.status !== 410) throw new Error(gcalErrorMessage(r));
    // Google 端已不存在（例如使用者在 Google 上手動刪除）→ 重建
  }
  return createGoogleEvent(ctx, row, names);
}

function buildContextOrNull(): { clientId: string; clientSecret: string; refreshToken: string; calendarId: string } | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, calendarId: process.env.GOOGLE_CALENDAR_ID || "primary" };
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 全量對帳（GET cron 與 POST action=reconcile 共用） */
async function runReconcile(ctx: SyncContext): Promise<Record<string, unknown>> {
  const sinceIso = taipeiTodayIso(-SYNC_WINDOW_DAYS);

  // ERP 端：對帳範圍內全部事件
  const { data: rowsData, error: rowsErr } = await ctx.admin
    .from("company_event")
    .select("id,title,event_date,category,description,google_event_id")
    .gte("event_date", sinceIso);
  if (rowsErr) throw new Error(`事件查詢失敗：${rowsErr.message}`);
  const rows = (rowsData ?? []) as EventRow[];
  const namesByEvent = await fetchAssigneeNames(ctx.admin, rows.map((r) => r.id));

  // Google 端：只列本系統建立的事件（以私有屬性過濾）
  const googleEvents: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({
      privateExtendedProperty: `${PRIVATE_PROP_MANAGED}=1`,
      timeMin: `${sinceIso}T00:00:00Z`,
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await gcalFetch(ctx.accessToken, ctx.calendarId, "GET", `?${qs.toString()}`);
    if (!r.ok) throw new Error(gcalErrorMessage(r));
    googleEvents.push(...(((r.json?.items as GoogleEvent[] | undefined) ?? [])));
    pageToken = r.json?.nextPageToken as string | undefined;
  } while (pageToken);

  const googleByErpId = new Map<string, GoogleEvent>();
  for (const g of googleEvents) {
    if (g.status === "cancelled") continue;
    const erpId = g.extendedProperties?.private?.[PRIVATE_PROP_EVENT_ID];
    if (erpId) googleByErpId.set(erpId, g);
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let relinked = 0;

  // ERP → Google：補建與補改
  for (const row of rows) {
    const names = namesByEvent.get(row.id) ?? [];
    const g = googleByErpId.get(row.id);
    if (!g) {
      // Google 端沒有（從未同步、或在 Google 上被手動刪除）→ 建立
      if ((await createGoogleEvent(ctx, row, names)) === "created") created += 1;
      continue;
    }
    if (row.google_event_id !== g.id) {
      // DB 記的 id 與實際不符（例如寫回失敗）→ 以 Google 端實際 id 修正
      await ctx.admin.from("company_event").update({ google_event_id: g.id }).eq("id", row.id);
      relinked += 1;
    }
    const want = buildGoogleEvent(row, names);
    if (!googleEventMatches(g, want)) {
      const r = await gcalFetch(ctx.accessToken, ctx.calendarId, "PATCH", `/${encodeURIComponent(g.id)}`, want);
      if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(gcalErrorMessage(r));
      updated += 1;
    }
  }

  // Google → 清孤兒：ERP 已刪（整筆不存在）才刪 Google 端
  const rowIds = new Set(rows.map((r) => r.id));
  const orphanCandidates = [...googleByErpId.entries()].filter(([erpId]) => !rowIds.has(erpId));
  if (orphanCandidates.length > 0) {
    const { data: stillExist, error: existErr } = await ctx.admin
      .from("company_event")
      .select("id")
      .in("id", orphanCandidates.map(([erpId]) => erpId));
    if (existErr) throw new Error(`事件查詢失敗：${existErr.message}`);
    const existing = new Set((stillExist ?? []).map((r) => String((r as { id: string }).id)));
    for (const [erpId, g] of orphanCandidates) {
      if (existing.has(erpId)) continue; // 事件還在（日期被改到範圍外）→ 不動
      await gcalDelete(ctx.accessToken, ctx.calendarId, g.id);
      deleted += 1;
    }
  }

  return {
    window_since: sinceIso,
    erp_events: rows.length,
    google_events: googleByErpId.size,
    created,
    updated,
    deleted,
    relinked,
  };
}

// ─── POST：前端即時推送（需登入） ───

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ success: false, error: "未授權" }, { status: 401 });
  const {
    data: { user },
    error: userErr,
  } = await createClient(url, anonKey).auth.getUser(token);
  if (userErr || !user) {
    return NextResponse.json({ success: false, error: "登入已失效" }, { status: 401 });
  }

  const config = buildContextOrNull();
  // 未設定 Google 連線時安靜略過（前端為 fire-and-forget，不需要報錯）
  if (!config) return NextResponse.json({ success: true, not_configured: true });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ success: false, error: "Supabase 未設定" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as
    | { action?: string; event_id?: string; google_event_id?: string }
    | null;
  const action = body?.action;

  try {
    const accessToken = await refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
    const ctx: SyncContext = { admin, accessToken, calendarId: config.calendarId };

    if (action === "delete") {
      const gid = body?.google_event_id?.trim();
      if (!gid) return NextResponse.json({ success: false, error: "缺少 google_event_id" }, { status: 400 });
      await gcalDelete(accessToken, config.calendarId, gid);
      return NextResponse.json({ success: true, result: "deleted" });
    }

    if (action === "upsert") {
      const eventId = body?.event_id?.trim();
      if (!eventId) return NextResponse.json({ success: false, error: "缺少 event_id" }, { status: 400 });
      const { data, error } = await admin
        .from("company_event")
        .select("id,title,event_date,category,description,google_event_id")
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw new Error(`事件查詢失敗：${error.message}`);
      if (!data) return NextResponse.json({ success: true, result: "not_found" });
      const row = data as EventRow;
      const names = (await fetchAssigneeNames(admin, [row.id])).get(row.id) ?? [];
      const result = await upsertEvent(ctx, row, names);
      return NextResponse.json({ success: true, result });
    }

    if (action === "reconcile") {
      const stats = await runReconcile(ctx);
      return NextResponse.json({ success: true, ...stats });
    }

    return NextResponse.json({ success: false, error: "未知 action" }, { status: 400 });
  } catch (err) {
    console.error("calendar-sync POST error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "同步失敗" },
      { status: 502 },
    );
  }
}

// ─── GET：排程對帳（Vercel Cron） ───

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = buildContextOrNull();
  if (!config) return NextResponse.json({ success: true, not_configured: true });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ success: false, error: "Supabase 未設定" }, { status: 500 });

  try {
    const accessToken = await refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
    const stats = await runReconcile({ admin, accessToken, calendarId: config.calendarId });
    return NextResponse.json({ success: true, ...stats });
  } catch (err) {
    console.error("calendar-sync GET error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "對帳失敗" },
      { status: 502 },
    );
  }
}
