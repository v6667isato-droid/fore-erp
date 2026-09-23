/**
 * 數字輸入欄位共用邏輯（見 components/ui/numeric-input.tsx）。
 * 抽成純函式方便單元測試。
 */

/** 全形數字／小數點轉半形（中文輸入法全形模式、從文件貼上時常見） */
function toHalfWidth(raw: string): string {
  return raw
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // ０-９
    .replace(/\uFF0E/g, "."); // ．
}

/**
 * 清理貼上的文字，只留下數字（allowDecimal 時再留第一個小數點）。
 * 整數模式遇到小數點直接截斷，避免 "1500.00" 被併成 "150000"。
 */
export function sanitizeNumericText(raw: string, allowDecimal: boolean): string {
  const s = toHalfWidth(raw);
  if (!allowDecimal) return s.split(".")[0].replace(/\D/g, "");
  const cleaned = s.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  return dot === -1
    ? cleaned
    : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

/** 輸入框文字 → 數值；空白或無法解析回傳 null */
export function parseNumericText(text: string, allowDecimal: boolean): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return allowDecimal ? n : Math.trunc(n);
}

/** 數值 → 輸入框文字；0 與空值一律顯示空白，讓使用者可直接輸入 */
export function formatNumericValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "";
  return String(value);
}

/**
 * 單鍵輸入是否放行：只放數字（allowDecimal 時加小數點）。
 * 功能鍵（Backspace、方向鍵、Tab、Enter…）的 key 長度大於 1，一律放行。
 */
export function isAllowedNumericKey(key: string, allowDecimal: boolean): boolean {
  if (key.length !== 1) return true;
  if (key >= "0" && key <= "9") return true;
  return allowDecimal && key === ".";
}
