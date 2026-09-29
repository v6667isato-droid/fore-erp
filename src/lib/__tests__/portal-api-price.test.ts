import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPortalItemSnapshots,
  portalItemInsertPayload,
  portalItemsNeedQuote,
  pricePortalItems,
  readPortalExplanationImages,
  type PortalPrevItemRow,
} from "@/lib/portal-api";

type VariantFixture = {
  id: string;
  base_price: number | null;
  series_id: string | null;
  deleted_at: string | null;
  product_series: { category: string | null; deleted_at: string | null } | null;
};

/** 只模擬 pricePortalItems 用到的兩個查詢：product_variants .in() 與折扣 .eq() */
function fakeClient(variants: VariantFixture[]): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in: async (_col: string, ids: string[]) => ({
              data: table === "product_variants" ? variants.filter((v) => ids.includes(v.id)) : [],
              error: null,
            }),
            eq: async () => ({ data: [], error: null }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const live: VariantFixture = {
  id: "v-live",
  base_price: 1000,
  series_id: "s1",
  deleted_at: null,
  product_series: { category: "椅", deleted_at: null },
};
const deletedVariant: VariantFixture = { ...live, id: "v-del", deleted_at: "2026-09-01T00:00:00Z" };
const deletedSeries: VariantFixture = {
  ...live,
  id: "v-series-del",
  product_series: { category: "椅", deleted_at: "2026-09-01T00:00:00Z" },
};
const client = fakeClient([live, deletedVariant, deletedSeries]);
const item = (variant_id: string) => ({ variant_id, quantity: 1 });

describe("pricePortalItems：已刪除規格", () => {
  it("未刪除規格可正常計價", async () => {
    const r = await pricePortalItems(client, "ch", [item("v-live")]);
    expect(r.ok).toBe(true);
  });

  it("規格已刪除 → deleted_variant", async () => {
    const r = await pricePortalItems(client, "ch", [item("v-live"), item("v-del")]);
    expect(r).toEqual({ ok: false, error: "deleted_variant" });
  });

  it("所屬系列已刪除 → deleted_variant", async () => {
    const r = await pricePortalItems(client, "ch", [item("v-series-del")]);
    expect(r).toEqual({ ok: false, error: "deleted_variant" });
  });

  it("編輯訂單：原有明細的已刪除規格允許沿用", async () => {
    const r = await pricePortalItems(client, "ch", [item("v-del"), item("v-live")], new Set(["v-del"]));
    expect(r.ok).toBe(true);
  });
});

const custom = (over: Record<string, unknown> = {}) => ({
  kind: "custom",
  quantity: 2,
  custom_category: "桌",
  custom_name: "實木餐桌",
  custom_dimension_w: 180,
  wood_type: "白橡木",
  ...over,
});

const prevCustomRow = (over: Partial<PortalPrevItemRow> = {}): PortalPrevItemRow => ({
  id: "oi-custom",
  variant_id: null,
  custom_case_id: null,
  quantity: 2,
  unit_price: 30000,
  channel_unit_price: 24000,
  custom_notes: "內部備註",
  custom_category: "桌",
  custom_name: "實木餐桌",
  custom_description: null,
  custom_dimension_w: 180,
  custom_dimension_d: null,
  custom_dimension_h: null,
  seat_height_cm: null,
  image_url: "https://img/1.webp",
  wood_type: "白橡木",
  ...over,
});

async function priceAndSnapshot(rawItems: unknown[], prevRows: PortalPrevItemRow[]) {
  const priced = await pricePortalItems(client, "ch", rawItems);
  if (!priced.ok) return priced;
  return applyPortalItemSnapshots(priced.items, prevRows);
}

describe("訂製品（客製家具）", () => {
  it("只有訂製品也能下單：價格 0、需報價", async () => {
    const r = await priceAndSnapshot([custom()], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalAmount).toBe(0);
    expect(r.requote).toBe(true);
    expect(portalItemsNeedQuote(r.items)).toBe(true);
  });

  it("缺類型或品名 → bad_item", async () => {
    expect(await pricePortalItems(client, "ch", [custom({ custom_name: " " })])).toEqual({
      ok: false,
      error: "bad_item",
    });
    expect(await pricePortalItems(client, "ch", [custom({ custom_category: "" })])).toEqual({
      ok: false,
      error: "bad_item",
    });
  });

  it("類別不在清單內 → bad_item（沿用原明細的舊類別除外）", async () => {
    expect(await priceAndSnapshot([custom({ custom_category: "架" })], [])).toEqual({
      ok: false,
      error: "bad_item",
    });
    const kept = await priceAndSnapshot(
      [custom({ custom_category: "架", source_item_id: "oi-custom" })],
      [prevCustomRow({ custom_category: "架" })],
    );
    expect(kept.ok).toBe(true);
  });

  it("內容未變 → 沿用內部報價與內部補填欄位，不需重新報價", async () => {
    const r = await priceAndSnapshot(
      [custom({ source_item_id: "oi-custom", quantity: 3 })],
      [prevCustomRow()],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const it = r.items[0];
    expect(it.kind).toBe("custom");
    if (it.kind !== "custom") return;
    expect(it.list_unit_price).toBe(30000);
    expect(it.channel_unit_price).toBe(24000);
    expect(it.custom_notes).toBe("內部備註");
    expect(it.image_url).toBe("https://img/1.webp");
    expect(r.totalAmount).toBe(72000);
    expect(r.requote).toBe(false);
    expect(portalItemsNeedQuote(r.items)).toBe(false);
  });

  it("已報價的訂製品改了尺寸 → 報價歸零並退回報價中", async () => {
    const r = await priceAndSnapshot(
      [custom({ source_item_id: "oi-custom", custom_dimension_w: 200 })],
      [prevCustomRow()],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items[0].list_unit_price).toBe(0);
    expect(r.items[0].channel_unit_price).toBeNull();
    expect(r.requote).toBe(true);
  });

  it("尚未報價的訂製品修改內容 → 不重複觸發退回", async () => {
    const r = await priceAndSnapshot(
      [custom({ source_item_id: "oi-custom", custom_name: "餐桌" })],
      [prevCustomRow({ unit_price: 0, channel_unit_price: null })],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requote).toBe(false);
  });

  it("規格品與訂製品混合：規格品照牌價計、訂製品 0", async () => {
    const r = await priceAndSnapshot([item("v-live"), custom()], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalAmount).toBe(1000);
    expect(portalItemsNeedQuote(r.items)).toBe(true);
  });
});

describe("內部新增的鎖定列", () => {
  const lockedPrev = prevCustomRow({
    id: "oi-case",
    custom_case_id: "case-1",
    custom_name: "保養",
    unit_price: 500,
    channel_unit_price: null,
    quantity: 1,
  });

  it("整列原樣保留並計入金額", async () => {
    const r = await priceAndSnapshot([{ kind: "locked", source_item_id: "oi-case" }], [lockedPrev]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalAmount).toBe(500);
    const payload = portalItemInsertPayload("o1", r.items)[0];
    expect(payload.custom_case_id).toBe("case-1");
    expect(payload.custom_name).toBe("保養");
  });

  it("新訂單不可帶鎖定列", async () => {
    expect(await priceAndSnapshot([{ kind: "locked", source_item_id: "oi-case" }], [])).toEqual({
      ok: false,
      error: "bad_item",
    });
  });
});

describe("readPortalExplanationImages（製作圖）", () => {
  const base = "https://proj.supabase.co";
  const prevEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv;
  });
  const ok = `${base}/storage/v1/object/public/order-explanations/a.webp`;

  it("未送出欄位 → 不更動", () => {
    expect(readPortalExplanationImages(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("空陣列 → 清空（null）", () => {
    expect(readPortalExplanationImages([])).toEqual({ ok: true, value: null });
  });

  it("bucket 網址可寫入，標題會 trim", () => {
    const r = readPortalExplanationImages([{ url: ok, title: " 正面 " }]);
    expect(r).toEqual({ ok: true, value: JSON.stringify([{ url: ok, title: "正面" }]) });
  });

  it("外部網址 → bad_image；訂單原有的圖可原樣送回", () => {
    expect(readPortalExplanationImages([{ url: "https://evil.example/x.png" }])).toEqual({
      ok: false,
      error: "bad_image",
    });
    const legacy = "https://old.example/legacy.png";
    expect(readPortalExplanationImages([{ url: legacy }], new Set([legacy])).ok).toBe(true);
  });
});
