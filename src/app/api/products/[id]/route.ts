import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// product_series / product_variants 已有 anon SELECT 的 RLS 政策，這裡用 anon key 即可，不需 service role
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 官網（fore-furniture.com）會直接呼叫此 API 顯示庫存狀態，需放行跨網域請求
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 路由參數是官網使用的系列編號（例如 CB01、CB05），對應 product_series.series_name
  // 注意：series_name 不一定完全等於編號，可能帶後綴（例如 "CB05 - Flow"），所以用前綴比對
  const { id: seriesCode } = await params;

  const { data: series, error: seriesError } = await supabase
    .from("product_series")
    .select(
      // website_article / customization_rules 給 fore-furniture.com 顯示完整文案用
      "id, series_name, category, design_concept, website_article, customization_rules, image_url"
    )
    .ilike("series_name", `${seriesCode}%`)
    .maybeSingle();

  if (seriesError) {
    console.error("GET /api/products/[id] series error:", seriesError);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  if (!series) {
    return withCors(NextResponse.json({ error: "找不到此商品" }, { status: 404 }));
  }

  // 同一系列底下會有多個變體（不同木種/尺寸），起價取所有變體中最低的 base_price
  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("base_price")
    .eq("series_id", series.id)
    .is("deleted_at", null)
    .not("base_price", "is", null);

  if (variantsError) {
    console.error("GET /api/products/[id] variants error:", variantsError);
    return withCors(NextResponse.json({ error: "查詢失敗" }, { status: 500 }));
  }

  const prices = (variants ?? [])
    .map((v) => v.base_price)
    .filter((price): price is number => price !== null);
  const priceFrom = prices.length > 0 ? Math.min(...prices) : null;

  return withCors(
    NextResponse.json({
      series_name: series.series_name,
      category: series.category,
      design_concept: series.design_concept,
      website_article: series.website_article,
      customization_rules: series.customization_rules,
      image_url: series.image_url,
      price_from: priceFrom,
      variant_count: variants?.length ?? 0,
    })
  );
}
