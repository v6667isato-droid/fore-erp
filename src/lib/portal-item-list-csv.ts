/**
 * 通路入口「匯出品項清單 CSV」：與下單選單同一份品項（呼叫端須先排除已刪除規格），
 * 通路價與下單計價同公式（系列折扣 % > 0 時 round(牌價 × (1 − %/100))，否則等於牌價）。
 */
export type PortalItemListVariant = {
  series_id: string | null;
  series_name: string | null;
  series_category?: string | null;
  product_code: string | null;
  wood_type: string | null;
  spec1?: string | null;
  dimension_w: number | null;
  dimension_d: number | null;
  dimension_h: number | null;
  seat_height_cm?: number | null;
  arm_height_cm: number | null;
  base_price: number | null;
};

const HEADERS = [
  "類別",
  "系列",
  "產品代碼",
  "木種",
  "規格",
  "W（cm）",
  "D（cm）",
  "H（cm）",
  "座高（cm）",
  "扶手高（cm）",
  "牌價",
  "通路價",
];

function finiteOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

function numCell(v: number | null | undefined): string {
  const n = finiteOrNull(v);
  return n == null ? "" : String(n);
}

/** 通路價：與 portal 下單 portalSettlementUnitPrice／後端 pricePortalItems 一致 */
export function portalItemListChannelPrice(
  v: PortalItemListVariant,
  discountPctBySeriesId: Map<string, number>,
): number | null {
  const base = finiteOrNull(v.base_price);
  if (base == null) return null;
  const pct = v.series_id ? (discountPctBySeriesId.get(v.series_id) ?? 0) : 0;
  return pct > 0 ? Math.round(base * (1 - pct / 100)) : base;
}

export function buildPortalItemListCsv(
  variants: PortalItemListVariant[],
  discountPctBySeriesId: Map<string, number>,
): string {
  const sorted = [...variants].sort((a, b) => {
    const cat = (a.series_category ?? "").localeCompare(b.series_category ?? "", "zh-Hant");
    if (cat !== 0) return cat;
    const series = (a.series_name ?? "").localeCompare(b.series_name ?? "", "zh-Hant");
    if (series !== 0) return series;
    return (a.product_code ?? "").localeCompare(b.product_code ?? "", "zh-Hant");
  });

  const rows = sorted.map((v) => [
    v.series_category ?? "",
    v.series_name ?? "",
    v.product_code ?? "",
    v.wood_type ?? "",
    v.spec1 ?? "",
    numCell(v.dimension_w),
    numCell(v.dimension_d),
    numCell(v.dimension_h),
    numCell(v.seat_height_cm),
    numCell(v.arm_height_cm),
    numCell(v.base_price),
    numCell(portalItemListChannelPrice(v, discountPctBySeriesId)),
  ]);

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [HEADERS, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
