import { NextResponse } from "next/server";
import { authPortalRequest } from "@/lib/portal-api";
import { canEditOrDelete } from "@/lib/portal-order-rules";

/** 通路刪除訂單：軟刪除（僅限生產前狀態、限本人訂單） */
export async function POST(request: Request) {
  const auth = await authPortalRequest(request);
  if (!auth.ok) return auth.response;
  const { client, identity, body } = auth;

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const { data: existing, error: statusErr } = await client
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (statusErr) {
      console.error("portal orders/delete status check:", statusErr);
      return NextResponse.json({ error: "query" }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!canEditOrDelete(String((existing as { status?: string }).status ?? ""))) {
      return NextResponse.json({ error: "locked" }, { status: 409 });
    }

    const { error: delErr } = await client
      .from("orders")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("customer_id", identity.customer_id);
    if (delErr) {
      console.error("portal orders/delete:", delErr);
      return NextResponse.json({ error: "delete" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("portal orders/delete:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
