/** 台灣進項／採購常用營業稅率 5%（固定，不另存欄位） */
export const TW_PURCHASE_VAT_RATE = 0.05;
export const TW_PURCHASE_VAT_MULTIPLIER = 1 + TW_PURCHASE_VAT_RATE;

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
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
