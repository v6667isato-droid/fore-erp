import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

/**
 * 每週訂單統整：由 Vercel Cron 或外部排程呼叫，將過去一週的訂單彙整寄到管理者 email。
 * 環境變數：RESEND_API_KEY, MANAGER_EMAIL, CRON_SECRET（與 Vercel Cron 或排程設定一致）
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const managerEmail = process.env.MANAGER_EMAIL;
  if (!managerEmail?.trim()) {
    return NextResponse.json(
      { error: "MANAGER_EMAIL not set" },
      { status: 500 }
    );
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey?.trim()) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not set" },
      { status: 500 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_number, order_date, expected_delivery_date, status, total_amount, source, customers(name)")
    .gte("order_date", startStr)
    .lte("order_date", endStr)
    .order("order_date", { ascending: false });

  if (error) {
    console.error("weekly-order-summary query error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }

  const rows = (orders ?? []) as Array<{
    order_number: string;
    order_date: string | null;
    expected_delivery_date: string | null;
    status: string;
    total_amount: number;
    source?: string | null;
    customers: { name?: string } | { name?: string }[] | null;
  }>;

  const customerName = (c: { name?: string } | { name?: string }[] | null) => {
    if (!c) return "—";
    return Array.isArray(c) ? c[0]?.name ?? "—" : c.name ?? "—";
  };

  const subject = `【Fore ERP】每週訂單統整 ${startStr} ~ ${endStr}`;
  const tableRows = rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(r.order_number ?? "—")}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(customerName(r.customers))}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.order_date ? r.order_date.slice(0, 10) : "—"}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.expected_delivery_date ? r.expected_delivery_date.slice(0, 10) : "—"}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(r.status ?? "—")}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.source === "portal" ? "通路" : "內部"}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">$${Number(r.total_amount ?? 0).toLocaleString()}</td>
        </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; padding: 16px;">
  <h2 style="margin-bottom: 8px;">每週訂單統整</h2>
  <p style="color:#6b7280; margin-bottom: 16px;">${startStr} ~ ${endStr}，共 ${rows.length} 筆訂單</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 800px;">
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">訂單編號</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">客戶</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">下單日</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">預計交貨</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">狀態</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">來源</th>
        <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;">金額</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || "<tr><td colspan=\"7\" style=\"padding:12px;border:1px solid #e5e7eb;\">此週無訂單</td></tr>"}
    </tbody>
  </table>
  <p style="margin-top: 16px; color: #9ca3af; font-size: 12px;">此信由 Fore ERP 每週排程自動寄出</p>
</body>
</html>`;

  const resend = new Resend(resendApiKey);
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Fore ERP <onboarding@resend.dev>";

  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: [managerEmail.trim()],
      subject,
      html,
    });
    if (sendError) {
      console.error("Resend send error:", sendError);
      return NextResponse.json(
        { error: "Failed to send email", detail: sendError.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, messageId: data?.id });
  } catch (e) {
    console.error("weekly-order-summary send exception:", e);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
