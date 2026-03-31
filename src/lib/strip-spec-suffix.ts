/**
 * 列印／報表用：去掉規格字串末端的 -P、-R、-W、-F 等英文代碼（與椅生產表邏輯一致）
 */
export function stripSpecSuffixCodes(text: string): string {
  let s = text.trim();
  if (!s) return "";
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/(?:[-－](?:P|R|W|F))+$/gi, "").trim();
  }
  s = s.replace(/(?:[-－](?:P|R|W|F))+(?=\s*\*)/gi, "");
  return s.trim();
}
