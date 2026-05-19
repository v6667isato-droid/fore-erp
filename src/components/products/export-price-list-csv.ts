import type { SeriesRow, VariantRow } from "@/types/products";
import {
  buildPriceListRows,
  priceListCategoryLabel,
} from "@/lib/price-list";

export function exportPriceListCsv(
  seriesList: SeriesRow[],
  variantsList: VariantRow[],
  categoryFilters: string[] = []
): boolean {
  const rows = buildPriceListRows(seriesList, variantsList, categoryFilters);
  if (!rows.length) return false;

  const headers = [
    "分類",
    "系列名稱",
    "產品代碼",
    "木種",
    "尺寸",
    "座高（cm）",
    "規格",
    "建議售價",
  ];

  const csvRows = rows.map((r) => [
    r.category,
    r.seriesName,
    r.productCode,
    r.woodType,
    r.dimension,
    r.seatHeightCm != null ? String(r.seatHeightCm) : "",
    r.spec1 ?? "",
    r.basePrice != null ? String(r.basePrice) : "",
  ]);

  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    headers.join(","),
    ...csvRows.map((row) => row.map(escape).join(",")),
  ].join("\n");

  const label = priceListCategoryLabel(categoryFilters).replace(/[\\/:*?"<>|]/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `價目表_${label}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
