import { describe, expect, it } from "vitest";
import type { IntakeOrderItem } from "@/lib/customer-intake";
import { matchIntakeItem, type MatchableVariant } from "@/lib/intake-variant-match";

function v(
  id: string,
  seriesId: string,
  seriesName: string,
  code: string,
  opts: Partial<MatchableVariant> = {}
): MatchableVariant {
  return { id, series_id: seriesId, series_name: seriesName, product_code: code, label: code, ...opts };
}

const CB05 = "CB05 電視櫃/邊櫃 Flow";
const CH03 = "CH03 扶手椅";
const CH03A = "CH03-A 餐椅";
const ST01 = "ST01 高腳椅 Sushi An";

// 取材自實際規格庫的命名方式
const variants: MatchableVariant[] = [
  v("cb05-c", "s-cb05", CB05, "CB05-C", { spec1: "訂製款", is_custom_order: true }),
  v("cb05-o-150", "s-cb05", CB05, "CB05-O-150H90", { wood_type: "白橡木", dimension_w: 150, dimension_d: 45, dimension_h: 90 }),
  v("cb05-w-150", "s-cb05", CB05, "CB05-W-150H90", { wood_type: "胡桃木", dimension_w: 150, dimension_d: 45, dimension_h: 90 }),
  v("cb05-w-160", "s-cb05", CB05, "CB05-W-160", { wood_type: "胡桃木", dimension_w: 160, dimension_d: 42, dimension_h: 45 }),
  v("cb05-w-180", "s-cb05", CB05, "CB05-W-180", { wood_type: "胡桃木", dimension_w: 180, dimension_d: 42, dimension_h: 45 }),
  v("cb05-so", "s-cb05", CB05, "CB05-SO-層留", { wood_type: "煙燻白橡木", dimension_w: 105, dimension_d: 50, dimension_h: 130 }),
  v("ch03-c", "s-ch03", CH03, "CH03-C", { spec1: "訂製款", is_custom_order: true }),
  v("ch03-w-w", "s-ch03", CH03, "CH03-W-W", { wood_type: "胡桃木", spec1: "實木-W" }),
  v("ch03a-w-f", "s-ch03a", CH03A, "CH03A-W-F", { wood_type: "胡桃木", spec1: "布墊-F" }),
  v("ch03a-w-r", "s-ch03a", CH03A, "CH03A-W-R", { wood_type: "胡桃木", spec1: "藤編-R" }),
  v("st01-c", "s-st01", ST01, "ST01-C", { spec1: "訂製款", is_custom_order: true }),
  v("st01-p", "s-st01", ST01, "ST01-W-P-有靠背", { wood_type: "胡桃木", spec1: "紙繩-P" }),
  v("board-o", "s-board", "大板桌", "大板桌-O-W180D85", { wood_type: "白橡木", dimension_w: 180, dimension_d: 85, dimension_h: 75 }),
  v("old", "s-cb05", CB05, "CB05-OLD", { wood_type: "柚木", is_deleted: true }),
];

function item(partial: Partial<IntakeOrderItem>): IntakeOrderItem {
  return {
    name: "品項",
    product_code: null,
    custom_made: false,
    category: null,
    quantity: 1,
    unit_price: null,
    wood_type: null,
    dimension_w: null,
    dimension_d: null,
    dimension_h: null,
    seat_height_cm: null,
    notes: null,
    ...partial,
  };
}

function matchedId(it: IntakeOrderItem): string | null {
  const m = matchIntakeItem(it, variants);
  if (!m) return null;
  return m.kind === "variant" ? m.variant.id : `series:${m.series_id}`;
}

describe("matchIntakeItem", () => {
  it("訂製款：編號＋訂製 → 系列的訂製款規格", () => {
    const m = matchIntakeItem(
      item({ name: "CB05 訂製款", product_code: "CB05", custom_made: true, wood_type: "胡桃木", dimension_w: 90 }),
      variants
    );
    expect(m).toMatchObject({ kind: "variant", customOrder: true });
    expect(m?.kind === "variant" && m.variant.id).toBe("cb05-c");
  });

  it("完整產品編號直接對到規格", () => {
    expect(matchedId(item({ product_code: "CB05-W-150H90" }))).toBe("cb05-w-150");
    expect(matchedId(item({ product_code: "cb05 w 150h90" }))).toBe("cb05-w-150");
    expect(matchedId(item({ product_code: "CB05-C" }))).toBe("cb05-c");
  });

  it("系列編號＋木種＋尺寸 → 唯一的現成規格", () => {
    expect(matchedId(item({ product_code: "CB05", wood_type: "胡桃木", dimension_w: 180 }))).toBe("cb05-w-180");
    expect(matchedId(item({ product_code: "CB05", wood_type: "胡桃", dimension_w: 150, dimension_h: 90 }))).toBe(
      "cb05-w-150"
    );
    // 「橡木」＝白橡木，不含煙燻白橡木
    expect(matchedId(item({ product_code: "CB05", wood_type: "橡木" }))).toBe("cb05-o-150");
  });

  it("有指定木種／尺寸但沒有現成規格 → 訂製款", () => {
    expect(matchedId(item({ product_code: "CB05", wood_type: "胡桃木", dimension_w: 90, dimension_d: 45 }))).toBe(
      "cb05-c"
    );
    expect(matchedId(item({ product_code: "CB05", wood_type: "柚木" }))).toBe("cb05-c");
  });

  it("規格有多個可能 → 只帶系列，由使用者挑", () => {
    expect(matchedId(item({ product_code: "CB05" }))).toBe("series:s-cb05");
    expect(matchedId(item({ product_code: "CB05", wood_type: "胡桃木" }))).toBe("series:s-cb05");
  });

  it("規格說明出現在訊息中可分辨同木種的規格", () => {
    expect(matchedId(item({ name: "CH03-A 餐椅 藤編", wood_type: "胡桃木" }))).toBe("ch03a-w-r");
    expect(matchedId(item({ name: "CH03A 餐椅", notes: "布墊", wood_type: "胡桃木" }))).toBe("ch03a-w-f");
  });

  it("系列編號取最長前綴：CH03-A 不會對到 CH03", () => {
    expect(matchedId(item({ product_code: "CH03-A", custom_made: true }))).toBe("series:s-ch03a");
    expect(matchedId(item({ product_code: "CH03", custom_made: true }))).toBe("ch03-c");
  });

  it("品名裡的編號也能比對（AI 沒填 product_code）", () => {
    expect(matchedId(item({ name: "CB05訂製款", custom_made: true }))).toBe("cb05-c");
  });

  it("以系列英文名或沒有編號的系列名稱比對", () => {
    expect(matchedId(item({ name: "Flow 電視櫃", wood_type: "胡桃木", dimension_w: 160 }))).toBe("cb05-w-160");
    expect(matchedId(item({ name: "sushi an 高腳椅", custom_made: true }))).toBe("st01-c");
    expect(matchedId(item({ name: "大板桌", wood_type: "白橡木" }))).toBe("board-o");
  });

  it("對不到系列回傳 null（改用客製家具）", () => {
    expect(matchIntakeItem(item({ name: "胡桃木餐桌", wood_type: "胡桃木" }), variants)).toBeNull();
    expect(matchIntakeItem(item({ name: "XY99 櫃子", product_code: "XY99" }), variants)).toBeNull();
  });

  it("已刪除的規格不參與比對", () => {
    expect(matchIntakeItem(item({ product_code: "CB05-OLD" }), variants)).toMatchObject({ kind: "series" });
  });
});
