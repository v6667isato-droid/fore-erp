import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LOTTERY_FEED_URL, parseLotteryFeed } from "@/lib/invoice-lottery";

export const maxDuration = 30;

/**
 * 同步統一發票中獎號碼：抓財政部 RSS（最近 6 期）→ upsert invoice_lottery_draws。
 * 前端在發現「已開獎但本機沒號碼」時自動呼叫，也可由清單上的按鈕手動觸發。
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ success: false, error: "未登入" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ success: false, error: "Supabase 尚未設定" }, { status: 501 });
  }

  const auth = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData?.user) {
    return NextResponse.json({ success: false, error: "登入已失效，請重新登入" }, { status: 401 });
  }

  let draws;
  try {
    const res = await fetch(LOTTERY_FEED_URL, {
      cache: "no-store",
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `財政部中獎號碼服務回應 ${res.status}，請稍後再試` },
        { status: 502 },
      );
    }
    draws = parseLotteryFeed(await res.text());
  } catch (err) {
    console.error("中獎號碼抓取失敗:", err);
    return NextResponse.json({ success: false, error: "中獎號碼抓取失敗，請稍後再試" }, { status: 502 });
  }

  if (draws.length === 0) {
    return NextResponse.json({ success: false, error: "中獎號碼格式無法解析（財政部網頁可能改版）" }, { status: 502 });
  }

  // 寫入優先用 service role；沒設定時改用呼叫者的 token（RLS 為 authenticated 可寫）
  const db = serviceKey
    ? createClient(supabaseUrl, serviceKey)
    : createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
  const { error } = await db.from("invoice_lottery_draws").upsert(
    draws.map((d) => ({
      period: d.period,
      label: d.label,
      special_prize: d.special_prize,
      grand_prize: d.grand_prize,
      first_prizes: d.first_prizes,
      sixth_extra_prizes: d.sixth_extra_prizes,
      source_url: d.source_url ?? null,
      synced_at: new Date().toISOString(),
    })),
    { onConflict: "period" },
  );
  if (error) {
    console.error("中獎號碼寫入失敗:", error.message);
    return NextResponse.json({ success: false, error: error.message || "中獎號碼寫入失敗" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    periods: draws.map((d) => d.period),
    latest: draws[0]?.label ?? null,
  });
}
