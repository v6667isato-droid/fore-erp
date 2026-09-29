import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyPortalSession } from "@/lib/portal-token";
import {
  MAX_EXPLANATION_IMAGES,
  ORDER_EXPLANATION_BUCKET,
  serializeExplanationImages,
  type ExplanationImage,
} from "@/lib/explanation-images";
import { CUSTOM_ITEM_CATEGORIES } from "@/lib/portal-order-rules";

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

  // x-actor：讓 DB 端 log_audit trigger 記到操作來源（service role 沒有 auth.uid()）
  const client = createClient(url, key, {
    global: { headers: { "x-actor": `portal:${v.channel_id}` } },
  });
  return { ok: true, client, identity: v, body };
}

type PortalItemCommon = {
  quantity: number;
  seat_height_cm: number | null;
  /** 編輯既有訂單時的來源 order_items.id；據此凍結價格快照、沿用內部補填欄位 */
  source_item_id: string | null;
  /** 牌價，寫入 order_items.unit_price */
  list_unit_price: number;
  /** 通路價快照，寫入 order_items.channel_unit_price；null＝無通路價（依牌價結算） */
  channel_unit_price: number | null;
};

/** 規格庫品項：價格由 DB 牌價／系列通路折扣決定 */
export type PortalVariantItem = PortalItemCommon & {
  kind: "variant";
  variant_id: string;
  notes: string | null;
  /** 系列品類（product_series.category），寫入 order_items.custom_category（與 ERP 開單一致） */
  series_category: string | null;
  /** 內部於 ERP 補填的欄位（木種、尺寸、圖片）：編輯時 variant 未改選者沿用 */
  wood_type: string | null;
  custom_dimension_w: number | null;
  custom_dimension_d: number | null;
  custom_dimension_h: number | null;
  image_url: string | null;
};

/** 訂製品（客製家具，手填）：通路下單時價格為 0，由內部回填報價 */
export type PortalCustomItem = PortalItemCommon & {
  kind: "custom";
  custom_category: string;
  custom_name: string;
  custom_description: string | null;
  custom_dimension_w: number | null;
  custom_dimension_d: number | null;
  custom_dimension_h: number | null;
  wood_type: string | null;
  /** 內部於 ERP 補填的欄位：編輯時沿用 */
  custom_notes: string | null;
  image_url: string | null;
};

/** 內部新增、通路無法編輯的明細（訂製案例／加工項目）：編輯時整列原樣保留 */
export type PortalLockedItem = PortalItemCommon & {
  kind: "locked";
  row: PortalPrevItemRow | null;
};

export type PortalPricedItem = PortalVariantItem | PortalCustomItem | PortalLockedItem;

/** 編輯訂單時讀取的原有明細（select 字串見 PORTAL_PREV_ITEM_SELECT） */
export type PortalPrevItemRow = {
  id: string;
  variant_id: string | null;
  custom_case_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  channel_unit_price: number | null;
  custom_notes: string | null;
  custom_category: string | null;
  custom_name: string | null;
  custom_description: string | null;
  custom_dimension_w: number | null;
  custom_dimension_d: number | null;
  custom_dimension_h: number | null;
  seat_height_cm: number | null;
  image_url: string | null;
  wood_type: string | null;
};

export const PORTAL_PREV_ITEM_SELECT =
  "id, variant_id, custom_case_id, quantity, unit_price, channel_unit_price, custom_notes, custom_category, custom_name, custom_description, custom_dimension_w, custom_dimension_d, custom_dimension_h, seat_height_cm, image_url, wood_type";

/** 結算單價：有通路價用通路價，否則牌價 */
export function portalSettlementPrice(it: Pick<PortalItemCommon, "list_unit_price" | "channel_unit_price">): number {
  return it.channel_unit_price ?? it.list_unit_price;
}

function portalItemsTotal(items: PortalPricedItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * portalSettlementPrice(it), 0);
}

const trimmedOrNull = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s.slice(0, max);
};

const positiveOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const finiteOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sourceIdOf = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * 驗證通路送來的品項並以 DB 價格重新計價（不信任前端金額）。
 * - 規格品（kind 省略或 "variant"）：計價邏輯與 portal 前端 portalListUnitPrice / portalChannelUnitPrice 一致。
 *   已軟刪除的規格（或所屬系列已刪除）回 deleted_variant；
 *   keepVariantIds 為編輯中訂單原有的規格，允許沿用（舊明細不因下架而無法重存）。
 * - 訂製品（kind "custom"）：價格一律 0（待報價）；類別合法性與報價沿用由 applyPortalItemSnapshots 判斷。
 * - 鎖定列（kind "locked"）：只收 source_item_id，內容由 applyPortalItemSnapshots 從原明細帶回。
 */
