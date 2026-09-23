import { describe, expect, it } from "vitest";
import {
  computeExhibitionEffects,
  defaultCustomerSourceFor,
  exhibitionOptionsFor,
  suggestExhibitionId,
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
const all = [wood25, wood26, good26];

function order(p: Partial<EffectOrderInput> & { id: string }): EffectOrderInput {
  return {
    order_date: null,
    customer_id: null,
    exhibition_id: null,
    status: "生產中",
    total_amount: 0,
    shipping_fee: 0,
    tax_extra_amount: 0,
    ...p,
  };
}

describe("suggestExhibitionId：開單自動帶入場次", () => {
  it("客戶來源是該展且下單日在展期內 → 帶入", () => {
    expect(suggestExhibitionId(all, { source: WOOD }, "2026-09-13")).toBe("w26");
  });

  it("展期外、或客戶來源不是展覽 → 不帶入", () => {
    expect(suggestExhibitionId(all, { source: WOOD }, "2026-09-20")).toBeNull();
    expect(suggestExhibitionId(all, { source: "網路" }, "2026-09-13")).toBeNull();
    expect(suggestExhibitionId(all, null, "2026-09-13")).toBeNull();
  });

  it("散客代表客戶：展後 14 天內補登仍帶入，超過則不帶", () => {
    const walkIn = { source: GOOD, customer_type: "展覽" };
    expect(suggestExhibitionId(all, walkIn, "2026-07-19")).toBe("g26");
    expect(suggestExhibitionId(all, walkIn, "2026-07-20")).toBeNull();
  });
});

describe("defaultCustomerSourceFor：展名對應客戶來源", () => {
  it("好感空間展、木質生活展各自對應；其他展不對應", () => {
    expect(defaultCustomerSourceFor("好感空間展")).toBe(GOOD);
    expect(defaultCustomerSourceFor("木質生活展")).toBe(WOOD);
    expect(defaultCustomerSourceFor("新一代設計展")).toBeNull();
  });
});

describe("exhibitionOptionsFor：開單下拉只列前後一年", () => {
  it("過濾太舊的場次，但保留已選的場次", () => {
    const opts = exhibitionOptionsFor(all, "2027-06-01", "");
    expect(opts.map((e) => e.id)).toEqual(["w26", "g26"]);
    expect(exhibitionOptionsFor(all, "2027-06-01", "w25").map((e) => e.id)).toContain("w25");
  });
});

describe("computeExhibitionEffects：展覽效益", () => {
  const customers = [
    { id: "walkin", source: WOOD, customer_type: "展覽" },
    { id: "met25", source: WOOD, customer_type: "一般民眾" },
    { id: "met26", source: WOOD, customer_type: "一般民眾" },
    { id: "web", source: "網路", customer_type: "一般民眾" },
  ];
  const orders = [
    // 2025 場認識的客人：展後轉單歸 2025 場
    order({ id: "o1", customer_id: "met25", order_date: "2025-10-01", total_amount: 100000 }),
    // 2026 場開始後才下的單 → 歸 2026 場（下一屆開始即切換）
    order({ id: "o2", customer_id: "met25", order_date: "2026-10-01", total_amount: 50000 }),
    // 2026 現場：散客、老客人（網路來源）在攤位下單
    order({ id: "o3", customer_id: "walkin", exhibition_id: "w26", order_date: "2026-09-13", total_amount: 20000 }),
    order({ id: "o4", customer_id: "web", exhibition_id: "w26", order_date: "2026-09-13", total_amount: 30000, shipping_fee: 1000 }),
    // 2026 場認識的新客
    order({ id: "o5", customer_id: "met26", order_date: "2026-09-30", total_amount: 105000, tax_extra_amount: 5000 }),
    // 報價中不計
    order({ id: "o6", customer_id: "met26", order_date: "2026-10-05", total_amount: 999999, status: "報價中" }),
    // 網路客人早就買過，不算新客
    order({ id: "o7", customer_id: "web", order_date: "2025-01-01", total_amount: 10000 }),
  ];
  const costs = [
    { exhibition_id: "w26", amount: 60000 },
    { exhibition_id: "w26", amount: 40000 },
  ];
  const effects = computeExhibitionEffects([wood25, wood26], costs, orders, customers);
  const e26 = effects.find((e) => e.exhibition.id === "w26")!;
  const e25 = effects.find((e) => e.exhibition.id === "w25")!;

  it("新到舊排序，展後轉單統計到下一屆開始前", () => {
    expect(effects.map((e) => e.exhibition.id)).toEqual(["w26", "w25"]);
    expect(e25.windowEnd).toBe("2026-09-12");
    expect(e26.windowEnd).toBeNull();
  });

  it("現場成交含散客與老客人，營收扣除運費與外加稅", () => {
    expect(e26.onsiteOrders).toBe(2);
    expect(e26.onsiteWalkInOrders).toBe(1);
    expect(e26.onsiteRevenue).toBe(20000 + 29000);
  });

  it("展後轉單：來源相符、未標記、在區間內；排除報價中", () => {
    expect(e25.postShowOrders).toBe(1);
    expect(e25.postShowRevenue).toBe(100000);
    expect(e26.postShowOrders).toBe(2);
    expect(e26.postShowCustomers).toBe(2);
    expect(e26.postShowRevenue).toBe(50000 + 100000);
  });

  it("新客只算首次成交在本屆之後的客人（不含散客代表客戶、老客人）", () => {
    expect(e26.newCustomers).toBe(1);
    expect(e25.newCustomers).toBe(1);
  });

  it("成本與效益指標", () => {
    expect(e26.cost).toBe(100000);
    expect(e26.totalRevenue).toBe(199000);
    expect(e26.revenuePerCost).toBeCloseTo(1.99);
    expect(e26.costPerNewCustomer).toBe(100000);
    expect(e25.revenuePerCost).toBeNull();
  });
});
