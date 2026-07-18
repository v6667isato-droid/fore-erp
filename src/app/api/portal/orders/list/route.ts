import { NextResponse } from "next/server";
import { authPortalRequest } from "@/lib/portal-api";

/** 通路「我的訂單」列表：orders + 各訂單牌價小計（order_items 需 service role 代查） */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity } = auth;

  try {
    const { data: orderRows, error: orderErr } = await client
      .from("orders")
      .select(
        "id, order_number, order_date, shipping_contact_name, expected_delivery_date, status, payment_status, total_amount, shipping_fee",
      )
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .order("order_date", { ascending: false })
      .limit(100);
    if (orderErr) {
      console.error("portal orders/list orders:", orderErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }

    const orders = (orderRows ?? []) as Array<Record<string, unknown>>;
    const orderIds = orders.map((r) => String(r.id));

    const list_grand_by_order: Record<string, number> = {};
    if (orderIds.length > 0) {
      const { data: itemRows, error: itemErr } = await client
        .from("order_items")
        .select("order_id, quantity, unit_price")
        .in("order_id", orderIds);
      if (itemErr) {
        console.error("portal orders/list items:", itemErr);
        return NextResponse.json({ error: "query" }, { status: 500 });
      }

      const lineSumByOrder = new Map<string, number>();
      for (const row of (itemRows ?? []) as Array<{
        order_id: string | null;
        quantity: number | null;
        unit_price: number | null;
      }>) {
        const oid = String(row.order_id ?? "");
        if (!oid) continue;
        const q = Math.max(0, Number(row.quantity) || 0);
        const line = Math.round(Number(row.unit_price ?? 0) * q);
        lineSumByOrder.set(oid, (lineSumByOrder.get(oid) ?? 0) + line);
      }
      for (const r of orders) {
        const oid = String(r.id);
        list_grand_by_order[oid] =
          (lineSumByOrder.get(oid) ?? 0) + Number(r.shipping_fee ?? 0);
      }
    }

    return NextResponse.json({ orders, list_grand_by_order });
  } catch (e) {
    console.error("portal orders/list:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