export async function pricePortalItems(
  client: SupabaseClient,
  channelId: string,
  rawItems: unknown,
  keepVariantIds: ReadonlySet<string> = new Set(),
): Promise<
  | { ok: true; items: PortalPricedItem[]; totalAmount: number }
  | { ok: false; error: string }
> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "no_items" };
  }

  const parsed: Array<
    | Omit<PortalVariantItem, "list_unit_price" | "channel_unit_price" | "series_category">
    | PortalCustomItem
    | PortalLockedItem
  > = [];
  for (const raw of rawItems) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const sourceItemId = sourceIdOf(it.source_item_id);

    if (it.kind === "locked") {
      if (!sourceItemId) return { ok: false, error: "bad_item" };
      parsed.push({
        kind: "locked",
        row: null,
        quantity: 0,
        seat_height_cm: null,
        source_item_id: sourceItemId,
        list_unit_price: 0,
        channel_unit_price: null,
      });
      continue;
    }

    const quantity = Number(it.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, error: "bad_item" };
    }
    const seat = finiteOrNull(it.seat_height_cm);

    if (it.kind === "custom") {
      const category = trimmedOrNull(it.custom_category, 20);
      const name = trimmedOrNull(it.custom_name, 200);
      if (!category || !name) return { ok: false, error: "bad_item" };
      parsed.push({
        kind: "custom",
        quantity,
        seat_height_cm: seat,
        source_item_id: sourceItemId,
        list_unit_price: 0,
        channel_unit_price: null,
        custom_category: category,
        custom_name: name,
        custom_description: trimmedOrNull(it.custom_description, 2000),
        custom_dimension_w: positiveOrNull(it.custom_dimension_w),
        custom_dimension_d: positiveOrNull(it.custom_dimension_d),
        custom_dimension_h: positiveOrNull(it.custom_dimension_h),
        wood_type: trimmedOrNull(it.wood_type, 50),
        custom_notes: null,
        image_url: null,
      });
      continue;
    }

    const variantId = typeof it.variant_id === "string" ? it.variant_id.trim() : "";
    if (!variantId) return { ok: false, error: "bad_item" };
    parsed.push({
      kind: "variant",
      variant_id: variantId,
      quantity,
      notes: typeof it.notes === "string" && it.notes.trim() !== "" ? String(it.notes) : null,
      seat_height_cm: seat,
      source_item_id: sourceItemId,
      wood_type: null,
      custom_dimension_w: null,
      custom_dimension_d: null,
      custom_dimension_h: null,
      image_url: null,
    });
  }

  const variantIds = Array.from(
    new Set(parsed.flatMap((p) => (p.kind === "variant" ? [p.variant_id] : []))),
  );
  if (variantIds.length === 0) {
    const items = parsed as PortalPricedItem[];
    return { ok: true, items, totalAmount: portalItemsTotal(items) };
  }

  const { data: variantRows, error: variantErr } = await client
    .from("product_variants")
    .select("id, base_price, series_id, deleted_at, product_series(category, deleted_at)")
    .in("id", variantIds);
  if (variantErr) {
    return { ok: false, error: variantErr.message };
  }
  type SeriesRel = { category: string | null; deleted_at: string | null };
  type VariantRow = {
    id: string;
    base_price: number | null;
    series_id: string | null;
    deleted_at: string | null;
    product_series: SeriesRel | Array<SeriesRel> | null;
  };
  const variantById = new Map(
    ((variantRows ?? []) as VariantRow[]).map((v) => [String(v.id), v]),
  );
  if (variantIds.some((id) => !variantById.has(id))) {
    return { ok: false, error: "bad_variant" };
  }
  const seriesOf = (v: VariantRow) =>
    Array.isArray(v.product_series) ? v.product_series[0] : v.product_series;
  const isDeleted = (v: VariantRow) => v.deleted_at != null || seriesOf(v)?.deleted_at != null;
  if (
    variantIds.some((id) => !keepVariantIds.has(id) && isDeleted(variantById.get(id)!))
  ) {
    return { ok: false, error: "deleted_variant" };
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
    if (p.kind !== "variant") return p;
    const v = variantById.get(p.variant_id)!;
    const base =
      v.base_price != null && Number.isFinite(Number(v.base_price)) ? Number(v.base_price) : null;
    const list = base ?? 0;
    const pct = v.series_id != null ? (pctBySeries.get(String(v.series_id)) ?? 0) : 0;
    const settlement = base != null && pct > 0 ? Math.round(base * (1 - pct / 100)) : list;
    return {
      ...p,
      list_unit_price: list,
      // 通路價快照：有套折扣（結算價 ≠ 牌價）時寫入，供統計／發票直接讀取
      channel_unit_price: settlement !== list ? settlement : null,
      series_category: seriesOf(v)?.category?.trim() || null,
    };
  });

  return { ok: true, items, totalAmount: portalItemsTotal(items) };
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim() === (b ?? "").trim();
const sameNumber = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null ? null : Number(a)) === (b == null ? null : Number(b));
const positivePrice = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;

