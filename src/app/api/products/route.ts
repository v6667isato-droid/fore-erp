import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// product_series / product_variants 已有 anon SELECT 的 RLS 政策，這裡用 anon key 即可，不需 service role
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 官網（fore-furniture.com）作品列表會呼叫此 API 讀取全部產品系列，需放行跨網域請求
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

/** 官網作品列表用：回傳全部未刪除的產品系列，含各系列最低起價 */
export async function GET() {
  const { data: seriesList, error: seriesError } = await supabase
    .from("product_series")
    .select("id, series_name, category, image_url, hover_image_url, detail_image_urls, image_meta")
    .is("deleted_at", null)
    .order("series_name", { ascending: true });

  if (seriesError) {
    console.error("GET /api/products series error:", seriesError);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("series_id, base_price")
    .is("deleted_at", null)
    .not("base_price", "is", null);

  if (variantsError) {
    console.error("GET /api/products variants error:", variantsError);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  // 各系列最低 base_price 當作官網顯示的「起價」
  const priceFromBySeries = new Map<string, number>();
  for (const v of variants ?? []) {
    if (v.base_price == null || v.series_id == null) continue;
    const current = priceFromBySeries.get(v.series_id);
    if (current == null || v.base_price < current) {
      priceFromBySeries.set(v.series_id, v.base_price);
    }
  }

  const products = (seriesList ?? []).map((s) => {
    // 主視覺圖的裁切焦點：從 image_meta（以圖片 URL 為 key）取出，供官網作品列表 4:5 裁切用
    const meta =
      s.image_meta && typeof s.image_meta === "object" && !Array.isArray(s.image_meta)
        ? (s.image_meta as Record<string, { object_position?: string | null }>)
        : {};
    const mainMeta = s.image_url ? meta[s.image_url] : undefined;
    const hoverMeta = s.hover_image_url ? meta[s.hover_image_url] : undefined;
    return {
      id: s.id,
      series_name: s.series_name,
      category: s.category,
      image_url: s.image_url,
      image_object_position: mainMeta?.object_position ?? null,
      // 第二張主視覺圖：官網作品牆 hover 換圖用；null＝官網 hover 維持微放大
      hover_image_url: s.hover_image_url ?? null,
      hover_image_object_position: hoverMeta?.object_position ?? null,
      detail_image_urls: Array.isArray(s.detail_image_urls)
        ? (s.detail_image_urls as unknown[]).map((u) => String(u)).filter(Boolean)
        : [],
      price_from: priceFromBySeries.get(s.id) ?? null,
    };
  });

  return withCors(NextResponse.json({ products }));
}
