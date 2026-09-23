import { describe, expect, it } from "vitest";
import {
  computeExhibitionEffects,
  defaultCustomerSourceFor,
  isLikelyExhibitionPurchase,
  purchaseCandidateRange,
  purchaseCostAmount,
  type EffectOrderInput,
  type ExhibitionRow,
} from "@/lib/exhibitions";

const WOOD = "展覽(木質生活)";
const GOOD = "展覽(好感生活)";

function ex(id: string, name: string, start: string, end: string, source: string | null): ExhibitionRow {
  return { id, name, start_date: start, end_date: end, location: null, customer_source: source, notes: null };
}

const wood25 = ex("w25", "木質生活展", "2025-09-20", "2025-09-23", WOOD);
const wood26 = ex("w26", "木質生活展", "2026-09-12", "2026-09-15", WOOD);
const good26 = ex("g26", "好感空間展", "2026-07-02", "2026-07-05", GOOD);

function order(p: Partial<EffectOrderInput> & { id: string }): EffectOrderInput {
  return {
    order_date: null,
    customer_id: null,
    status: "生產中",
    total_amount: 0,
    shipping_fee: 0,
    tax_extra_amount: 0,
    ...p,
  };
}

describe("defaultCustomerSourceFor：展名對應客戶來源", () => {
  it("好感空間展、木質生活展各自對應；其他展不對應", () => {
    expect(defaultCustomerSourceFor("好感空間展")).toBe(GOOD);
    expect(defaultCustomerSourceFor("木質生活展")).toBe(WOOD);
    expect(defaultCustomerSourceFor("新一代設計展")).toBeNull();
  });
});

describe("computeExhibitionEffects：依客戶來源與下單日推算", () => {
  const customers = [
    { id: "walkin", source: WOOD, customer_type: "展覽" },
    { id: "met25", source: WOOD, customer_type: "一般民眾" },
    { id: "met26", source: WOOD, customer_type: "一般民眾" },
    { id: "good", source: GOOD, customer_type: "一般民眾" },
    { id: "web", source: "網路", customer_type: "一般民眾" },
  ];
  const orders = [
    // 2025 場：展期內現場成交、展後轉單
    order({ id: "o1", customer_id: "met25", order_date: "2025-09-21", total_amount: 80000 }),
    order({ id: "o2", customer_id: "met25", order_date: "2025-10-01", total_amount: 100000 }),
    // 2026 場開始後才下的單 → 歸 2026 場展後轉單（下一屆開始即切換）
    order({ id: "o3", customer_id: "met25", order_date: "2026-10-01", total_amount: 50000 }),
    // 2026 展期內：散客代表客戶
    order({ id: "o4", customer_id: "walkin", order_date: "2026-09-13", total_amount: 20000 }),
    // 散客代表客戶展後補登 → 仍算現場
    order({ id: "o5", customer_id: "walkin", order_date: "2026-09-18", total_amount: 10000 }),
    // 2026 展期內新客，運費不計
    order({ id: "o6", customer_id: "met26", order_date: "2026-09-14", total_amount: 31000, shipping_fee: 1000 }),
    // 2026 展後新客，外加稅不計
    order({ id: "o7", customer_id: "met26", order_date: "2026-09-30", total_amount: 105000, tax_extra_amount: 5000 }),
    // 報價中不計
    order({ id: "o8", customer_id: "met26", order_date: "2026-10-05", total_amount: 999999, status: "報價中" }),
    // 來源不是木質生活展：展期內下單也不算
    order({ id: "o9", customer_id: "web", order_date: "2026-09-13", total_amount: 30000 }),
    order({ id: "o10", customer_id: "good", order_date: "2026-09-13", total_amount: 30000 }),
    // 展覽開始前下的單不算
    order({ id: "o11", customer_id: "met26", order_date: "2026-09-01", total_amount: 7000, status: "已退貨" }),
  ];
  const costs = [
    { exhibition_id: "w26", amount: 60000 },
    { exhibition_id: "w26", amount: 40000 },
  ];
  const effects = computeExhibitionEffects([wood25, wood26, good26], costs, orders, customers);
  const e26 = effects.find((e) => e.exhibition.id === "w26")!;
  const e25 = effects.find((e) => e.exhibition.id === "w25")!;
  const g26 = effects.find((e) => e.exhibition.id === "g26")!;

  it("新到舊排序，統計到下一屆同展開始前", () => {
    expect(effects.map((e) => e.exhibition.id)).toEqual(["w26", "g26", "w25"]);
    expect(e25.windowEnd).toBe("2026-09-12");
    expect(e26.windowEnd).toBeNull();
    expect(g26.windowEnd).toBeNull();
  });

  it("現場成交＝展期內下單＋散客代表客戶（展後補登也算）", () => {
    expect(e26.onsiteOrders).toBe(3);
    expect(e26.onsiteWalkInOrders).toBe(2);
    expect(e26.onsiteRevenue).toBe(20000 + 10000 + 30000);
    expect(e25.onsiteOrders).toBe(1);
    expect(e25.onsiteRevenue).toBe(80000);
  });

  it("展後轉單＝展期結束後到下一屆開始前；排除報價中", () => {
    expect(e25.postShowOrders).toBe(1);
    expect(e25.postShowRevenue).toBe(100000);
    expect(e26.postShowOrders).toBe(2);
    expect(e26.postShowCustomers).toBe(2);
    expect(e26.postShowRevenue).toBe(50000 + 100000);
  });

  it("只算客戶來源相符的訂單", () => {
    expect(g26.onsiteOrders + g26.postShowOrders).toBe(1);
    expect(g26.postShowRevenue).toBe(30000);
  });

  it("新客只算首次成交在本屆之後的客人（不含散客代表客戶、前一屆的客人）", () => {
    expect(e26.newCustomers).toBe(1);
    expect(e25.newCustomers).toBe(1);
  });

  it("成本與效益指標", () => {
    expect(e26.cost).toBe(100000);
    expect(e26.totalRevenue).toBe(210000);
    expect(e26.revenuePerCost).toBeCloseTo(2.1);
    expect(e26.costPerNewCustomer).toBe(100000);
    expect(e25.revenuePerCost).toBeNull();
  });

  it("未對應客戶來源的場次不統計成交", () => {
    const [noSource] = computeExhibitionEffects([ex("x", "其他展", "2026-09-12", "2026-09-15", null)], [], orders, customers);
    expect(noSource.totalRevenue).toBe(0);
  });
});

