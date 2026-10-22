import { describe, expect, it } from "vitest";
import { estimateDividend } from "@/lib/invest-dividend";

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
