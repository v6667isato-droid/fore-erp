import { NextResponse } from "next/server";
import {
  applyPortalItemSnapshots,
  authPortalRequest,
  PORTAL_PREV_ITEM_SELECT,
  portalItemInsertPayload,
  pricePortalItems,
  readPortalExplanationImages,
  readPortalOrderFields,
  type PortalPrevItemRow,
} from "@/lib/portal-api";
import { canEditOrDelete, PORTAL_QUOTE_STATUS } from "@/lib/portal-order-rules";
import { parseExplanationImages } from "@/lib/explanation-images";
import {
  DEFAULT_WORK_ORDER_STAGE,
  plannedEndDateFromOrderDelivery,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";

/**
 * 通路編輯訂單：更新單頭並整批重建明細與工單（僅限生產前狀態）。
 * 新增訂製品、或修改已報價的訂製品時，訂單退回「報價中」等內部重新報價。
 */
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
      .select("status, explanation_image_url")
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (statusErr) {
      console.error("portal orders/update status check:", statusErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const existingRow = existing as { status?: string | null; explanation_image_url?: string | null };
    const currentStatus = String(existingRow.status ?? "").trim();
    if (!canEditOrDelete(currentStatus)) {
      return NextResponse.json({ error: "locked" }, { status: 409 });
    }

    // 製作圖：訂單原有的圖（含內部上傳）允許原樣送回
    const images = readPortalExplanationImages(
      body?.explanation_images,
      new Set(parseExplanationImages(existingRow.explanation_image_url).map((img) => img.url)),
    );
    if (!images.ok) {
      return NextResponse.json({ error: images.error }, { status: 400 });
    }

    const { data: prevData, error: prevErr } = await client
      .from("order_items")
      .select(PORTAL_PREV_ITEM_SELECT)
      .eq("order_id", orderId);
    if (prevErr) {
      console.error("portal orders/update prev items:", prevErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    const prevRows = (prevData ?? []) as unknown as PortalPrevItemRow[];

    // 訂單原有的規格即使已下架（軟刪除）仍允許沿用；新選的規格不得為已刪除
    const keepVariantIds = new Set(
      prevRows.map((r) => (r.variant_id != null ? String(r.variant_id) : "")).filter(Boolean),
    );
    const rawPriced = await pricePortalItems(client, identity.channel_id, body?.items, keepVariantIds);
    // 價格快照凍結（重存訂單不得被現行牌價覆寫）、訂製品報價沿用／歸零、鎖定列原樣保留。
    // 金額仍全由後端決定，前端只傳來源明細 id，不信任前端金額。
    const priced = rawPriced.ok ? applyPortalItemSnapshots(rawPriced.items, prevRows) : rawPriced;
    if (!priced.ok) {
      console.error("portal orders/update pricing:", priced.error);
      const status =
        priced.error === "no_items" || priced.error === "bad_item" || priced.error === "deleted_variant"
          ? 400
          : 500;
      return NextResponse.json({ error: priced.error }, { status });
    }
    const finalItems = priced.items;
    const nextStatus = priced.requote ? PORTAL_QUOTE_STATUS : currentStatus;

    const { error: updateErr } = await client
      .from("orders")
      .update({
        order_date: fields.order_date,
        expected_delivery_date: fields.expected_delivery_date,
        shipping_address: fields.shipping_address,
        internal_notes: fields.internal_notes,
        total_amount: priced.totalAmount,
        ...(nextStatus !== currentStatus ? { status: nextStatus } : {}),
        ...(images.value !== undefined ? { explanation_image_url: images.value } : {}),
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

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (e) {
    console.error("portal orders/update:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
