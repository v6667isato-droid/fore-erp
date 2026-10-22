import { describe, expect, it } from "vitest";
import { computePortfolio, holdingBefore, valuePosition } from "@/lib/invest-portfolio";
import type { InvestCorporateAction, InvestTrade } from "@/lib/invest-types";

let seq = 0;
function trade(partial: Partial<InvestTrade> & Pick<InvestTrade, "trade_date" | "side" | "quantity" | "net_amount">): InvestTrade {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc",
    symbol: "0050",
    name: "元大台灣50",
    price: 0,
    amount: 0,
    fee: 0,
    tax: 0,
    currency: "TWD",
    order_no: null,
    dedupe_key: null,
    source: "import",
    note: null,
    ...partial,
  };
}

function split(action_date: string, ratio: number): InvestCorporateAction {
  return { id: "s", account_id: "acc", symbol: "0050", action_date, type: "split", ratio, quantity: null, note: null };
}

describe("computePortfolio", () => {
  it("平均成本含買進手續費，賣出依平均成本算已實現損益", () => {
    const buy1 = trade({ trade_date: "2024-05-07", side: "buy", quantity: 1000, net_amount: 100_142 });
    const buy2 = trade({ trade_date: "2024-05-08", side: "buy", quantity: 1000, net_amount: 120_171 });
    const sell = trade({ trade_date: "2024-06-01", side: "sell", quantity: 500, net_amount: 64_800 });
    const { positions, realizedByTradeId, warnings } = computePortfolio([buy1, buy2, sell], []);

    expect(warnings).toEqual([]);
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.quantity).toBe(1500);
    // 平均成本 (100142 + 120171) / 2000 = 110.1565；賣 500 股成本 55078.25
    expect(p.avgCost).toBeCloseTo(110.1565, 6);
    expect(p.cost).toBeCloseTo(165_234.75, 4);
    expect(realizedByTradeId.get(sell.id)).toBeCloseTo(64_800 - 55_078.25, 4);
    expect(p.realizedPnl).toBeCloseTo(9_721.75, 4);
  });

  it("全部賣光後成本歸零，再買進重新起算", () => {
    const { positions } = computePortfolio(
      [
        trade({ trade_date: "2024-01-02", side: "buy", quantity: 3, net_amount: 1000 }),
        trade({ trade_date: "2024-01-03", side: "sell", quantity: 3, net_amount: 1200 }),
        trade({ trade_date: "2024-02-01", side: "buy", quantity: 10, net_amount: 500 }),
      ],
      []
    );
    expect(positions[0].quantity).toBe(10);
    expect(positions[0].cost).toBe(500);
    expect(positions[0].avgCost).toBe(50);
    expect(positions[0].realizedPnl).toBe(200);
  });

  it("漏記拆股時，賣超持股會產生警告；補上拆股後警告消失且總成本不變", () => {
    const trades = [
      trade({ trade_date: "2025-03-03", side: "buy", quantity: 5250, net_amount: 1_000_000 }),
      trade({ trade_date: "2025-08-12", side: "sell", quantity: 17_500, net_amount: 920_000 }),
    ];
    const missing = computePortfolio(trades, []);
    expect(missing.warnings).toEqual([{ accountId: "acc", symbol: "0050", date: "2025-08-12", shortBy: 12_250 }]);

    const fixed = computePortfolio(trades, [split("2025-06-18", 4)]);
    expect(fixed.warnings).toEqual([]);
    // 一拆四：5250 → 21000 股，平均成本 1,000,000 / 21000；賣 17500 後剩 3500
    expect(fixed.positions[0].quantity).toBe(3500);
    expect(fixed.positions[0].cost).toBeCloseTo((1_000_000 / 21_000) * 3500, 4);
  });

  it("拆股生效日當天的交易以新股數計", () => {
    const { warnings, positions } = computePortfolio(
      [
        trade({ trade_date: "2025-06-10", side: "buy", quantity: 100, net_amount: 18_000 }),
        trade({ trade_date: "2025-06-18", side: "sell", quantity: 400, net_amount: 19_000 }),
      ],
      [split("2025-06-18", 4)]
    );
    expect(warnings).toEqual([]);
    expect(positions[0].quantity).toBe(0);
    expect(positions[0].realizedPnl).toBe(1000);
  });

  it("配股增加股數但不增加成本", () => {
    const { positions } = computePortfolio(
      [trade({ trade_date: "2024-01-02", side: "buy", quantity: 1000, net_amount: 50_000 })],
      [{ account_id: "acc", symbol: "0050", action_date: "2024-07-01", type: "stock_dividend", ratio: null, quantity: 50 }]
    );
    expect(positions[0].quantity).toBe(1050);
    expect(positions[0].cost).toBe(50_000);
    expect(positions[0].avgCost).toBeCloseTo(47.619, 3);
  });

  it("同一天先買後賣（當沖）不誤判為持股不足", () => {
    const { warnings } = computePortfolio(
      [
        trade({ trade_date: "2024-01-02", side: "sell", quantity: 1000, net_amount: 51_000 }),
        trade({ trade_date: "2024-01-02", side: "buy", quantity: 1000, net_amount: 50_000 }),
      ],
      []
    );
    expect(warnings).toEqual([]);
  });

  it("不同帳戶、不同標的分開計算", () => {
    const { positions } = computePortfolio(
      [
        trade({ trade_date: "2024-01-02", side: "buy", quantity: 10, net_amount: 100 }),
        trade({ trade_date: "2024-01-02", side: "buy", quantity: 5, net_amount: 50, account_id: "us", symbol: "VOO", currency: "USD" }),
        trade({ trade_date: "2024-01-02", side: "buy", quantity: 1, net_amount: 900, symbol: "2330" }),
      ],
      []
    );
    expect(positions.map((p) => [p.accountId, p.symbol, p.quantity, p.currency])).toEqual([
      ["acc", "0050", 10, "TWD"],
      ["acc", "2330", 1, "TWD"],
      ["us", "VOO", 5, "USD"],
    ]);
  });
});

describe("holdingBefore", () => {
  const trades = [
    trade({ trade_date: "2025-06-10", side: "buy", quantity: 1000, net_amount: 180_000 }),
    trade({ trade_date: "2025-07-17", side: "buy", quantity: 2000, net_amount: 100_000 }),
    trade({ trade_date: "2025-07-18", side: "buy", quantity: 9999, net_amount: 500_000 }),
  ];
  const actions = [split("2025-06-18", 4)];

  it("只算除息日之前的交易（除息日當天買進沒有配息），並套用拆股", () => {
    expect(holdingBefore(trades, actions, "acc", "0050", "2025-07-18")).toBe(6000);
  });

  it("其他帳戶或標的不計入", () => {
    expect(holdingBefore(trades, actions, "other", "0050", "2025-07-18")).toBe(0);
    expect(holdingBefore(trades, actions, "acc", "2330", "2025-07-18")).toBe(0);
  });
});

describe("valuePosition", () => {
  it("市值、未實現損益、報酬率", () => {
    expect(valuePosition({ quantity: 1000, cost: 50_000 }, 60)).toEqual({
      marketValue: 60_000,
      unrealizedPnl: 10_000,
      returnRate: 0.2,
    });
  });

  it("沒有現價時回 null", () => {
    expect(valuePosition({ quantity: 1000, cost: 50_000 }, null)).toBeNull();
  });
});
