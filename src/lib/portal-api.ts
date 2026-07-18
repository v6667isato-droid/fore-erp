import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyPortalSession } from "@/lib/portal-token";

/**
 * /api/portal/* 共用：orders / order_items / work_orders 已啟用 RLS，
 * 通路端（anon）改由這些 routes 以 service role 代查代寫；
 * 每個 route 都必須用 portal_token 內的 customer_id 做 server 端過濾。
 */

export type PortalIdentity = { customer_id: string; channel_id: string };

export type PortalAuthResult =
  | { ok: true; client: SupabaseClient; identity: PortalIdentity; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/** 解析 request body、驗 portal token、建立 service role client */
export async function authPortalRequest(request: Request): Promise<PortalAuthResult> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "bad_request" }, { status: 400 }),
    };
  }

  const token = typeof body?.token === "string" ? body.token : "";
  const v = verifyPortalSession(token);
  if (!v) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) {
    console.error("portal-api: missing SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      response: NextResponse.json({ error: "server_config" }, { status: 500 }),
    };
  }

  return { ok: true, client: createClient(url, key), identity: v, body };
}

export type PortalPricedItem = {
  variant_id: string;
  quantity: number;
  notes: string | null;
  seat_height_cm: number | null;
  /** 牌價（product_variants.base_price），寫入 order_items.unit_price */
  list_unit_price: number;
  /** 結算單價：系列通路折扣 % > 0 時之通路價，否則牌價 */
  settlement_unit_price: number;
};

/**
 * 驗證通路送來的品項並以 DB 價格重新計價（不信任前端金額）。
 * 計價邏輯與 portal 前端 portalListUnitPrice / portalSettlementUnitPrice 一致。
 */
export async function pricePortalItems(
  client: SupabaseClient,
  channelId: string,
  rawItems: unknown,
): Promise<
  | { ok: true; items: PortalPricedItem[]; totalAmount: number }
  | { ok: false; error: string }
> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "no_items" };
  }

  const parsed: Array<{
    variant_id: string;
    quantity: number;
    notes: string | null;
    seat_height_cm: number | null;
  }> = [];
  for (const raw of rawItems) {
    const it = raw as Record<string, unknown>;
    const variantId = typeof it?.variant_id === "string" ? it.variant_id.trim() : "";
    const quantity = Number(it?.quantity);
    if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: "bad_item" };
    }
    const seat = Number(it?.seat_height_cm);
    parsed.push({
      variant_id: variantId,
      quantity,
      notes:
        typeof it?.notes === "string" && it.notes.trim() !== "" ? String(it.notes) : null,
      seat_height_cm: Number.isFinite(seat) ? seat : null,
    });
  }

  const variantIds = Array.from(new Set(parsed.map((p) => p.variant_id)));
  const { data: variantRows, error: variantErr } = await client
    .from("product_variants")
    .select("id, base_price, series_id")
    .in("id", variantIds);
  if (variantErr) {
    return { ok: false, error: variantErr.message };
  }
  const variantById = new Map(
    ((variantRows ?? []) as Array<{ id: string; base_price: number | null; series_id: string | null }>).map(
      (v) => [String(v.id), v],
    ),
  );
  if (variantIds.some((id) => !variantById.has(id))) {
    return { ok: false, error: "bad_variant" };
  }

  const { data: discountRows, error: discountErr } = await client
    .from("product_series_channel_discounts")
    .select("series_id, discount_percent")
    .eq("channel_id", channelId);
  if (discountErr) {
    return { ok: false, error: discountErr.message };
  }
  const pctBySeries = new Map<string, number>();
  for (const r of (discountRows ?? []) as Array<{ series_id: string | null; discount_percent: number | null }>) {
    if (r.series_id != null) pctBySeries.set(String(r.series_id), Number(r.discount_percent ?? 0));
  }

  const items: PortalPricedItem[] = parsed.map((p) => {
    const v = variantById.get(p.variant_id)!;
    const base =
      v.base_price != null && Number.isFinite(Number(v.base_price)) ? Number(v.base_price) : null;
    const list = base ?? 0;
    const pct = v.series_id != null ? (pctBySeries.get(String(v.series_id)) ?? 0) : 0;
    const settlement = base != null && pct > 0 ? Math.round(base * (1 - pct / 100)) : list;
    return { ...p, list_unit_price: list, settlement_unit_price: settlement };
  });

  const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.settlement_unit_price, 0);
  return { ok: true, items, totalAmount };
}

/** order_items 寫入 payload（portal 品項一律非客製） */
export function portalItemInsertPayload(orderId: string, items: PortalPricedItem[]) {
  return items.map((it, lineIndex) => ({
    order_id: orderId,
    line_order: lineIndex,
    variant_id: it.variant_id,
    quantity: it.quantity,
    unit_price: it.list_unit_price,
    custom_notes: it.notes,
    custom_category: null,
    custom_name: null,
    custom_description: null,
    custom_dimension_w: null,
    custom_dimension_d: null,
    custom_dimension_h: null,
    seat_height_cm: it.seat_height_cm,
  }));
}

/** 通路可傳入的訂單欄位（皆選填字串；空字串視為 null） */
export function readPortalOrderFields(raw: unknown): {
  order_date: string | null;
  expected_delivery_date: string | null;
  shipping_contact_name: string | null;
  shipping_contact_phone: string | null;
  shipping_address: string | null;
  internal_notes: string | null;
} {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const v = o[key];
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s === "" ? null : v;
  };
  return {
    order_date: str("order_date"),
    expected_delivery_date: str("expected_delivery_date"),
    shipping_contact_name: str("shipping_contact_name"),
    shipping_contact_phone: str("shipping_contact_phone"),
    shipping_address: str("shipping_address"),
    internal_notes: str("internal_notes"),
  };
}
