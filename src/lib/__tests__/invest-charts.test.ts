import { describe, expect, it } from "vitest";
import {
  buildAllocation,
  buildValueSeries,
  dividendBuckets,
  formatTwdShort,
  monthEnds,
  monthRange,
  niceScale,
  priceAsOf,
  rangeMonthFrom,
  rangeStart,
  realizedByYear,
  timeTicks,
  yearlySummary,
  type PriceSeries,
} from "@/lib/invest-charts";
import type { InvestCorporateAction, InvestTrade } from "@/lib/invest-types";

let seq = 0;
function trade(partial: Partial<InvestTrade> & Pick<InvestTrade, "trade_date" | "side" | "quantity" | "net_amount">): InvestTrade {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "tw",
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

function series(points: Record<string, number>): PriceSeries {
  const dates = Object.keys(points).sort();
  return { dates, closes: dates.map((d) => points[d]) };
}

describe("priceAsOf", () => {
  const s = series({ "2025-01-02": 10, "2025-01-03": 11, "2025-01-06": 12 });
  it("取當天或之前最近一筆收盤價", () => {
    expect(priceAsOf(s, "2025-01-03")).toBe(11);
    expect(priceAsOf(s, "2025-01-05")).toBe(11);
    expect(priceAsOf(s, "2025-02-01")).toBe(12);
  });
  it("早於第一筆或沒有資料時回 null", () => {
    expect(priceAsOf(s, "2025-01-01")).toBeNull();
    expect(priceAsOf(undefined, "2025-01-01")).toBeNull();
  });
});

describe("buildValueSeries", () => {
  it("每個交易日依當時持股與收盤價算市值，持股成本跟著交易變動", () => {
    const trades = [
      trade({ trade_date: "2025-01-02", side: "buy", quantity: 1000, net_amount: 10_000 }),
      trade({ trade_date: "2025-01-06", side: "sell", quantity: 500, net_amount: 6_000 }),
    ];
    const points = buildValueSeries({
      trades,
      actions: [],
      prices: new Map([["0050", series({ "2024-12-31": 9, "2025-01-02": 10, "2025-01-03": 11, "2025-01-06": 12 })]]),
      today: "2025-01-10",
    });
    expect(points).toEqual([
      { date: "2025-01-02", marketValue: 10_000, cost: 10_000, unpriced: 0 },
      { date: "2025-01-03", marketValue: 11_000, cost: 10_000, unpriced: 0 },
      { date: "2025-01-06", marketValue: 6_000, cost: 5_000, unpriced: 0 },
    ]);
  });

  it("拆股前的價格乘回拆股比例（Yahoo 收盤價已依拆股調整），拆股當天市值不會跳動", () => {
    const trades = [trade({ trade_date: "2025-06-16", side: "buy", quantity: 1000, net_amount: 190_000 })];
    const actions: InvestCorporateAction[] = [
      { id: "s", account_id: "tw", symbol: "0050", action_date: "2025-06-18", type: "split", ratio: 4, quantity: null, note: null },
    ];
    // 調整後價格：拆股前 190 / 4 = 47.5
    const points = buildValueSeries({
      trades,
      actions,
      prices: new Map([["0050", series({ "2025-06-16": 47.5, "2025-06-17": 48, "2025-06-18": 48.5 })]]),
      today: "2025-06-30",
    });
    expect(points.map((p) => p.marketValue)).toEqual([190_000, 192_000, 194_000]);
  });

  it("篩選帳戶時用 splitActions 換算拆股前價格", () => {
    const trades = [trade({ trade_date: "2025-06-16", side: "buy", quantity: 1000, net_amount: 190_000 })];
    const points = buildValueSeries({
      trades,
      actions: [],
      splitActions: [{ symbol: "0050", action_date: "2025-06-18", type: "split", ratio: 4 }],
      prices: new Map([["0050", series({ "2025-06-16": 47.5 })]]),
      today: "2025-06-16",
    });
    expect(points[0].marketValue).toBe(190_000);
  });

  it("美股依當天匯率換算台幣，當天沒有匯率時沿用前一天", () => {
    const trades = [
      trade({ account_id: "us", symbol: "VOO", currency: "USD", trade_date: "2025-01-02", side: "buy", quantity: 2, net_amount: 1_000 }),
    ];
    const points = buildValueSeries({
      trades,
      actions: [],
      prices: new Map([["VOO", series({ "2025-01-02": 500, "2025-01-03": 510 })]]),
      usdTwd: series({ "2025-01-02": 32 }),
      today: "2025-01-03",
    });
    expect(points).toEqual([
      { date: "2025-01-02", marketValue: 32_000, cost: 32_000, unpriced: 0 },
      { date: "2025-01-03", marketValue: 32_640, cost: 32_000, unpriced: 0 },
    ]);
  });

  it("沒有歷史價格的持股以成本計並記錄檔數；沒有匯率的美股不列入", () => {
    const trades = [
      trade({ trade_date: "2025-01-02", side: "buy", quantity: 1000, net_amount: 10_000 }),
      trade({ symbol: "2330", trade_date: "2025-01-02", side: "buy", quantity: 10, net_amount: 6_000 }),
      trade({ account_id: "us", symbol: "VOO", currency: "USD", trade_date: "2025-01-02", side: "buy", quantity: 1, net_amount: 500 }),
    ];
    const points = buildValueSeries({
      trades,
      actions: [],
      prices: new Map([["0050", series({ "2025-01-02": 11 })]]),
      today: "2025-01-02",
    });
    expect(points).toEqual([{ date: "2025-01-02", marketValue: 17_000, cost: 16_000, unpriced: 2 }]);
  });

  it("只取第一筆交易起、today 以前的日期", () => {
    const trades = [trade({ trade_date: "2025-01-03", side: "buy", quantity: 1, net_amount: 10 })];
    const points = buildValueSeries({
      trades,
      actions: [],
      prices: new Map([["0050", series({ "2025-01-02": 10, "2025-01-03": 10, "2025-01-06": 10 })]]),
      today: "2025-01-05",
    });
    expect(points.map((p) => p.date)).toEqual(["2025-01-03"]);
    expect(buildValueSeries({ trades: [], actions: [], prices: new Map(), today: "2025-01-05" })).toEqual([]);
  });
});

describe("rangeStart / monthRange / monthEnds", () => {
  it("期間起日", () => {
    expect(rangeStart("3m", "2026-10-22")).toBe("2026-07-22");
    expect(rangeStart("1y", "2026-10-22")).toBe("2025-10-22");
    expect(rangeStart("all", "2026-10-22")).toBeNull();
  });
  it("月份圖起始月份：含本月共 N 個月，不早於第一個月", () => {
    expect(rangeMonthFrom("3m", "2026-10-22", "2024-05")).toBe("2026-08");
    expect(rangeMonthFrom("1y", "2026-01-05", "2024-05")).toBe("2025-02");
    expect(rangeMonthFrom("1y", "2024-08-01", "2024-05")).toBe("2024-05");
    expect(rangeMonthFrom("all", "2026-10-22", "2024-05")).toBe("2024-05");
  });
  it("跨年的月份清單", () => {
    expect(monthRange("2024-11", "2025-02")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });
  it("每月最後一個資料點", () => {
    const p = (date: string) => ({ date, marketValue: 0, cost: 0, unpriced: 0 });
    expect(monthEnds([p("2025-01-02"), p("2025-01-31"), p("2025-02-03")]).map((x) => x.date)).toEqual([
      "2025-01-31",
      "2025-02-03",
    ]);
  });
});

describe("timeTicks", () => {
  const dates = monthRange("2024-05", "2026-10").flatMap((m) => [`${m}-02`, `${m}-15`]);
  it("數量放不下時改每季、半年一格，並對齊 1／4／7／10 月", () => {
    const ticks = timeTicks(dates, 12);
    expect(ticks.map((t) => t.label)).toEqual([
      "2024/07",
      "2024/10",
      "2025/01",
      "2025/04",
      "2025/07",
      "2025/10",
      "2026/01",
      "2026/04",
      "2026/07",
      "2026/10",
    ]);
    expect(dates[ticks[0].index]).toBe("2024-07-02");
    expect(timeTicks(dates, 6, true).map((t) => t.label)).toEqual(["24/07", "25/01", "25/07", "26/01", "26/07"]);
  });
  it("期間從月中開始時不把第一個點當月份刻度；不到一個月標頭尾日期", () => {
    expect(timeTicks(["2025-01-15", "2025-02-03", "2025-03-03"], 6).map((t) => t.label)).toEqual(["2025/02", "2025/03"]);
    expect(timeTicks(["2025-01-15", "2025-01-20"], 6).map((t) => t.label)).toEqual(["01/15", "01/20"]);
  });
});

describe("dividendBuckets", () => {
  const marketByAccount = new Map([
    ["tw", "TW" as const],
    ["us", "US" as const],
  ]);
  const dividends = [
    { account_id: "tw", ex_date: "2025-01-17", currency: "TWD", net_amount: 8_100, received_at: "2025-02-14" },
    { account_id: "us", ex_date: "2025-03-24", currency: "USD", net_amount: 10, received_at: "2025-03-24" },
    { account_id: "tw", ex_date: "2025-03-18", currency: "TWD", net_amount: 5_000, received_at: null },
  ];
  it("依除息月份加總已入帳股利，美股依除息日匯率換算，沒有股利的月份補 0", () => {
    expect(
      dividendBuckets({
        dividends,
        marketByAccount,
        usdTwd: series({ "2025-03-21": 33 }),
        granularity: "month",
        from: "2024-12",
        to: "2025-03",
      })
    ).toEqual([
      { key: "2024-12", tw: 0, us: 0 },
      { key: "2025-01", tw: 8_100, us: 0 },
      { key: "2025-02", tw: 0, us: 0 },
      { key: "2025-03", tw: 0, us: 330 },
    ]);
  });
  it("年度加總；沒有歷史匯率時用目前匯率", () => {
    expect(
      dividendBuckets({ dividends, marketByAccount, fallbackUsdTwd: 30, granularity: "year", from: "2024-05", to: "2025-10" })
    ).toEqual([
      { key: "2024", tw: 0, us: 0 },
      { key: "2025", tw: 8_100, us: 300 },
    ]);
  });
});

describe("realizedByYear / yearlySummary", () => {
  it("已實現損益依賣出年度加總，美股依賣出日匯率", () => {
    const trades = [
      { id: "a", trade_date: "2024-12-30", currency: "TWD" },
      { id: "b", trade_date: "2025-03-03", currency: "TWD" },
      { id: "c", trade_date: "2025-06-02", currency: "USD" },
      { id: "d", trade_date: "2025-06-03", currency: "TWD" },
    ];
    const realized = realizedByYear({
      trades,
      realizedByTradeId: new Map([
        ["a", -3_319],
        ["b", 200_000],
        ["c", 100],
      ]),
      usdTwd: series({ "2025-06-02": 30 }),
    });
    expect([...realized]).toEqual([
      ["2024", -3_319],
      ["2025", 203_000],
    ]);

    const summary = yearlySummary(
      [
        { key: "2024", tw: 31_048, us: 0 },
        { key: "2025", tw: 44_377, us: 5_943 },
        { key: "2026", tw: 0, us: 0 },
      ],
      realized
    );
    expect(summary.rows).toEqual([
      { year: "2024", dividendsTw: 31_048, dividendsUs: 0, realized: -3_319, total: 27_729 },
      { year: "2025", dividendsTw: 44_377, dividendsUs: 5_943, realized: 203_000, total: 253_320 },
    ]);
    expect(summary.total).toEqual({
      year: "合計",
      dividendsTw: 75_425,
      dividendsUs: 5_943,
      realized: 199_681,
      total: 281_049,
    });
  });
});

describe("buildAllocation", () => {
  const marketByAccount = new Map([
    ["tw", "TW" as const],
    ["us", "US" as const],
  ]);
  const pos = (accountId: string, symbol: string, quantity: number, currency = "TWD") => ({
    accountId,
    symbol,
    name: symbol,
    currency,
    quantity,
  });

  it("依市場與個股換算台幣市值，同一檔多個帳戶合併，前幾名以外合併為其他", () => {
    const a = buildAllocation({
      positions: [
        pos("tw", "0050", 1000),
        pos("tw2", "0050", 1000),
        pos("tw", "2330", 10),
        pos("us", "VOO", 2, "USD"),
        pos("us", "QQQ", 1, "USD"),
        pos("us", "BND", 1, "USD"),
        pos("tw", "9914", 0),
        pos("tw", "XXXX", 10),
      ],
      priceBySymbol: new Map([
        ["0050", 100],
        ["2330", 1_000],
        ["VOO", 500],
        ["QQQ", 400],
        ["BND", 70],
      ]),
      marketByAccount: new Map([...marketByAccount, ["tw2", "TW" as const]]),
      usdTwd: 30,
      top: 3,
    });
    expect(a.total).toBe(200_000 + 10_000 + 30_000 + 12_000 + 2_100);
    expect(a.byMarket.map((m) => [m.market, m.value])).toEqual([
      ["TW", 210_000],
      ["US", 44_100],
    ]);
    expect(a.items.map((i) => [i.symbol, i.value])).toEqual([
      ["0050", 200_000],
      ["VOO", 30_000],
      ["QQQ", 12_000],
    ]);
    expect(a.others).toEqual({ symbols: ["2330", "BND"], value: 12_100, share: 12_100 / a.total });
    expect(a.unpriced).toBe(1);
  });

  it("只多出一檔時直接列出，不合併成其他", () => {
    const a = buildAllocation({
      positions: [pos("tw", "0050", 1), pos("tw", "2330", 1)],
      priceBySymbol: new Map([
        ["0050", 100],
        ["2330", 1_000],
      ]),
      marketByAccount,
      usdTwd: null,
      top: 1,
    });
    expect(a.items.map((i) => i.symbol)).toEqual(["2330", "0050"]);
    expect(a.others).toBeNull();
  });
});

describe("niceScale / formatTwdShort", () => {
  it("刻度包含 0 並取整齊間距", () => {
    expect(niceScale(0, 12_144_000)).toEqual({ min: 0, max: 15_000_000, ticks: [0, 5_000_000, 10_000_000, 15_000_000] });
    expect(niceScale(-3_319, 273_671).ticks).toEqual([-100_000, 0, 100_000, 200_000, 300_000]);
    expect(niceScale(0, 0)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });
  it("萬、億縮寫", () => {
    expect(formatTwdShort(12_144_000)).toBe("1,214.4萬");
    expect(formatTwdShort(-3_319)).toBe("−3,319");
    expect(formatTwdShort(250_000_000)).toBe("2.5億");
  });
});
