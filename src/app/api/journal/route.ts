import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// journal_posts 的 anon RLS 僅放行 published=true 且未刪除的文章，用 anon key 即可
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 官網（fore-furniture.com）Journal 頁會呼叫此 API，需放行跨網域請求
const ALLOWED_ORIGIN = process.env.WEBSITE_ORIGIN ?? "https://fore-furniture.com";

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** 官網 Journal 列表用：回傳全部已發佈文章（含內文區塊，讓官網一次拿齊做相關文章） */
export async function GET() {
  const { data, error } = await supabase
    .from("journal_posts")
    .select(
      "post_code, tag, title_zh, title_en, excerpt_zh, excerpt_en, post_date, content_zh, content_en, image_url, object_position, sort_order"
    )
    .eq("published", true)
    .is("deleted_at", null)
    .order("post_date", { ascending: false });

  if (error) {
    console.error("GET /api/journal error:", error);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  return withCors(NextResponse.json({ posts: data ?? [] }));
}
