import type { SeriesRow, VariantRow } from "@/types/products";

/** 價目表一列（系列 × 規格） */
export type PriceListRow = {
  /** product_variants.id，列表 key 用 */
  variantId: string;
  category: string;
  seriesId: string;
  seriesName: string;
  /** 系列英文名稱（英文版價目表用，null fallback 中文） */
  seriesNameEn: string | null;
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
  const parts: string[] = [];
  if (v.dimension_w != null) parts.push(`W${v.dimension_w}`);
  if (v.dimension_d != null) parts.push(`D${v.dimension_d}`);
  if (v.dimension_h != null) parts.push(`H${v.dimension_h}`);
  return parts.join(" × ");
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

/**
 * @param categoryFilters 空陣列表示全部類別
 * @param seriesIdFilters 手動勾選產品（系列）時傳入；空陣列表示不限
 */
export function buildPriceListRows(
  seriesList: SeriesRow[],
  variantsList: VariantRow[],
  categoryFilters: string[] = [],
  seriesIdFilters: string[] = []
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
  const seriesIdSet = seriesIdFilters.length > 0 ? new Set(seriesIdFilters) : null;
  const allowedSeriesIds = new Set(
    filteredSeries.filter((s) => !seriesIdSet || seriesIdSet.has(s.id)).map((s) => s.id)
  );

  const rows: PriceListRow[] = [];
  for (const v of variantsList) {
    // 訂製款為開單佔位用規格，不列入價目表
    if (v.is_custom_order) continue;
    // 價目表獨立勾選：只列 show_on_price_list = true 的規格（與介紹表 show_on_sheet 分開）
    if (v.show_on_price_list !== true) continue;
    if (!allowedSeriesIds.has(v.series_id)) continue;
    const s = seriesMap.get(v.series_id);
    rows.push({
      variantId: v.id,
      category: s?.category ?? "",
      seriesId: v.series_id,
      seriesName: s?.name ?? "",
      seriesNameEn: s?.name_en?.trim() || null,
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

/** 依產品（系列）分組（維持列順序；價目表列印頁以產品為組、組內列規格） */
export function groupPriceListRowsBySeries(
  rows: PriceListRow[]
): { seriesId: string; seriesName: string; seriesNameEn: string | null; category: string; rows: PriceListRow[] }[] {
  const groups: { seriesId: string; seriesName: string; seriesNameEn: string | null; category: string; rows: PriceListRow[] }[] = [];
  let current: string | null = null;
  for (const row of rows) {
    if (row.seriesId !== current) {
      groups.push({
        seriesId: row.seriesId,
        seriesName: row.seriesName || "未命名",
        seriesNameEn: row.seriesNameEn,
        category: row.category,
        rows: [row],
      });
      current = row.seriesId;
    } else {
      groups[groups.length - 1].rows.push(row);
    }
  }
  return groups;
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

/** 從列印頁 URL 讀取手動勾選的系列（?series=<uuid>&series=<uuid>）；無參數表示不限 */
export function parsePriceListSeriesIdsFromSearchParams(
  getAll: (key: string) => string[]
): string[] {
  return [...new Set(getAll("series").map((c) => c.trim()).filter(Boolean))];
}

/** 價目表預設有效期限：製表日 + 3 個月 */
export function defaultPriceListValidUntil(from: Date = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 從列印頁 URL 讀取有效期限（?valid=YYYY-MM-DD）；缺省或格式不符時回預設（製表日 + 3 個月） */
export function parsePriceListValidUntil(get: (key: string) => string | null): string {
  const raw = (get("valid") ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : defaultPriceListValidUntil();
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
