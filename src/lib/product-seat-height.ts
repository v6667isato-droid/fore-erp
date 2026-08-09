/** 椅、凳類規格預設座高（cm），與通路下單說明一致 */
export const DEFAULT_SEAT_HEIGHT_CM = 45;

/** 座高加高之單筆費用（元），通路下單時於畫面提示 */
export const SEAT_HEIGHT_UPCHARGE_NTD = 2000;

/**
 * 只有「椅」類別有座高與扶手高度（AH）兩個規格欄位。
 * 其餘類別（桌／櫃／層架／其他）不出現這兩個欄位，也不套座高預設值。
 */
export function hasSeatSpecs(category: string | null | undefined): boolean {
  return category === "椅";
}
