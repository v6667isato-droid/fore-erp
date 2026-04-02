import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 發放薪資後通知員工（Resend）。
 * 需登入且 user_profiles.role 為 admin 或 manager。
 * 環境變數：RESEND_API_KEY、RESEND_FROM_EMAIL（同每週訂單信）
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase 未設定" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }

  const supabaseAnon = createClient(url, anonKey);
  const {
    data: { user },
    error: userErr,
  } = await supabaseAnon.auth.getUser(token);
  if (userErr || !user) {
    return NextResponse.json({ error: "登入已失效" }, { status: 401 });
  }

  const admin = createClient(url, serviceKey ?? anonKey);
  let roleRow: { role?: string } | null = null;
  const byUid = await admin
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!byUid.error && byUid.data) roleRow = byUid.data as { role?: string };
  if (!roleRow) {
    const byId = await admin
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!byId.error && byId.data) roleRow = byId.data as { role?: string };
  }
  const raw = String(roleRow?.role ?? "")
    .trim()
    .toLowerCase();
  if (raw !== "admin" && raw !== "manager") {
    return NextResponse.json({ error: "僅管理員可寄發薪資通知" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "收件信箱無效" }, { status: 400 });
  }

  const employeeName =
    typeof body.employeeName === "string" ? body.employeeName.trim() : "同仁";
  const monthLabel =
    typeof body.monthLabel === "string" ? body.monthLabel.trim() : "—";
  const netPay =
    typeof body.netPay === "number" && Number.isFinite(body.netPay)
      ? Math.round(body.netPay)
      : null;
  const remittanceBank =
    typeof body.remittanceBank === "string" ? body.remittanceBank.trim() : "";
  const remittanceAccount =
    typeof body.remittanceAccount === "string"
      ? body.remittanceAccount.trim()
      : "";

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey?.trim()) {
    return NextResponse.json(
      { error: "RESEND_API_KEY 未設定，無法寄信" },
      { status: 500 },
    );
  }

  const netStr =
    netPay != null
      ? `NT$ ${netPay.toLocaleString("zh-TW")}`
      : "—（請至員工端薪資單確認）";
  const bankLine =
    remittanceBank || remittanceAccount
      ? `<p style="margin:12px 0 0 0;"><strong>匯款資訊</strong><br/>銀行：${escapeHtml(remittanceBank || "—")}<br/>帳號：${escapeHtml(remittanceAccount || "—")}</p>`
      : `<p style="margin:12px 0 0 0;color:#6b7280;font-size:13px;">若需匯款資料，請洽人資於員工資料中維護。</p>`;

  const subject = `【Fore ERP】${monthLabel} 薪資已發放`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="font-family: system-ui, sans-serif; padding: 16px; line-height: 1.5;">
  <p>${escapeHtml(employeeName)} 您好，</p>
  <p>您 <strong>${escapeHtml(monthLabel)}</strong> 的薪資已發放，實發金額：<strong>${escapeHtml(netStr)}</strong>。</p>
  ${bankLine}
  <p style="margin-top:20px;color:#9ca3af;font-size:12px;">此信由 Fore ERP 自動寄出，請勿直接回覆。</p>
</body></html>`;

  const resend = new Resend(resendApiKey);
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || "Fore ERP <onboarding@resend.dev>";

  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
    });
    if (sendError) {
      console.error("[payroll-notify] Resend:", sendError);
      return NextResponse.json(
        { error: sendError.message || "寄信失敗" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[payroll-notify]", e);
    return NextResponse.json({ error: "寄信失敗" }, { status: 500 });
  }
}
