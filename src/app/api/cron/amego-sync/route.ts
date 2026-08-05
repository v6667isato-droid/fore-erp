import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAmegoSync } from "@/lib/amego-sync";

export const maxDuration = 60;

/**
 * 光貿發票定期同步：由 Vercel Cron 呼叫（每月 1、11、21 日），
 * 把光貿平台開立的發票撈回 ERP、補齊作廢狀態。
 * 環境變數：CRON_SECRET（與其他 cron 相同）
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase 未設定" }, { status: 500 });
  }
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? anonKey);

  try {
    // 每 10 天跑一次，窗口抓 30 天確保涵蓋（同步具冪等性，重複檢查無副作用）
    const result = await runAmegoSync(db, 30);
    console.log("[cron/amego-sync]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "光賀同步失敗";
    console.error("[cron/amego-sync]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
