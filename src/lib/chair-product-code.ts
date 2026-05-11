/**
 * 生產／清單用：是否為 CH03／CH03A 椅子家族（與椅子生產表邏輯一致）。
 */
export function isChairCh03FamilyProductCode(productCode: string | null | undefined): boolean {
  const c = (productCode ?? "").trim();
  if (!c) return false;
  if (
    c === "CH03A" ||
    c.startsWith("CH03A-") ||
    c === "CH03-A" ||
    c.startsWith("CH03-A-")
  ) {
    return true;
  }
  if (c === "CH03" || (c.startsWith("CH03-") && !c.startsWith("CH03-A") && !c.startsWith("CH03A"))) {
    return true;
  }
  return false;
}

/** 訂單明細座高優先，否則產品變體預設（cm） */
export function resolveSeatHeightCmForDisplay(
  orderItemSeat: unknown,
  variantSeat: unknown,
): number | null {
  if (orderItemSeat != null && orderItemSeat !== "" && Number.isFinite(Number(orderItemSeat))) {
    return Number(orderItemSeat);
  }
  if (variantSeat != null && variantSeat !== "" && Number.isFinite(Number(variantSeat))) {
    return Number(variantSeat);
  }
  return null;
}

export function formatSeatHeightCmLabel(cm: number): string {
  const n = Number(cm);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  const text = Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded);
  return `座高 ${text} cm`;
}
