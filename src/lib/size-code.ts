/** 尺寸選項值代碼與寬深高的互轉（W{w}D{d}H{h}／W{w}D{d}／W{w}H{h}／純數字＝僅寬） */

export interface SizeDims {
  w: number | null;
  d: number | null;
  h: number | null;
}

/** 從尺寸代碼反推寬深高，無法解析回傳全 null */
export function parseSizeCode(code: string): SizeDims {
  const m = /^W(\d+(?:\.\d+)?)(?:D(\d+(?:\.\d+)?))?(?:H(\d+(?:\.\d+)?))?$/i.exec(code);
  if (m) {
    return {
      w: Number(m[1]),
      d: m[2] != null ? Number(m[2]) : null,
      h: m[3] != null ? Number(m[3]) : null,
    };
  }
  const wOnly = /^\d+(?:\.\d+)?$/.exec(code);
  if (wOnly) return { w: Number(code), d: null, h: null };
  return { w: null, d: null, h: null };
}

/** 由寬深高組尺寸代碼：僅寬 → 純數字（與既有資料相容），其餘 → W{w}D{d}H{h} 依有值的段組合 */
export function buildSizeCode(w: number, d: number | null, h: number | null): string {
  if (d == null && h == null) return String(w);
  return `W${w}${d != null ? `D${d}` : ""}${h != null ? `H${h}` : ""}`;
}
