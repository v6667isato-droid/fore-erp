import type { SeriesRow, VariantRow } from "@/types/products";

export function exportProductsCsv(series: SeriesRow[], variants: VariantRow[]) {
  if (!series.length || !variants.length) return;

  const seriesMap = new Map<string, SeriesRow>();
  for (const s of series) {
    seriesMap.set(s.id, s);
  }

  const headers = [
    "系列名稱",
    "類別",
    "代碼",
    "木種",
    "尺寸",
    "桌面面積",
    "基礎定價",
    "網站",
  ];

  const rows = variants.map((v) => {
    const s = seriesMap.get(v.series_id);
    const w = v.dimension_w ?? "";
    const d = v.dimension_d ?? "";
    const h = v.dimension_h ?? "";
    const parts = [w, d, h].filter((x) => x !== "");
    const dim =
      parts.length === 0
        ? ""
        : `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;

    return [
      s?.name ?? "",
      s?.category ?? "",
      v.product_code ?? "",
      v.wood_type ?? "",
      dim,
      v.desktop_area != null ? String(v.desktop_area) : "",
      v.base_price != null ? String(v.base_price) : "",
      s?.website ?? "",
    ];
  });

  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `產品規格_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

