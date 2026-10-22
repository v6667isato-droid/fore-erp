/** 現金股利試算（台股扣二代健保補充保費；美股扣 30% 預扣稅）。 */
import type { InvestMarket } from "@/lib/invest-types";

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
