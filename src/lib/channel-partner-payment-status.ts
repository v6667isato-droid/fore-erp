/** 通路端畫面僅呈現兩種；其餘後台付款狀態（未付款、部分付款等）一律視為未結清。 */
export type ChannelPartnerPaymentDisplay = "已結清" | "未結清";

export function normalizeChannelPartnerPaymentStatus(
  raw: string | null | undefined
): ChannelPartnerPaymentDisplay {
  return raw === "已結清" ? "已結清" : "未結清";
}
