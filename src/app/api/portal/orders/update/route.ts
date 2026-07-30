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

    // 價格快照凍結：明細帶 source_item_id 且 variant 未改選者，沿用原 unit_price／channel_unit_price
    // （重存訂單不得被現行牌價覆寫）；新明細或改選 variant 者才採用上面重算的現行價。
    // 金額仍全由後端決定，前端只傳來源明細 id，不信任前端金額。
    const rawItems = Array.isArray(body?.items) ? (body.items as unknown[]) : [];
    const sourceIds = rawItems.map((raw) => {
      const v = (raw as Record<string, unknown>)?.source_item_id;
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    });
    const { data: prevRows, error: prevErr } = await client
      .from("order_items")
      .select("id, variant_id, unit_price, channel_unit_price")
      .eq("order_id", orderId);
    if (prevErr) {
      console.error("portal orders/update prev items:", prevErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    const prevById = new Map(
      ((prevRows ?? []) as Array<{
        id: string;
        variant_id: string | null;
        unit_price: number | null;
        channel_unit_price: number | null;
      }>).map((r) => [String(r.id), r]),
    );
    const finalItems = priced.items.map((it, i) => {
      const srcId = sourceIds[i];
      const prev = srcId != null ? prevById.get(srcId) : undefined;
      // 僅來源明細存在、variant 未變、且原本有牌價快照（舊資料 NULL 除外）時凍結
      if (
        !prev ||
        String(prev.variant_id ?? "") !== it.variant_id ||
        prev.unit_price == null ||
        !Number.isFinite(Number(prev.unit_price))
      ) {
        return it;
      }
      const list = Number(prev.unit_price);
      const channel =
        prev.channel_unit_price != null &&
        Number.isFinite(Number(prev.channel_unit_price)) &&
        Number(prev.channel_unit_price) > 0
          ? Number(prev.channel_unit_price)
          : null;
      return { ...it, list_unit_price: list, settlement_unit_price: channel ?? list };
    });
    const totalAmount = finalItems.reduce(
      (sum, it) => sum + it.quantity * it.settlement_unit_price,
      0,
    );

    const { error: updateErr } = await client
      .from("orders")
      .update({
        order_date: fields.order_date,
        expected_delivery_date: fields.expected_delivery_date,
        shipping_address: fields.shipping_address,
        internal_notes: fields.internal_notes,
        total_amount: totalAmount,
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
      .insert(portalItemInsertPayload(orderId, finalItems))
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
