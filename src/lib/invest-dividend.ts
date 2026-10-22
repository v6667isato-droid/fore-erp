/** 現金股利試算（台股扣二代健保補充保費；美股扣 30% 預扣稅）與自動偵測未登錄的股利。 */
import { holdingBefore } from "@/lib/invest-portfolio";
import type {
  InvestAccount,
  InvestCorporateAction,
  InvestDividend,
  InvestDividendEvent,
  InvestMarket,
  InvestTrade,
} from "@/lib/invest-types";

/** 二代健保補充保費費率與單筆起扣門檻 */
export const TW_NHI_RATE = 0.0211;
export const TW_NHI_THRESHOLD = 20000;
/** 非美國稅務居民的美股股利預扣稅率 */
export const US_WITHHOLDING_RATE = 0.3;

export type DividendEstimate = {
  grossAmount: number;
  nhiPremium: number;
  withholdingTax: number;
};

/** 四捨五入到分；加一點容差，避免 26.75 × 0.3 = 8.02499… 被捨成 8.02 */
function round2(n: number): number {
  return Math.round(n * 100 + 1e-7) / 100;
}

/**
 * 依應收股利估算扣款。台股：單筆達 2 萬元扣 2.11% 補充保費（四捨五入到元）；
 * ETF 只有「股利所得」部分要扣補充保費，實際扣款以入帳為準，表單可再修改。
 * 美股：預扣 30% 稅（算到美分）。
 */
export function dividendDeductions(
  market: InvestMarket,
  grossAmount: number
): Pick<DividendEstimate, "nhiPremium" | "withholdingTax"> {
  if (market === "US") return { nhiPremium: 0, withholdingTax: round2(grossAmount * US_WITHHOLDING_RATE) };
  return { nhiPremium: grossAmount >= TW_NHI_THRESHOLD ? Math.round(grossAmount * TW_NHI_RATE) : 0, withholdingTax: 0 };
}

/** 台股股利發放到元、元以下捨去；美股算到美分 */
export function estimateDividend({
  market,
  shares,
  cashPerShare,
}: {
  market: InvestMarket;
  shares: number;
  cashPerShare: number;
}): DividendEstimate {
  const raw = Math.max(shares, 0) * Math.max(cashPerShare, 0);
  // 台股加一點容差，避免 3000 × 0.85 = 2549.9999… 被捨去成 2549
  const grossAmount = market === "US" ? round2(raw) : Math.floor(raw + 1e-6);
  return { grossAmount, ...dividendDeductions(market, grossAmount) };
}

/** 除息日超過這個天數的股利，視為已經發放入帳（台股約一個月後發放、美股通常一週內） */
export const LIKELY_RECEIVED_AFTER_DAYS: Record<InvestMarket, number> = { TW: 60, US: 14 };

export type DividendSuggestion = {
  accountId: string;
  market: InvestMarket;
  symbol: string;
  name: string | null;
  exDate: string;
  rightsType: string;
  /** 含配股（權、權息）時為 null，需手動輸入每股現金股利 */
  cashPerShare: number | null;
  /** 除息日前一天的持股 */
  shares: number;
  estimate: DividendEstimate | null;
  /** 除息日已超過該市場的 LIKELY_RECEIVED_AFTER_DAYS 天，加入時直接記為已入帳 */
  likelyReceived: boolean;
};

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 依除權息結果比對自己的持股，找出除息日前有持股、但還沒登錄的股利。
 * 只比對同市場的帳戶（台股帳戶看證交所資料、美股帳戶看美股資料），試算依帳戶市場扣補充保費或預扣稅。
 * 已登錄判斷：同帳戶、同代號、同除息日已有 invest_dividends 紀錄。
 */
export function findDividendSuggestions({
  events,
  accounts,
  trades,
  actions,
  dividends,
  today,
}: {
  events: InvestDividendEvent[];
  accounts: Pick<InvestAccount, "id" | "market">[];
  trades: InvestTrade[];
  actions: InvestCorporateAction[];
  dividends: Pick<InvestDividend, "account_id" | "symbol" | "ex_date">[];
  /** YYYY-MM-DD */
  today: string;
}): DividendSuggestion[] {
  const recorded = new Set(dividends.map((d) => `${d.account_id}|${d.symbol}|${d.ex_date}`));
  const marketByAccount = new Map(accounts.map((a) => [a.id, a.market]));
  // 每個帳戶交易過哪些代號，避免對沒碰過的股票做持股計算
  const tradedSymbols = new Map<string, Set<string>>();
  for (const t of trades) {
    if (!marketByAccount.has(t.account_id)) continue;
    let set = tradedSymbols.get(t.account_id);
    if (!set) {
      set = new Set();
      tradedSymbols.set(t.account_id, set);
    }
    set.add(t.symbol);
  }
  const receivedBefore: Record<InvestMarket, string> = {
    TW: addDays(today, -LIKELY_RECEIVED_AFTER_DAYS.TW),
    US: addDays(today, -LIKELY_RECEIVED_AFTER_DAYS.US),
  };

  const suggestions: DividendSuggestion[] = [];
  for (const e of events) {
    for (const [accountId, symbols] of tradedSymbols) {
      const market = marketByAccount.get(accountId)!;
      if (market !== e.market || !symbols.has(e.symbol)) continue;
      if (recorded.has(`${accountId}|${e.symbol}|${e.ex_date}`)) continue;
      const shares = holdingBefore(trades, actions, accountId, e.symbol, e.ex_date);
      if (shares <= 0) continue;
      suggestions.push({
        accountId,
        market,
        symbol: e.symbol,
        name: e.name,
        exDate: e.ex_date,
        rightsType: e.rights_type,
        cashPerShare: e.cash_per_share,
        shares,
        estimate: e.cash_per_share == null ? null : estimateDividend({ market, shares, cashPerShare: e.cash_per_share }),
        likelyReceived: e.ex_date <= receivedBefore[market],
      });
    }
  }
  suggestions.sort((a, b) => (a.exDate !== b.exDate ? (a.exDate < b.exDate ? 1 : -1) : a.symbol < b.symbol ? -1 : 1));
  return suggestions;
}
