import { NextResponse } from "next/server";
import {
  authPortalRequest,
  portalItemInsertPayload,
  pricePortalItems,
  readPortalOrderFields,
} from "@/lib/portal-api";
import { generatePortalOrderNumber } from "@/lib/portal-order-rules";
import {
  DEFAULT_WORK_ORDER_STAGE,
  plannedEndDateFromOrderDelivery,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";

/** 通路下單：建立 orders + order_items + work_orders（金額一律以 DB 價格重算） */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity, body } = auth;

  const fields = readPortalOrderFields(body?.order);
  if (!fields.expected_delivery_date) {
    return NextResponse.json({ error: "missing_delivery_date" }, { status: 400 });
  }

  const priced = await pricePortalItems(client, identity.channel_id, body?.items);
  if (!priced.ok) {
    console.error("portal orders/create pricing:", priced.error);
    const status = priced.error === "no_items" || priced.error === "bad_item" ? 400 : 500;
    return NextResponse.json({ error: priced.error }, { status });
  }

  try {
    const orderNumber = generatePortalOrderNumber();
    const { data: orderRow, error: orderErr } = await client
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: identity.customer_id,
        order_date: fields.order_date,
        expected_delivery_date: fields.expected_delivery_date,
        status: "排程中",
        payment_status: "未付款",
        total_amount: priced.totalAmount,
        deposit_amount: 0,
        shipping_contact_name: fields.shipping_contact_name,
        shipping_contact_phone: fields.shipping_contact_phone,
        shipping_address: fields.shipping_address,
        internal_notes: fields.internal_notes,
        source: "portal",
      })
      .select("id")
      .single();
    if (orderErr || !orderRow) {
      console.error("portal orders/create order:", orderErr);
      return NextResponse.json({ error: "create_order" }, { status: 500 });
    }
    const orderId = String(orderRow.id);

    const { data: insertedItems, error: itemsErr } = await client
      .from("order_items")
      .insert(portalItemInsertPayload(orderId, priced.items))
      .select("id");
    if (itemsErr) {
      console.error("portal orders/create items:", itemsErr);
      // 明細寫入失敗：回收剛建立的空訂單，避免留下孤兒單
      await client.from("orders").delete().eq("id", orderId);
      return NextResponse.json({ error: "create_items" }, { status: 500 });
    }

    const plannedFromDelivery = plannedEndDateFromOrderDelivery(fields.expected_delivery_date);
    const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
      order_item_id: row.id,
      stage: DEFAULT_WORK_ORDER_STAGE,
      status: "未開始",
      planned_end_date: plannedFromDelivery,
    }));
    let workOrdersOk = true;
    if (workOrderPayload.length > 0) {
      const { error: woErr } = await client.from("work_orders").insert(workOrderPayload);
      if (woErr) {
        console.error("portal orders/create work_orders:", woErr);
        workOrdersOk = false;
      } else {
        await syncWorkOrdersToOrderStatus(client, orderId, "排程中");
      }
    }

    return NextResponse.json({
      order_id: orderId,
      order_number: orderNumber,
      work_orders_ok: workOrdersOk,
    });
  } catch (e) {
    console.error("portal orders/create:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