/**
 * 依原有明細（編輯訂單；新建傳空陣列）套用快照規則：
 * - 規格品：來源明細存在且 variant 未改選 → 沿用原牌價／通路價快照（重存不被現行牌價覆寫），
 *   並沿用內部補填的木種／尺寸／圖片。
 * - 訂製品：來源明細為訂製品且規格內容（類別、品名、說明、尺寸、木種、座高）未變 → 沿用內部回填的報價；
 *   內容有變則報價歸零待重新報價。一律沿用內部補填的品項備註與圖片。
 *   類別須為 CUSTOM_ITEM_CATEGORIES 之一（沿用原明細的舊類別除外）。
 * - 鎖定列：整列取自原明細（通路不可改）。
 * requote＝本次有新增訂製品、或已報價的訂製品內容被修改 → 訂單需回到「報價中」。
 */
export function applyPortalItemSnapshots(
  items: PortalPricedItem[],
  prevRows: PortalPrevItemRow[],
):
  | { ok: true; items: PortalPricedItem[]; totalAmount: number; requote: boolean }
  | { ok: false; error: string } {
  const prevById = new Map(prevRows.map((r) => [String(r.id), r]));
  let requote = false;
  const out: PortalPricedItem[] = [];

  for (const it of items) {
    const prev = it.source_item_id != null ? prevById.get(it.source_item_id) : undefined;

    if (it.kind === "locked") {
      if (!prev || prev.variant_id != null || prev.custom_case_id == null) {
        return { ok: false, error: "bad_item" };
      }
      out.push({
        ...it,
        row: prev,
        quantity: Number(prev.quantity ?? 1),
        seat_height_cm: prev.seat_height_cm,
        list_unit_price: Number(prev.unit_price ?? 0),
        channel_unit_price: positivePrice(prev.channel_unit_price),
      });
      continue;
    }

    if (it.kind === "variant") {
      if (!prev || String(prev.variant_id ?? "") !== it.variant_id) {
        out.push(it);
        continue;
      }
      const carried = {
        ...it,
        wood_type: prev.wood_type,
        custom_dimension_w: prev.custom_dimension_w,
        custom_dimension_d: prev.custom_dimension_d,
        custom_dimension_h: prev.custom_dimension_h,
        image_url: prev.image_url,
      };
      // 原本有牌價快照才凍結（舊資料 NULL 則採現行價）
      if (prev.unit_price == null || !Number.isFinite(Number(prev.unit_price))) {
        out.push(carried);
        continue;
      }
      out.push({
        ...carried,
        list_unit_price: Number(prev.unit_price),
        channel_unit_price: positivePrice(prev.channel_unit_price),
      });
      continue;
    }

    const prevCustom =
      prev && prev.variant_id == null && prev.custom_case_id == null ? prev : undefined;
    const categoryOk =
      (CUSTOM_ITEM_CATEGORIES as readonly string[]).includes(it.custom_category) ||
      (prevCustom != null && sameText(prevCustom.custom_category, it.custom_category));
    if (!categoryOk) return { ok: false, error: "bad_item" };

    if (!prevCustom) {
      requote = true;
      out.push(it);
      continue;
    }
    const unchanged =
      sameText(prevCustom.custom_category, it.custom_category) &&
      sameText(prevCustom.custom_name, it.custom_name) &&
      sameText(prevCustom.custom_description, it.custom_description) &&
      sameText(prevCustom.wood_type, it.wood_type) &&
      sameNumber(prevCustom.custom_dimension_w, it.custom_dimension_w) &&
      sameNumber(prevCustom.custom_dimension_d, it.custom_dimension_d) &&
      sameNumber(prevCustom.custom_dimension_h, it.custom_dimension_h) &&
      sameNumber(prevCustom.seat_height_cm, it.seat_height_cm);
    const prevList = positivePrice(prevCustom.unit_price);
    const prevChannel = positivePrice(prevCustom.channel_unit_price);
    const wasQuoted = prevList != null || prevChannel != null;
    if (!unchanged && wasQuoted) requote = true;
    out.push({
      ...it,
      custom_notes: prevCustom.custom_notes,
      image_url: prevCustom.image_url,
      list_unit_price: unchanged ? (prevList ?? 0) : 0,
      channel_unit_price: unchanged ? prevChannel : null,
    });
  }

  return { ok: true, items: out, totalAmount: portalItemsTotal(out), requote };
}

