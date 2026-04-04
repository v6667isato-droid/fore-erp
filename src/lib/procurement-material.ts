/** 採購明細單一「規格」欄位寫入：規格 + 規格2（以「 / 」連接） */
export function purchaseSpecFromMaterialParts(spec?: string | null, spec2?: string | null): string {
  const a = (spec ?? "").trim();
  const b = (spec2 ?? "").trim();
  if (a && b) return `${a} / ${b}`;
  return a || b;
}
