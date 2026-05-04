const PURCHASE_SPEC_MERGE_SEP = " / ";

/** 採購明細單一「規格」欄位寫入：規格 + 規格2（以「 / 」連接） */
export function purchaseSpecFromMaterialParts(spec?: string | null, spec2?: string | null): string {
  const a = (spec ?? "").trim();
  const b = (spec2 ?? "").trim();
  if (a && b) return `${a}${PURCHASE_SPEC_MERGE_SEP}${b}`;
  return a || b;
}

/** 由合併 spec 與 DB spec2，拆回兩段供列表顯示（舊資料僅 spec 時仍可拆） */
export function purchaseSpecPartsForDisplay(
  mergedSpec?: string | null,
  explicitSpec2?: string | null,
): { primary: string; secondary: string } {
  const ex2 = (explicitSpec2 ?? "").trim();
  const merged = (mergedSpec ?? "").trim();
  if (ex2) {
    const suffix = `${PURCHASE_SPEC_MERGE_SEP}${ex2}`;
    const primary =
      merged.endsWith(suffix) ? merged.slice(0, -suffix.length).trimEnd() : merged;
    return { primary: primary || merged, secondary: ex2 };
  }
  const idx = merged.indexOf(PURCHASE_SPEC_MERGE_SEP);
  if (idx >= 0) {
    return {
      primary: merged.slice(0, idx).trimEnd(),
      secondary: merged.slice(idx + PURCHASE_SPEC_MERGE_SEP.length).trim(),
    };
  }
  return { primary: merged, secondary: "" };
}
