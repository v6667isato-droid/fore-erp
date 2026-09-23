import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pricePortalItems } from "@/lib/portal-api";

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
