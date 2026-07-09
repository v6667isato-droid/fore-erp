import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPortalSession } from "@/lib/portal-token";
import {
  plannedEndLatestByOrderIdFromWorkOrderRows,
  type WorkOrderPlannedWithOrderId,
} from "@/lib/planned-end-aggregate";
import { workOrderStageSortIndex } from "@/lib/work-order-stages";

/**
 * 通路「我的訂單」預計完成日：瀏覽器為 anon，無法讀取 work_orders（RLS 僅允許員工等）。
 * 以登入時簽發之 portal_token 驗證身分後，用 service role 代查 planned_end_date。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token : "";
    const order_ids = Array.isArray(body?.order_ids)
      ? (body.order_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];

    const v = verifyPortalSession(token);
    if (!v) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url?.trim() || !key?.trim()) {
      console.error("planned-end-dates: missing SUPABASE_SERVICE_ROLE_KEY");
      return NextResponse.json({ error: "server_config" }, { status: 500 });
    }

    if (order_ids.length === 0) {
      return NextResponse.json({ planned_by_order: {} as Record<string, string | null> });
    }

    const supabase = createClient(url, key);
    const { data: owned, error: oErr } = await supabase
      .from("orders")
      .select("id")
      .eq("customer_id", v.customer_id)
      .is("deleted_at", null)
      .in("id", order_ids);

    if (oErr) {
      console.error("planned-end-dates orders:", oErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }

    const allowedSet = new Set((owned ?? []).map((r: { id: string }) => String(r.id)));
    const allowedList = order_ids.filter((id) => allowedSet.has(id));
    if (allowedList.length === 0) {
      return NextResponse.json({ planned_by_order: {} as Record<string, string | null> });
    }

    const { data: wos, error: wErr } = await supabase
      .from("work_orders")
      .select("planned_end_date, stage, order_items!inner(order_id)")
      .in("order_items.order_id", allowedList);

    if (wErr) {
      console.error("planned-end-dates work_orders:", wErr);
      return NextResponse.json({ error: "work_orders" }, { status: 500 });
    }

    const acc = plannedEndLatestByOrderIdFromWorkOrderRows((wos ?? []) as WorkOrderPlannedWithOrderId[]);

    const planned_by_order: Record<string, string | null> = {};
    for (const id of allowedList) {
      planned_by_order[id] = acc.get(id) ?? null;
    }

    const earliest_stage_by_order: Record<string, string | null> = {};
    const stageByOrder = new Map<string, string>();
    for (const row of (wos ?? []) as any[]) {
      const oi = row.order_items;
      const orderId = Array.isArray(oi) ? String(oi[0]?.order_id) : String(oi?.order_id);
      const stage = typeof row.stage === "string" ? row.stage : null;
      if (!orderId || !stage) continue;
      const prev = stageByOrder.get(orderId);
      if (!prev || workOrderStageSortIndex(stage) < workOrderStageSortIndex(prev)) {
        stageByOrder.set(orderId, stage);
      }
    }
    for (const id of allowedList) {
      earliest_stage_by_order[id] = stageByOrder.get(id) ?? null;
    }

    return NextResponse.json({ planned_by_order, earliest_stage_by_order });
  } catch (e) {
    console.error("planned-end-dates:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
