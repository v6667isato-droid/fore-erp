/** 台灣進項／採購常用營業稅率 5%（固定，不另存欄位） */
export const TW_PURCHASE_VAT_RATE = 0.05;
export const TW_PURCHASE_VAT_MULTIPLIER = 1 + TW_PURCHASE_VAT_RATE;

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 含稅金額換算未稅（訂單金額、售價一律為含稅價） */
export function toExTaxAmount(taxIncludedAmount: number): number {
  const n = Number(taxIncludedAmount);
  if (!Number.isFinite(n)) return 0;
  return n / TW_PURCHASE_VAT_MULTIPLIER;
}

/** 進項稅可扣抵比例預設 0：保守視同全部不可扣抵，材料以含稅認列成本 */
export const DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO = 0;

export function clampDeductibleRatio(ratio: number | null | undefined): number {
  const r = Number(ratio);
  if (!Number.isFinite(r)) return DEFAULT_INPUT_TAX_DEDUCTIBLE_RATIO;
  return Math.min(Math.max(r, 0), 1);
}

/** 含稅金額內含的銷項稅額（代客戶收取、須繳交國稅局） */
export function salesTaxWithin(taxIncludedAmount: number): number {
  const n = Number(taxIncludedAmount);
  if (!Number.isFinite(n)) return 0;
  return n - n / TW_PURCHASE_VAT_MULTIPLIER;
}

/**
 * 扣抵不到的進項稅額：可扣抵的部分能用銷項折抵、不是支出，
 * 剩下的才是真的付出去拿不回來的錢。
 */
export function nonDeductibleInputTax(
  amountExTax: number,
  deductibleRatio: number | null | undefined,
): number {
  const n = Number(amountExTax);
  if (!Number.isFinite(n)) return 0;
  return n * TW_PURCHASE_VAT_RATE * (1 - clampDeductibleRatio(deductibleRatio));
}

export type PurchaseLineComputed = {
  /** 使用者輸入之單價（已稅或未稅，與旗標一致） */
  unit_price: number;
  unit_price_is_tax_inclusive: boolean;
  unit_price_ex_tax: number;
  unit_price_inc_tax: number;
  amount_ex_tax: number;
  tax_included_amount: number;
};

/**
 * 依輸入單價、數量、已稅/未稅旗標，計算未稅/已稅單價與未稅/含稅總價。
 * 數量為 0 或 NaN 時，總價為 0。
 */
export function computePurchaseLinePrices(
  inputUnitPrice: number,
  quantity: number,
  unitPriceIsTaxInclusive: boolean,
): PurchaseLineComputed {
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  let ex: number;
  let inc: number;
  if (unitPriceIsTaxInclusive) {
    inc = roundMoney2(inputUnitPrice);
    ex = roundMoney2(inc / TW_PURCHASE_VAT_MULTIPLIER);
  } else {
    ex = roundMoney2(inputUnitPrice);
    inc = roundMoney2(ex * TW_PURCHASE_VAT_MULTIPLIER);
  }
  const input = roundMoney2(inputUnitPrice);
  return {
    unit_price: input,
    unit_price_is_tax_inclusive: unitPriceIsTaxInclusive,
    unit_price_ex_tax: ex,
    unit_price_inc_tax: inc,
    amount_ex_tax: roundMoney2(q * ex),
    tax_included_amount: roundMoney2(q * inc),
  };
}
