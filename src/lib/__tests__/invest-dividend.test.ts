import { describe, expect, it } from "vitest";
import { estimateDividend, findDividendSuggestions } from "@/lib/invest-dividend";
import type { InvestCorporateAction, InvestDividendEvent, InvestTrade } from "@/lib/invest-types";

describe("estimateDividend", () => {
  it("台股：元以下捨去，未達 2 萬不扣補充保費", () => {
    expect(estimateDividend({ market: "TW", shares: 3000, cashPerShare: 0.85 })).toEqual({
      grossAmount: 2550,
      nhiPremium: 0,
      withholdingTax: 0,
    });
    expect(estimateDividend({ market: "TW", shares: 1234, cashPerShare: 0.77 }).grossAmount).toBe(950);
  });

  it("台股：單筆達 2 萬扣 2.11% 補充保費（四捨五入到元）", () => {
    expect(estimateDividend({ market: "TW", shares: 96_000, cashPerShare: 1 })).toEqual({
      grossAmount: 96_000,
      nhiPremium: 2026,
      withholdingTax: 0,
    });
    expect(estimateDividend({ market: "TW", shares: 20_000, cashPerShare: 1 }).nhiPremium).toBe(422);
    expect(estimateDividend({ market: "TW", shares: 19_999, cashPerShare: 1 }).nhiPremium).toBe(0);
  });

  it("美股：算到美分，預扣 30%", () => {
    expect(estimateDividend({ market: "US", shares: 15, cashPerShare: 1.7835 })).toEqual({
      grossAmount: 26.75,
      nhiPremium: 0,
      withholdingTax: 8.03,
    });
  });
});

describe("findDividendSuggestions", () => {
  const accounts = [
    { id: "tw", market: "TW" as const },
    { id: "us", market: "US" as const },
  ];
  let seq = 0;
  const trade = (p: Partial<InvestTrade> & Pick<InvestTrade, "trade_date" | "side" | "quantity">): InvestTrade => ({
    id: `t${++seq}`,
    account_id: "tw",
    symbol: "0050",
    name: "元大台灣50",
    price: 0,
    amount: 0,
    fee: 0,
    tax: 0,
    net_amount: 100_000,
    currency: "TWD",
    order_no: null,
    dedupe_key: null,
    source: "import",
    note: null,
    ...p,
  });
  const trades = [
    trade({ trade_date: "2024-05-07", side: "buy", quantity: 1000 }),
    trade({ trade_date: "2024-05-13", side: "buy", quantity: 2000 }),
    trade({ trade_date: "2025-03-03", side: "buy", quantity: 2250 }),
    trade({ trade_date: "2025-01-02", side: "buy", quantity: 5, account_id: "us", symbol: "VOO", currency: "USD" }),
  ];
  const actions: InvestCorporateAction[] = [
    { id: "s", account_id: "tw", symbol: "0050", action_date: "2025-06-18", type: "split", ratio: 4, quantity: null, note: null },
  ];
  const event = (symbol: string, ex_date: string, cash: number | null, rights_type = "息"): InvestDividendEvent => ({
    symbol,
    ex_date,
    name: null,
    rights_type,
    cash_per_share: cash,
  });

  it("依除息日前持股（含拆股）算應收，只列還沒登錄的", () => {
    const result = findDividendSuggestions({
      events: [
        event("0050", "2025-01-17", 2.7),
        event("0050", "2025-07-21", 0.36),
        event("0050", "2024-07-16", 1),
        event("2330", "2025-03-18", 4.5),
        event("VOO", "2025-03-24", 1.8),
      ],
      accounts,
      trades,
      actions,
      dividends: [{ account_id: "tw", symbol: "0050", ex_date: "2024-07-16" }],
      today: "2025-08-01",
    });
    expect(result.map((s) => [s.symbol, s.exDate, s.shares, s.estimate?.grossAmount, s.likelyReceived])).toEqual([
      // 一拆四後 5250 × 4 = 21000 股；除息未滿 60 天 → 待入帳
      ["0050", "2025-07-21", 21_000, 7560, false],
      ["0050", "2025-01-17", 3000, 8100, true],
    ]);
  });

  it("除息日當天才買進的不列入", () => {
    const result = findDividendSuggestions({
      events: [event("0050", "2024-05-07", 1)],
      accounts,
      trades,
      actions,
      dividends: [],
      today: "2025-08-01",
    });
    expect(result).toEqual([]);
  });

  it("含配股（權息）時沒有每股現金股利，不試算", () => {
    const [s] = findDividendSuggestions({
      events: [event("0050", "2024-08-01", null, "權息")],
      accounts,
      trades,
      actions,
      dividends: [],
      today: "2025-08-01",
    });
    expect(s).toMatchObject({ rightsType: "權息", cashPerShare: null, estimate: null, shares: 3000 });
  });
});
