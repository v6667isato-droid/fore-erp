import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// custom_cases 的 anon RLS 僅放行 kind='custom' 且 published=true 的資料，
// 加工區（kind='processing'，維修保養）在資料庫層即讀不到，不會外洩到官網
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 官網（fore-furniture.com）客製訂做頁會呼叫此 API，需放行跨網域請求
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

/** 官網客製訂做頁用：回傳全部已發佈的訂製案例 */
export async function GET() {
  const { data, error } = await supabase
    .from("custom_cases")
    .select(
      "id, case_code, name_zh, name_en, category, material, dimension_w, dimension_d, dimension_h, dimensions_note, completed_year, story_zh, story_en, image_url, object_position, process_image_urls, sort_order"
    )
    .eq("kind", "custom")
    .eq("published", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("case_code", { ascending: false });

  if (error) {
    console.error("GET /api/customized error:", error);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  const cases = (data ?? []).map((r) => ({
    ...r,
    process_image_urls: Array.isArray(r.process_image_urls)
      ? (r.process_image_urls as unknown[]).map((u) => String(u)).filter(Boolean)
      : [],
  }));

  return withCors(NextResponse.json({ cases }));
}
