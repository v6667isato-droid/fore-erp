/**
 * 扶手高度（product_variants.arm_height_cm，英文標示 AH）
 *
 * 規則：未填寫（null／空值／非數字）一律視為沒有這個規格，
 * 訂單與產品資料表等各處都不顯示，不補預設值、不顯示「—」。
 */

/** 取扶手高度數值；未填寫或非數字回 null */
export function armHeightCm(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 扶手高度顯示字串。
 * 未填寫回 null（呼叫端據此整段不輸出）。
 * compact=true 為訂單列表的緊湊格式（AH:65cm），否則為 AH 65 cm。
 */
export function formatArmHeight(v: unknown, compact = false): string | null {
  const n = armHeightCm(v);
  if (n == null) return null;
  return compact ? `AH:${n}cm` : `AH ${n} cm`;
}

/**
 * 把扶手高度接到既有尺寸字串後面；未填寫則原字串不變。
 * base 為空（null／""）時，只輸出扶手高度本身。
 */
export function appendArmHeight(
  base: string | null,
  v: unknown,
  separator = " · ",
  compact = false,
): string | null {
  const label = formatArmHeight(v, compact);
  if (!label) return base;
  if (!base || base === "—") return label;
  return `${base}${separator}${label}`;
}
