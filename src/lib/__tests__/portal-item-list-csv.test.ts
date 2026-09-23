import { describe, expect, it } from "vitest";
import {
  buildPortalItemListCsv,
  portalItemListChannelPrice,
  type PortalItemListVariant,
} from "@/lib/portal-item-list-csv";

function variant(p: Partial<PortalItemListVariant>): PortalItemListVariant {
  return {
    series_id: null,
    series_name: null,
    series_category: null,
    product_code: null,
    wood_type: null,
    spec1: null,
    dimension_w: null,
    dimension_d: null,
    dimension_h: null,
    seat_height_cm: null,
    arm_height_cm: null,
    base_price: null,
    ...p,
  };
}

const parse = (csv: string) =>
  csv.split("\n").map((line) => line.slice(1, -1).split('","'));

describe("portalItemListChannelPrice", () => {
  const pct = new Map([["s-chair", 30]]);

  it("折扣 % > 0：四捨五入後之通路價（與下單計價同公式）", () => {
    expect(portalItemListChannelPrice(variant({ series_id: "s-chair", base_price: 12345 }), pct)).toBe(
      Math.round(12345 * 0.7),
    );
  });

  it("無折扣：通路價等於牌價", () => {
    expect(portalItemListChannelPrice(variant({ series_id: "s-other", base_price: 8000 }), pct)).toBe(8000);
  });

  it("無牌價：通路價留空", () => {
    expect(portalItemListChannelPrice(variant({ series_id: "s-chair", base_price: null }), pct)).toBeNull();
  });
});

describe("buildPortalItemListCsv", () => {
  const pct = new Map([
    ["s-chair", 20],
    ["s-table", 0],
  ]);
  const rows = [
    variant({
      series_id: "s-table",
      series_name: "餐桌",
      series_category: "桌",
      product_code: "TB01",
      wood_type: "白橡",
      dimension_w: 180,
      dimension_d: 90,
      dimension_h: 74,
      base_price: 60000,
    }),
    variant({
      series_id: "s-chair",
      series_name: "扶手椅",
      series_category: "椅",
      product_code: "CH03-W-F",
      wood_type: "胡桃",
      spec1: '布墊 "灰"',
      dimension_w: 55.5,
      dimension_d: 52,
      dimension_h: 78,
      seat_height_cm: 45,
      arm_height_cm: 65,
      base_price: 18000,
    }),
  ];
  const lines = parse(buildPortalItemListCsv(rows, pct));

  it("表頭：代碼與尺寸分欄、含牌價與通路價", () => {
    expect(lines[0]).toEqual([
      "類別",
      "系列",
      "產品代碼",
      "木種",
      "規格",
      "W（cm）",
      "D（cm）",
      "H（cm）",
      "座高（cm）",
      "扶手高（cm）",
      "牌價",
      "通路價",
    ]);
  });

  it("依類別排序，每列欄位對齊，引號跳脫", () => {
    expect(lines).toHaveLength(3);
    // zh-Hant 依筆畫：桌（10 畫）排在椅（12 畫）之前，與 ERP 價目表排序一致
    expect(lines[1]).toEqual(["桌", "餐桌", "TB01", "白橡", "", "180", "90", "74", "", "", "60000", "60000"]);
    expect(lines[2]).toEqual([
      "椅",
      "扶手椅",
      "CH03-W-F",
      "胡桃",
      '布墊 ""灰""',
      "55.5",
      "52",
      "78",
      "45",
      "65",
      "18000",
      "14400",
    ]);
  });
});