/** 是否含待報價的訂製品（建立訂單時決定狀態用） */
export function portalItemsNeedQuote(items: PortalPricedItem[]): boolean {
  return items.some(
    (it) => it.kind === "custom" && it.list_unit_price <= 0 && it.channel_unit_price == null,
  );
}

/** order_items 寫入 payload */
export function portalItemInsertPayload(orderId: string, items: PortalPricedItem[]) {
  return items.map((it, lineIndex) => {
    const base = { order_id: orderId, line_order: lineIndex };
    if (it.kind === "locked") {
      const r = it.row!;
      return {
        ...base,
        variant_id: null,
        custom_case_id: r.custom_case_id,
        quantity: it.quantity,
        unit_price: it.list_unit_price,
        channel_unit_price: it.channel_unit_price,
        custom_notes: r.custom_notes,
        custom_category: r.custom_category,
        custom_name: r.custom_name,
        custom_description: r.custom_description,
        custom_dimension_w: r.custom_dimension_w,
        custom_dimension_d: r.custom_dimension_d,
        custom_dimension_h: r.custom_dimension_h,
        seat_height_cm: r.seat_height_cm,
        image_url: r.image_url,
        wood_type: r.wood_type,
      };
    }
    if (it.kind === "custom") {
      return {
        ...base,
        variant_id: null,
        custom_case_id: null,
        quantity: it.quantity,
        unit_price: it.list_unit_price,
        channel_unit_price: it.channel_unit_price,
        custom_notes: it.custom_notes,
        custom_category: it.custom_category,
        custom_name: it.custom_name,
        custom_description: it.custom_description,
        custom_dimension_w: it.custom_dimension_w,
        custom_dimension_d: it.custom_dimension_d,
        custom_dimension_h: it.custom_dimension_h,
        seat_height_cm: it.seat_height_cm,
        image_url: it.image_url,
        wood_type: it.wood_type,
      };
    }
    return {
      ...base,
      variant_id: it.variant_id,
      custom_case_id: null,
      quantity: it.quantity,
      unit_price: it.list_unit_price,
      channel_unit_price: it.channel_unit_price,
      custom_notes: it.notes,
      // 與 ERP 開單一致：規格品自動帶入系列品類，供生產管理類別篩選
      custom_category: it.series_category,
      custom_name: null,
      custom_description: null,
      custom_dimension_w: it.custom_dimension_w,
      custom_dimension_d: it.custom_dimension_d,
      custom_dimension_h: it.custom_dimension_h,
      seat_height_cm: it.seat_height_cm,
      image_url: it.image_url,
      wood_type: it.wood_type,
    };
  });
}

/**
 * 通路送來的製作圖（寫入 orders.explanation_image_url）：
 * - undefined（舊版前端未送）→ 回 undefined，不動原本的圖
 * - 網址須為訂單說明圖 bucket 的公開網址，或訂單原本就有的圖（內部上傳的舊資料）
 */
export function readPortalExplanationImages(
  raw: unknown,
  existingUrls: ReadonlySet<string> = new Set(),
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_EXPLANATION_IMAGES) {
    return { ok: false, error: "bad_image" };
  }
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const bucketPrefix = `${base}/storage/v1/object/public/${ORDER_EXPLANATION_BUCKET}/`;
  const images: ExplanationImage[] = [];
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const allowed =
      (base !== "" && url.startsWith(bucketPrefix) && !url.includes("..")) || existingUrls.has(url);
    if (!url || !allowed) return { ok: false, error: "bad_image" };
    images.push({ url, title: trimmedOrNull(o.title, 100) });
  }
  return { ok: true, value: serializeExplanationImages(images) };
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
