import { NextResponse } from "next/server";
import { authPortalRequest } from "@/lib/portal-api";
import { ORDER_OVERVIEW_SELECT } from "@/lib/order-overview-select";

/**
 * 通路訂單總覽卡：以 service role 讀取訂單完整資料（限本人），
 * 回傳原始 rows，由前端沿用 orders-overview-page 的 parse 邏輯。
 */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity, body } = auth;

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const { data, error } = await client
      .from("orders")
      .select(ORDER_OVERVIEW_SELECT)
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("portal orders/overview:", error);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // 內部指派員工姓名不外流給通路端（維持 RLS 前 anon 看不到 employees 的行為）
    const row = data as { order_items?: Array<{ work_orders?: Array<{ employees?: unknown }> | null }> | null };
    for (const oi of row.order_items ?? []) {
      for (const wo of oi.work_orders ?? []) {
        if (wo && "employees" in wo) wo.employees = null;
      }
    }

    return NextResponse.json({ row });
  } catch (e) {
    console.error("portal orders/overview:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
