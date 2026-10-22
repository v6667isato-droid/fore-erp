import { NextResponse } from "next/server";
import { authPortalRequest } from "@/lib/portal-api";

/**
 * 通路下單頁的系列折扣：只回傳登入通路自己的折扣（通路由 portal_token 決定，前端無法指定）。
 * product_series_channel_discounts 不開放 anon 讀取，避免任何人看到所有通路的折扣。
 */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity } = auth;

  try {
    const { data, error } = await client
      .from("product_series_channel_discounts")
      .select("series_id, discount_percent")
      .eq("channel_id", identity.channel_id);
    if (error) {
      console.error("portal channel-discounts:", error);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    const discounts = ((data ?? []) as Array<{ series_id: string | null; discount_percent: number | null }>)
      .filter((r) => r.series_id != null)
      .map((r) => ({ series_id: String(r.series_id), discount_percent: Number(r.discount_percent ?? 0) }));
    return NextResponse.json({ discounts });
  } catch (e) {
    console.error("portal channel-discounts:", e);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