describe("採購連結", () => {
  it("採購成本取未稅金額，舊資料沒有未稅時用 total_amount", () => {
    expect(purchaseCostAmount({ amount_ex_tax: 38095, total_amount: 40000 })).toBe(38095);
    expect(purchaseCostAmount({ amount_ex_tax: null, total_amount: 40000 })).toBe(40000);
  });

  it("候選期間＝展前 180 天～展後 60 天", () => {
    expect(purchaseCandidateRange("2026-07-02", "2026-07-05")).toEqual({ from: "2026-01-03", to: "2026-09-03" });
  });

  it("品名、廠商或採購單備註含展覽／攤位／佈置才排前面；廠商「展鋮」不算", () => {
    expect(isLikelyExhibitionPurchase({ item_name: "展覽費用", vendor_name: "佶士達", item_category: "其他" })).toBe(true);
    expect(isLikelyExhibitionPurchase({ item_name: "胡桃木", vendor_name: "展鋮", item_category: "木料_實木" })).toBe(false);
    expect(
      isLikelyExhibitionPurchase({ item_name: "木箱", vendor_name: "大榮", item_category: "物流", po_notes: "木質生活展運輸" }),
    ).toBe(true);
    expect(
      isLikelyExhibitionPurchase({ item_name: "木箱", vendor_name: "大榮", item_category: "物流", po_notes: "客戶出貨" }),
    ).toBe(false);
  });

  it("成本合計＝連結採購＋其他成本", () => {
    const [f] = computeExhibitionEffects(
      [good26],
      [{ exhibition_id: "g26", amount: 5000 }],
      [],
      [],
      [
        { exhibition_id: "g26", amount_ex_tax: 30000, total_amount: 30000 },
        { exhibition_id: "g26", amount_ex_tax: null, total_amount: 40000 },
        { exhibition_id: "w26", amount_ex_tax: 99999, total_amount: 99999 },
      ],
    );
    expect(f.purchaseCost).toBe(70000);
    expect(f.purchaseCount).toBe(2);
    expect(f.otherCost).toBe(5000);
    expect(f.cost).toBe(75000);
  });
});
