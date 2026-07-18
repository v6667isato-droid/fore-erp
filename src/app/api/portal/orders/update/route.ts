import { NextResponse } from "next/server";
import {
  authPortalRequest,
  portalItemInsertPayload,
  pricePortalItems,
  readPortalOrderFields,
} from "@/lib/portal-api";
import { canEditOrDelete } from "@/lib/portal-order-rules";
import {
  DEFAULT_WORK_ORDER_STAGE,
  plannedEndDateFromOrderDelivery,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";

/** 通路編輯訂單：更新單頭並整批重建明細與工單（僅限生產前狀態） */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity, body } = auth;

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const fields = readPortalOrderFields(body?.order);
  if (!fields.expected_delivery_date) {
    return NextResponse.json({ error: "missing_delivery_date" }, { status: 400 });
  }

  try {
    const { data: existing, error: statusErr } = await client
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (statusErr) {
      console.error("portal orders/update status check:", statusErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!canEditOrDelete(String((existing as { status?: string }).status ?? ""))) {
      return NextResponse.json({ error: "locked" }, { status: 409 });
    }

    const priced = await pricePortalItems(client, identity.channel_id, body?.items);
    if (!priced.ok) {
      console.error("portal orders/update pricing:", priced.error);
      const status = priced.error === "no_items" || priced.error === "bad_item" ? 400 : 500;
      return NextResponse.json({ error: priced.error }, { status });
    }

    const { error: updateErr } = await client
      .from("orders")
      .update({
        order_date: fields.order_date,
        expected_delivery_date: fields.expected_delivery_date,
        shipping_address: fields.shipping_address,
        internal_notes: fields.internal_notes,
        total_amount: priced.totalAmount,
      })
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id);
    if (updateErr) {
      console.error("portal orders/update order:", updateErr);
      return NextResponse.json({ error: "update_order" }, { status: 500 });
    }

    // 與原前端流程一致：先刪工單再刪明細，最後整批重建
    const { data: existingItems, error: existingErr } = await client
      .from("order_items")
      .select("id")
      .eq("order_id", orderId);
    if (existingErr) {
      console.error("portal orders/update existing items:", existingErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    const oldItemIds = (existingItems ?? []).map((x: { id: string }) => x.id);
    if (oldItemIds.length > 0) {
      const { error: woDelErr } = await client
        .from("work_orders")
        .delete()
        .in("order_item_id", oldItemIds);
      if (woDelErr) {
        console.error("portal orders/update delete work_orders:", woDelErr);
        return NextResponse.json({ error: "update_items" }, { status: 500 });
      }
    }
    const { error: itemDelErr } = await client
      .from("order_items")
      .delete()
      .eq("order_id", orderId);
    if (itemDelErr) {
      console.error("portal orders/update delete items:", itemDelErr);
      return NextResponse.json({ error: "update_items" }, { status: 500 });
    }

    const { data: insertedItems, error: itemsErr } = await client
      .from("order_items")
      .insert(portalItemInsertPayload(orderId, priced.items))
      .select("id");
    if (itemsErr) {
      console.error("portal orders/update insert items:", itemsErr);
      return NextResponse.json({ error: "update_items" }, { status: 500 });
    }

    const plannedFromDelivery = plannedEndDateFromOrderDelivery(fields.expected_delivery_date);
    const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
      order_item_id: row.id,
      stage: DEFAULT_WORK_ORDER_STAGE,
      status: "未開始",
      planned_end_date: plannedFromDelivery,
    }));
    if (workOrderPayload.length > 0) {
      const { error: woInsErr } = await client.from("work_orders").insert(workOrderPayload);
      if (woInsErr) {
        console.error("portal orders/update insert work_orders:", woInsErr);
      } else {
        const { data: ordRow } = await client
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .single();
        const st = (ordRow as { status?: string } | null)?.status;
        if (st) {
          await syncWorkOrdersToOrderStatus(client, orderId, st);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("portal orders/update:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
