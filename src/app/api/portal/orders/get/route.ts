import { NextResponse } from "next/server";
import { authPortalRequest } from "@/lib/portal-api";

/** 通路編輯訂單：讀取單一訂單（限本人）與明細（含規格牌價） */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity, body } = auth;

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const { data: order, error: orderErr } = await client
      .from("orders")
      .select("id, order_date, expected_delivery_date, shipping_address, internal_notes, status")
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (orderErr) {
      console.error("portal orders/get order:", orderErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: items, error: itemsErr } = await client
      .from("order_items")
      .select(
        "id, variant_id, quantity, unit_price, custom_notes, seat_height_cm, product_variants(base_price)",
      )
      .eq("order_id", orderId)
      .order("line_order", { ascending: true })
      .order("id", { ascending: true });
    if (itemsErr) {
      console.error("portal orders/get items:", itemsErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }

    return NextResponse.json({ order, items: items ?? [] });
  } catch (e) {
    console.error("portal orders/get:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
