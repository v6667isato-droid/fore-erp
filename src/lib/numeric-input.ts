/**
 * 數字輸入欄位共用邏輯（見 components/ui/numeric-input.tsx）。
 * 抽成純函式方便單元測試。
 */

export type NumericInputOptions = {
  /** 允許小數（預設只允許整數） */
  allowDecimal?: boolean;
  /** 允許負數（價差、調整金額等；預設不允許） */
  allowNegative?: boolean;
};

/** 全形數字／小數點轉半形（中文輸入法全形模式、從文件貼上時常見） */
function toHalfWidth(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // ０-９
    .replace(/．/g, "."); // ．
}

/**
 * 清理貼上的文字，只留下數字（allowDecimal 時再留第一個小數點、allowNegative 時保留開頭負號）。
 * 整數模式遇到小數點直接截斷，避免 "1500.00" 被併成 "150000"。
 */
export function sanitizeNumericText(
  raw: string,
  { allowDecimal = false, allowNegative = false }: NumericInputOptions = {}
): string {
  const s = toHalfWidth(raw);
  // 半形 -、全形 －、數學負號 −
  const negative = allowNegative && /^\s*[-－−]/.test(s);
  let digits: string;
  if (!allowDecimal) {
    digits = s.split(".")[0].replace(/\D/g, "");
  } else {
    const cleaned = s.replace(/[^\d.]/g, "");
    const dot = cleaned.indexOf(".");
    digits =
      dot === -1
        ? cleaned
        : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
  }
  return negative && digits ? `-${digits}` : digits;
}

/** 輸入框文字 → 數值；空白或無法解析回傳 null */
export function parseNumericText(
  text: string,
  { allowDecimal = false, allowNegative = false }: NumericInputOptions = {}
): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return 0;
  return allowDecimal ? n : Math.trunc(n);
}

/**
 * 數值 → 輸入框文字；0 與空值顯示空白，讓使用者可直接輸入。
 * keepZero：「空白」與 0 意義不同（如空白＝沿用預設）時，0 照常顯示。
 * 也接受字串（表單 state 存字串的欄位），無法解析的字串顯示空白。
 */
export function formatNumericValue(
  value: number | string | null | undefined,
  keepZero = false
): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value.trim() : String(value);
  if (text === "") return "";
  const n = Number(text);
  if (!Number.isFinite(n)) return "";
  if (n === 0 && !keepZero) return "";
  return text;
}

/** onValueChange 收到的值轉回字串，給表單 state 存字串的欄位用（清空 → ""） */
export function toNumericText(value: number | null): string {
  return value == null ? "" : String(value);
}

/**
 * 單鍵輸入是否放行：只放數字（allowDecimal 時加小數點、allowNegative 時加負號）。
 * 功能鍵（Backspace、方向鍵、Tab、Enter…）的 key 長度大於 1，一律放行。
 */
export function isAllowedNumericKey(
  key: string,
  { allowDecimal = false, allowNegative = false }: NumericInputOptions = {}
): boolean {
  if (key.length !== 1) return true;
  if (key >= "0" && key <= "9") return true;
  if (allowDecimal && key === ".") return true;
  return allowNegative && key === "-";
}
