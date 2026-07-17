import type { SeriesRow, VariantRow } from "@/types/products";

/** 價目表一列（系列 × 規格） */
export type PriceListRow = {
  /** product_variants.id，列表 key 用 */
  variantId: string;
  category: string;
  seriesId: string;
  seriesName: string;
  seriesImageUrl: string | null;
  productCode: string;
  woodType: string;
  dimension: string;
  seatHeightCm: number | null;
  spec1: string | null;
  basePrice: number | null;
  variantImageUrl: string | null;
};

export function formatVariantDimension(v: VariantRow): string {
  const w = v.dimension_w != null ? v.dimension_w : "";
  const d = v.dimension_d != null ? v.dimension_d : "";
  const h = v.dimension_h != null ? v.dimension_h : "";
  const parts = [w, d, h].filter((x) => x !== "");
  if (parts.length === 0) return "";
  return `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
}

export function resolvePriceListImageUrl(
  variant: VariantRow,
  series: SeriesRow | undefined
): string | null {
  const vImg = variant.image_url?.trim();
  if (vImg) return vImg;
  const sImg = series?.image_url?.trim();
  return sImg || null;
}

/** @param categoryFilters 空陣列表示全部類別 */
export function buildPriceListRows(
  seriesList: SeriesRow[],
  variantsList: VariantRow[],
  categoryFilters: string[] = []
): PriceListRow[] {
  const seriesMap = new Map<string, SeriesRow>();
  for (const s of seriesList) {
    seriesMap.set(s.id, s);
  }

  const filterSet =
    categoryFilters.length > 0 ? new Set(categoryFilters) : null;
  const filteredSeries = filterSet
    ? seriesList.filter((s) => filterSet.has(s.category))
    : seriesList;
  const allowedSeriesIds = new Set(filteredSeries.map((s) => s.id));

  const rows: PriceListRow[] = [];
  for (const v of variantsList) {
    // 訂製款為開單佔位用規格，不列入價目表
    if (v.is_custom_order) continue;
    if (!allowedSeriesIds.has(v.series_id)) continue;
    const s = seriesMap.get(v.series_id);
    rows.push({
      variantId: v.id,
      category: s?.category ?? "",
      seriesId: v.series_id,
      seriesName: s?.name ?? "",
      seriesImageUrl: s?.image_url ?? null,
      productCode: v.product_code ?? "",
      woodType: v.wood_type ?? "",
      dimension: formatVariantDimension(v),
      seatHeightCm:
        v.seat_height_cm != null && Number.isFinite(Number(v.seat_height_cm))
          ? Number(v.seat_height_cm)
          : null,
      spec1: v.spec1 ?? null,
      basePrice:
        v.base_price != null && Number.isFinite(Number(v.base_price))
          ? Number(v.base_price)
          : null,
      variantImageUrl: resolvePriceListImageUrl(v, s),
    });
  }

  rows.sort((a, b) => {
    const cat = a.category.localeCompare(b.category, "zh-Hant");
    if (cat !== 0) return cat;
    const series = a.seriesName.localeCompare(b.seriesName, "zh-Hant");
    if (series !== 0) return series;
    return a.productCode.localeCompare(b.productCode, "zh-Hant");
  });

  return rows;
}

/** 依類別分組（維持列順序） */
export function groupPriceListRowsByCategory(
  rows: PriceListRow[]
): { category: string; rows: PriceListRow[] }[] {
  const groups: { category: string; rows: PriceListRow[] }[] = [];
  let current: string | null = null;
  for (const row of rows) {
    const cat = row.category || "未分類";
    if (cat !== current) {
      groups.push({ category: cat, rows: [row] });
      current = cat;
    } else {
      groups[groups.length - 1].rows.push(row);
    }
  }
  return groups;
}

export function priceListCategoryLabel(categoryFilters: string[]): string {
  if (!categoryFilters.length) return "全部類別";
  if (categoryFilters.length <= 3) return categoryFilters.join("、");
  return `${categoryFilters.slice(0, 3).join("、")} 等 ${categoryFilters.length} 類`;
}

/** 從列印頁 URL 讀取類別（?category=椅&category=桌）；無參數表示全部 */
export function parsePriceListCategoriesFromSearchParams(
  getAll: (key: string) => string[]
): string[] {
  return [...new Set(getAll("category").map((c) => c.trim()).filter(Boolean))];
}

/** 勾選集轉為篩選陣列：全選或未勾選任何項時回傳 []（全部） */
export function priceListFiltersFromSelection(
  selected: Set<string>,
  allCategories: string[]
): string[] | null {
  if (selected.size === 0) return null;
  if (selected.size >= allCategories.length) return [];
  return [...selected];
}
