"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SeriesRow, VariantRow } from "@/types/products";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
  SERIES_SELECT,
  SERIES_SELECT_NO_WEBSITE,
  VARIANT_SELECT,
  SERIES_SELECT_MINIMAL,
  VARIANT_SELECT_MINIMAL,
  SERIES_CONTENT_COLUMNS,
} from "@/lib/products-db";
import { Package, ChevronDown, ChevronRight, Plus, Eye, Pencil, Trash2, Download } from "lucide-react";
import { AddSeriesDialog } from "@/components/products/add-series-dialog";
import { AddVariantDialog } from "@/components/products/add-variant-dialog";
import { EditSeriesDialog } from "@/components/products/edit-series-dialog";
import { EditSeriesContentDialog } from "@/components/products/edit-series-content-dialog";
import { EditVariantDialog } from "@/components/products/edit-variant-dialog";
import { ViewSeriesDialog } from "@/components/products/view-series-dialog";
import { ViewVariantDialog } from "@/components/products/view-variant-dialog";
import { EditSeriesChannelDiscountDialog } from "@/components/products/edit-series-channel-discount-dialog";
import type { ChannelOption } from "@/components/products/edit-series-channel-discount-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { exportProductsCsv } from "@/components/products/export-products-csv";

/** 支援 name 或 series_name 欄位（Supabase 表可能用其中一種） */
function mapSeries(r: Record<string, unknown>): SeriesRow {
  const nameVal = r.name ?? r.series_name;
  return {
    id: String(r.id),
    name: String(nameVal ?? ""),
    category: String(r.category ?? ""),
    notes: r.notes != null ? String(r.notes) : null,
    production_time: r.production_time != null ? String(r.production_time) : null,
    code_rule: r.code_rule != null ? String(r.code_rule) : null,
    design_concept: r.design_concept != null ? String(r.design_concept) : null,
    faq_scripts: r.faq_scripts != null ? String(r.faq_scripts) : null,
    social_media_copy: r.social_media_copy != null ? String(r.social_media_copy) : null,
    website_article: r.website_article != null ? String(r.website_article) : null,
    customization_rules: r.customization_rules != null ? String(r.customization_rules) : null,
    website: r.website != null ? String(r.website) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
  };
}

type SeriesDiscount = {
  channel_id: string;
  discount_percent: number;
};

function mapVariant(r: Record<string, unknown>): VariantRow {
  return {
    id: String(r.id),
    series_id: String(r.series_id ?? ""),
    product_code: String(r.product_code ?? ""),
    wood_type: String(r.wood_type ?? ""),
    dimension_w: r.dimension_w != null ? Number(r.dimension_w) : null,
    dimension_d: r.dimension_d != null ? Number(r.dimension_d) : null,
    dimension_h: r.dimension_h != null ? Number(r.dimension_h) : null,
    base_price: r.base_price != null ? Number(r.base_price) : null,
    desktop_area: r.desktop_area != null ? Number(r.desktop_area) : null,
    spec1: r.spec1 != null ? String(r.spec1) : null,
  };
}

function formatDim(v: VariantRow): string {
  const w = v.dimension_w != null ? v.dimension_w : "";
  const d = v.dimension_d != null ? v.dimension_d : "";
  const h = v.dimension_h != null ? v.dimension_h : "";
  const parts = [w, d, h].filter((x) => x !== "");
  if (parts.length === 0) return "—";
  return `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
}

type SeriesSortKey = "name" | "category" | "variantCount" | "website";
type VariantSortKey = "product_code" | "wood_type" | "spec1" | "dimension" | "base_price";

export function ProductsPage() {
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [variantsList, setVariantsList] = useState<VariantRow[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [seriesDiscounts, setSeriesDiscounts] = useState<Record<string, SeriesDiscount[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState("");
  const [viewSeries, setViewSeries] = useState<SeriesRow | null>(null);
  const [editSeries, setEditSeries] = useState<SeriesRow | null>(null);
  const [addVariantSeries, setAddVariantSeries] = useState<SeriesRow | null>(null);
  const [editDiscountSeries, setEditDiscountSeries] = useState<SeriesRow | null>(null);
  const [viewVariant, setViewVariant] = useState<VariantRow | null>(null);
  const [editVariant, setEditVariant] = useState<VariantRow | null>(null);
  const [deleteConfirmSeries, setDeleteConfirmSeries] = useState<SeriesRow | null>(null);
  const [deleteConfirmVariant, setDeleteConfirmVariant] = useState<VariantRow | null>(null);
  const [seriesSort, setSeriesSort] = useState<{ key: SeriesSortKey; asc: boolean }>({
    key: "name",
    asc: true,
  });
  const [variantSort, setVariantSort] = useState<{ key: VariantSortKey; asc: boolean }>({
    key: "product_code",
    asc: true,
  });

  const variantsBySeries = useMemo(() => {
    const map: Record<string, VariantRow[]> = {};
    for (const v of variantsList) {
      if (!map[v.series_id]) map[v.series_id] = [];
      map[v.series_id].push(v);
    }
    return map;
  }, [variantsList]);

  const categories = useMemo(() => {
    return [...new Set(seriesList.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [seriesList]);

  const channelNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    channels.forEach((c) => {
      m[c.id] = c.name;
    });
    return m;
  }, [channels]);

  const filteredSeries = useMemo(() => {
    if (!filterCategory) return seriesList;
    return seriesList.filter((s) => s.category === filterCategory);
  }, [seriesList, filterCategory]);

  const sortedSeries = useMemo(() => {
    const base = [...filteredSeries];
    base.sort((a, b) => {
      const ascFactor = seriesSort.asc ? 1 : -1;
      switch (seriesSort.key) {
        case "category": {
          const aVal = a.category || "";
          const bVal = b.category || "";
          return ascFactor * aVal.localeCompare(bVal);
        }
        case "variantCount": {
          const aCount = (variantsBySeries[a.id] ?? []).length;
          const bCount = (variantsBySeries[b.id] ?? []).length;
          return ascFactor * (aCount - bCount);
        }
        case "website": {
          const aVal = a.website?.trim() || "";
          const bVal = b.website?.trim() || "";
          return ascFactor * aVal.localeCompare(bVal);
        }
        case "name":
        default: {
          const aVal = a.name || "";
          const bVal = b.name || "";
          return ascFactor * aVal.localeCompare(bVal);
        }
      }
    });
    return base;
  }, [filteredSeries, seriesSort, variantsBySeries]);

  async function fetchData() {
    setLoading(true);
    setLoadError(null);
    let seriesData: Record<string, unknown>[] | null = null;
    let variantsData: Record<string, unknown>[] = [];

    const seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT).order("id", { ascending: true });
    if (seriesRes.error) {
      // 若完整欄位失敗，先嘗試只取基本欄位（仍包含 code_rule），避免因為文案欄位不存在而看不到編碼原則
      const basicRes = await supabase
        .from(TABLE_PRODUCT_SERIES)
        .select("id, series_name as name, category, notes, production_time, code_rule, website, image_url")
        .order("id", { ascending: true });
      if (!basicRes.error) {
        seriesData = (basicRes.data ?? []) as unknown as Record<string, unknown>[];
      } else {
        const noWebsite = await supabase
          .from(TABLE_PRODUCT_SERIES)
          .select(SERIES_SELECT_NO_WEBSITE)
          .order("id", { ascending: true });
        if (!noWebsite.error) {
          seriesData = (noWebsite.data ?? []) as unknown as Record<string, unknown>[];
        }
      }
      if (seriesData === null) {
        const fallback = await supabase
          .from(TABLE_PRODUCT_SERIES)
          .select(SERIES_SELECT_MINIMAL)
          .order("id", { ascending: true });
        if (!fallback.error) {
          seriesData = (fallback.data ?? []) as unknown as Record<string, unknown>[];
        } else {
          const minimal = await supabase
            .from(TABLE_PRODUCT_SERIES)
            .select("id, series_name as name, category")
            .order("id", { ascending: true });
          if (!minimal.error) {
            seriesData = (minimal.data ?? []) as unknown as Record<string, unknown>[];
          } else if (/name/i.test(seriesRes.error.message ?? "")) {
            const contentCols = SERIES_CONTENT_COLUMNS.join(", ");
            const bySeriesNameFull = await supabase
              .from(TABLE_PRODUCT_SERIES)
              .select(`id, series_name, category, notes, production_time, code_rule, ${contentCols}, website, image_url`)
              .order("id", { ascending: true });
            if (!bySeriesNameFull.error) {
              seriesData = (bySeriesNameFull.data ?? []) as unknown as Record<string, unknown>[];
            } else {
              const bySeriesName = await supabase
                .from(TABLE_PRODUCT_SERIES)
                .select("id, series_name, category")
                .order("id", { ascending: true });
              if (!bySeriesName.error) {
                seriesData = bySeriesName.data as Record<string, unknown>[];
              } else {
                const altMin = await supabase
                  .from(TABLE_PRODUCT_SERIES)
                  .select("id, series_name")
                  .order("id", { ascending: true });
                if (!altMin.error) {
                  seriesData = altMin.data as Record<string, unknown>[];
                } else {
                  setLoadError(seriesRes.error.message || "無法讀取 product_series");
                }
              }
            }
          } else {
            setLoadError(seriesRes.error.message || "無法讀取 product_series");
          }
        }
      }
    } else {
      seriesData = (seriesRes.data ?? []) as unknown as Record<string, unknown>[];
    }

    const variantsRes = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT);
    if (variantsRes.error) {
      const fallback = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT_MINIMAL);
      variantsData = (fallback.data ?? variantsRes.data ?? []) as Record<string, unknown>[];
    } else {
      variantsData = (variantsRes.data ?? []) as Record<string, unknown>[];
    }

    setSeriesList((seriesData ?? []).map(mapSeries));
    setVariantsList(variantsData.map(mapVariant));
    setLoading(false);
  }

  async function fetchChannels() {
    const { data, error } = await supabase
      .from("channels")
      .select("id, name")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      // 通路讀不到時不阻擋產品頁，只在設定折扣時提示
      return;
    }
    setChannels(
      ((data ?? []) as any[]).map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
      }))
    );
  }

  async function fetchSeriesDiscounts() {
    const { data, error } = await supabase
      .from("product_series_channel_discounts")
      .select("series_id, channel_id, discount_percent");
    if (error) {
      // 折扣讀不到不影響主畫面，只是在變價時無法顯示
      return;
    }
    const map: Record<string, SeriesDiscount[]> = {};
    (data ?? []).forEach((row: any) => {
      const sid = String(row.series_id);
      if (!map[sid]) map[sid] = [];
      map[sid].push({
        channel_id: String(row.channel_id),
        discount_percent: Number(row.discount_percent ?? 0),
      });
    });
    setSeriesDiscounts(map);
  }

  useEffect(() => {
    fetchData();
    fetchChannels();
    fetchSeriesDiscounts();
  }, []);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function requestDeleteSeries(series: SeriesRow) {
    setDeleteConfirmSeries(series);
  }

  async function performDeleteSeries() {
    if (!deleteConfirmSeries) return;
    const series = deleteConfirmSeries;
    setDeleteConfirmSeries(null);
    const seriesVariants = variantsBySeries[series.id] ?? [];
    for (const v of seriesVariants) {
      const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).delete().eq("id", v.id);
      if (err) {
        toast.error(err.message || "刪除規格時失敗");
        return;
      }
    }
    const { error } = await supabase.from(TABLE_PRODUCT_SERIES).delete().eq("id", series.id);
    if (error) {
      toast.error(error.message || "刪除系列失敗");
      return;
    }
    toast.success("已刪除系列");
    fetchData();
    setViewSeries(null);
    setEditSeries(null);
    setAddVariantSeries(null);
  }

  function requestDeleteVariant(v: VariantRow) {
    setDeleteConfirmVariant(v);
  }

  async function performDeleteVariant() {
    if (!deleteConfirmVariant) return;
    const v = deleteConfirmVariant;
    setDeleteConfirmVariant(null);
    const { error } = await supabase.from(TABLE_PRODUCT_VARIANTS).delete().eq("id", v.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除規格");
    fetchData();
    setViewVariant(null);
    setEditVariant(null);
  }

  function handleExport() {
    if (!seriesList.length || !variantsList.length) {
      toast.info("目前沒有可匯出的產品規格資料");
      return;
    }
    exportProductsCsv(seriesList, variantsList);
    toast.success("已匯出產品規格 CSV");
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">載入產品資料中…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">產品資料</p>
              <p className="text-xl font-semibold text-foreground">產品系列</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-5 space-y-3">
          <p className="font-medium text-foreground">無法連結到 product_series</p>
          <p className="text-sm text-muted-foreground">請確認 Supabase 已建立資料表 <code className="rounded bg-muted px-1 py-0.5 text-xs">product_series</code>，且專案權限允許讀取。錯誤訊息：</p>
          <p className="text-sm text-destructive break-all">{loadError}</p>
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={fetchData}>
            重新載入
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">產品資料</p>
            <p className="text-xl font-semibold text-foreground">{seriesList.length} 種系列 · {variantsList.length} 種規格</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AddSeriesDialog onSuccess={fetchData} />
          <Button
            variant="outline"
            className="h-8 shrink-0 px-3 text-xs"
            onClick={handleExport}
            disabled={!seriesList.length || !variantsList.length}
            aria-label="匯出產品規格 CSV"
          >
            <Download className="h-4 w-4" />
            匯出 CSV
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選類別</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依類別篩選"
          >
            <option value="">全部</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">共 {filteredSeries.length} 個系列</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="w-10 p-2" aria-label="展開/收合" />
              <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                  onClick={() =>
                    setSeriesSort((prev) => ({
                      key: "name",
                      asc: prev.key === "name" ? !prev.asc : true,
                    }))
                  }
                  aria-label={`依系列名稱排序（目前為${seriesSort.key === "name" && !seriesSort.asc ? "降冪" : "升冪"}）`}
                >
                  <span>系列名稱</span>
                  <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                    {seriesSort.key === "name" ? (seriesSort.asc ? "↑" : "↓") : "–"}
                  </span>
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                  onClick={() =>
                    setSeriesSort((prev) => ({
                      key: "category",
                      asc: prev.key === "category" ? !prev.asc : true,
                    }))
                  }
                  aria-label={`依類別排序（目前為${
                    seriesSort.key === "category" && !seriesSort.asc ? "降冪" : "升冪"
                  }）`}
                >
                  <span>類別</span>
                  <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                    {seriesSort.key === "category" ? (seriesSort.asc ? "↑" : "↓") : "–"}
                  </span>
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                  onClick={() =>
                    setSeriesSort((prev) => ({
                      key: "variantCount",
                      asc: prev.key === "variantCount" ? !prev.asc : true,
                    }))
                  }
                  aria-label={`依規格數排序（目前為${
                    seriesSort.key === "variantCount" && !seriesSort.asc ? "降冪" : "升冪"
                  }）`}
                >
                  <span>規格數</span>
                  <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                    {seriesSort.key === "variantCount" ? (seriesSort.asc ? "↑" : "↓") : "–"}
                  </span>
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                  onClick={() =>
                    setSeriesSort((prev) => ({
                      key: "website",
                      asc: prev.key === "website" ? !prev.asc : true,
                    }))
                  }
                  aria-label={`依網站排序（目前為${
                    seriesSort.key === "website" && !seriesSort.asc ? "降冪" : "升冪"
                  }）`}
                >
                  <span>網站</span>
                  <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                    {seriesSort.key === "website" ? (seriesSort.asc ? "↑" : "↓") : "–"}
                  </span>
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 min-w-[200px] text-right" aria-label="操作">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSeries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  <span>{seriesList.length === 0 ? "尚無產品系列，請點「新增系列」建立。" : "無符合篩選條件的系列。"}</span>
                </TableCell>
              </TableRow>
            ) : (
              sortedSeries.map((series) => {
                const isExpanded = expandedIds.has(series.id);
                const variants = variantsBySeries[series.id] ?? [];
                return (
                  <Fragment key={series.id}>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="w-10 p-2 align-middle">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(series.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label={isExpanded ? "收合" : "展開"}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm font-medium p-2">
                        <button
                          type="button"
                          onClick={() => setViewSeries(series)}
                          className="flex items-center gap-2 text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                        >
                          {series.image_url && (
                            <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                              <img
                                src={series.image_url}
                                alt={series.name || "系列主圖"}
                                className="h-full w-full object-cover"
                              />
                            </span>
                          )}
                          <span className="flex flex-col">
                            <span>{series.name || "—"}</span>
                            {series.notes?.trim() && (
                              <span className="mt-0.5 text-[11px] text-muted-foreground">
                                {series.notes}
                              </span>
                            )}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground p-2">{series.category || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground p-2">{variants.length}</TableCell>
                      <TableCell className="text-sm p-2 max-w-[180px]">
                        {series.website?.trim() ? (
                          <a
                            href={series.website.trim().startsWith("http") ? series.website.trim() : `https://${series.website.trim()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline truncate block"
                            title={series.website.trim()}
                          >
                            {series.website.trim()}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="p-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewSeries(series)} aria-label={`總覽 ${series.name}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditSeries(series)} aria-label={`編輯系列 ${series.name}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDeleteSeries(series); }}
                            aria-label={`刪除系列 ${series.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border bg-muted/10 hover:bg-muted/10">
                      <TableCell colSpan={6} className="p-0 align-top">
                        <div
                          className="overflow-hidden transition-[max-height] duration-300 ease-out"
                          style={{ maxHeight: isExpanded ? "80vh" : 0 }}
                        >
                          <div className="bg-muted/20 px-4 pb-4 pt-2 max-h-[70vh] overflow-y-auto">
                            <div className="flex items-center justify-end gap-2 mb-2">
                              <Button
                                variant="outline"
                                className="h-8 px-3 gap-1.5 text-xs"
                                onClick={() => setAddVariantSeries(series)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                新增規格
                              </Button>
                            </div>
                            <div className="rounded-lg border border-border bg-card overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow className="hover:bg-transparent border-b border-border">
                                    <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 hover:text-primary"
                                        onClick={() =>
                                          setVariantSort((prev) => ({
                                            key: "product_code",
                                            asc: prev.key === "product_code" ? !prev.asc : true,
                                          }))
                                        }
                                        aria-label={`依代碼排序（目前為${
                                          variantSort.key === "product_code" && !variantSort.asc ? "降冪" : "升冪"
                                        }）`}
                                      >
                                        <span>代碼</span>
                                        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                                          {variantSort.key === "product_code" ? (variantSort.asc ? "↑" : "↓") : "–"}
                                        </span>
                                      </button>
                                    </TableHead>
                                    <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 hover:text-primary"
                                        onClick={() =>
                                          setVariantSort((prev) => ({
                                            key: "wood_type",
                                            asc: prev.key === "wood_type" ? !prev.asc : true,
                                          }))
                                        }
                                        aria-label={`依木種排序（目前為${
                                          variantSort.key === "wood_type" && !variantSort.asc ? "降冪" : "升冪"
                                        }）`}
                                      >
                                        <span>木種</span>
                                        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                                          {variantSort.key === "wood_type" ? (variantSort.asc ? "↑" : "↓") : "–"}
                                        </span>
                                      </button>
                                    </TableHead>
                                    <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 hover:text-primary"
                                        onClick={() =>
                                          setVariantSort((prev) => ({
                                            key: "spec1",
                                            asc: prev.key === "spec1" ? !prev.asc : true,
                                          }))
                                        }
                                        aria-label={`依規格排序（目前為${
                                          variantSort.key === "spec1" && !variantSort.asc ? "降冪" : "升冪"
                                        }）`}
                                      >
                                        <span>規格</span>
                                        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                                          {variantSort.key === "spec1" ? (variantSort.asc ? "↑" : "↓") : "–"}
                                        </span>
                                      </button>
                                    </TableHead>
                                    <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 hover:text-primary"
                                        onClick={() =>
                                          setVariantSort((prev) => ({
                                            key: "dimension",
                                            asc: prev.key === "dimension" ? !prev.asc : true,
                                          }))
                                        }
                                        aria-label={`依尺寸排序（目前為${
                                          variantSort.key === "dimension" && !variantSort.asc ? "降冪" : "升冪"
                                        }）`}
                                      >
                                        <span>尺寸</span>
                                        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                                          {variantSort.key === "dimension" ? (variantSort.asc ? "↑" : "↓") : "–"}
                                        </span>
                                      </button>
                                    </TableHead>
                                    <TableHead className="text-xs font-semibold p-2 cursor-pointer hover:bg-accent/50 select-none">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 hover:text-primary"
                                        onClick={() =>
                                          setVariantSort((prev) => ({
                                            key: "base_price",
                                            asc: prev.key === "base_price" ? !prev.asc : true,
                                          }))
                                        }
                                        aria-label={`依定價排序（目前為${
                                          variantSort.key === "base_price" && !variantSort.asc ? "降冪" : "升冪"
                                        }）`}
                                      >
                                        <span>定價</span>
                                        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
                                          {variantSort.key === "base_price" ? (variantSort.asc ? "↑" : "↓") : "–"}
                                        </span>
                                      </button>
                                    </TableHead>
                                    <TableHead className="text-xs font-semibold p-2 min-w-[180px]">通路價格</TableHead>
                                    <TableHead className="text-xs font-semibold p-2 min-w-[120px]">操作</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {variants.length === 0 ? (
                                    <TableRow>
                                      <TableCell colSpan={6} className="h-16 text-center text-sm text-muted-foreground">
                                        尚無規格，請點「新增規格」建立。
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    [...variants]
                                      .sort((a, b) => {
                                        const ascFactor = variantSort.asc ? 1 : -1;
                                        switch (variantSort.key) {
                                          case "wood_type": {
                                            const aVal = a.wood_type || "";
                                            const bVal = b.wood_type || "";
                                            return ascFactor * aVal.localeCompare(bVal);
                                          }
                                          case "spec1": {
                                            const aVal = a.spec1 || "";
                                            const bVal = b.spec1 || "";
                                            return ascFactor * aVal.localeCompare(bVal);
                                          }
                                          case "dimension": {
                                            const aDims = [a.dimension_w ?? 0, a.dimension_d ?? 0, a.dimension_h ?? 0];
                                            const bDims = [b.dimension_w ?? 0, b.dimension_d ?? 0, b.dimension_h ?? 0];
                                            const aKey = aDims[0] * 1_000_000 + aDims[1] * 1_000 + aDims[2];
                                            const bKey = bDims[0] * 1_000_000 + bDims[1] * 1_000 + bDims[2];
                                            return ascFactor * (aKey - bKey);
                                          }
                                          case "base_price": {
                                            const aVal = a.base_price ?? Number.POSITIVE_INFINITY;
                                            const bVal = b.base_price ?? Number.POSITIVE_INFINITY;
                                            return ascFactor * (aVal - bVal);
                                          }
                                          case "product_code":
                                          default: {
                                            const aVal = a.product_code || "";
                                            const bVal = b.product_code || "";
                                            return ascFactor * aVal.localeCompare(bVal);
                                          }
                                        }
                                      })
                                      .map((v) => (
                                      <TableRow key={v.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                                        <TableCell className="text-sm p-2">{v.product_code || "—"}</TableCell>
                                        <TableCell className="text-sm p-2">{v.wood_type || "—"}</TableCell>
                                        <TableCell className="text-sm p-2">{v.spec1 || "—"}</TableCell>
                                        <TableCell className="text-sm p-2">{formatDim(v)}</TableCell>
                                        <TableCell className="text-sm p-2">{v.base_price != null ? v.base_price.toLocaleString() : "—"}</TableCell>
                                        <TableCell className="text-xs p-2 text-muted-foreground">
                                          {v.base_price == null ? (
                                            "—"
                                          ) : (
                                            (() => {
                                              const discounts = seriesDiscounts[v.series_id] ?? [];
                                              const rows = discounts
                                                .map((d) => {
                                                  const name = channelNameMap[d.channel_id];
                                                  if (!name) return null;
                                                  const price = Math.round(
                                                    v.base_price! * (1 - d.discount_percent / 100)
                                                  );
                                                  const pct = d.discount_percent;
                                                  const pctText =
                                                    Number.isFinite(pct) && pct !== 0
                                                      ? ` (${pct}%)`
                                                      : "";
                                                  return `${name}: ${price.toLocaleString()}${pctText}`;
                                                })
                                                .filter(Boolean) as string[];
                                              if (!rows.length) return "尚未設定";
                                              return (
                                                <div className="space-y-0.5">
                                                  {rows.map((text) => (
                                                    <div key={text}>{text}</div>
                                                  ))}
                                                </div>
                                              );
                                            })()
                                          )}
                                        </TableCell>
                                        <TableCell className="p-2">
                                          <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewVariant(v)} aria-label={`檢視 ${v.product_code}`}>
                                              <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditVariant(v)} aria-label={`修改 ${v.product_code}`}>
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDeleteVariant(v); }} aria-label={`刪除 ${v.product_code}`}>
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))
                                  )}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ViewSeriesDialog open={viewSeries != null} onOpenChange={(open) => !open && setViewSeries(null)} row={viewSeries} variants={viewSeries ? (variantsBySeries[viewSeries.id] ?? []) : []} />
      <EditSeriesDialog open={editSeries != null} onOpenChange={(open) => !open && setEditSeries(null)} row={editSeries} onSuccess={() => { fetchData(); setEditSeries(null); }} />
      <EditSeriesChannelDiscountDialog
        open={editDiscountSeries != null}
        onOpenChange={(open) => !open && setEditDiscountSeries(null)}
        series={editDiscountSeries}
        channels={channels}
        onSuccess={() => {
          setEditDiscountSeries(null);
        }}
      />
      <AddVariantDialog
        open={addVariantSeries != null}
        onOpenChange={(open) => !open && setAddVariantSeries(null)}
        series={addVariantSeries}
        onSuccess={() => {
          fetchData();
          setAddVariantSeries(null);
        }}
      />
      <ViewVariantDialog open={viewVariant != null} onOpenChange={(open) => !open && setViewVariant(null)} row={viewVariant} />
      <EditVariantDialog open={editVariant != null} onOpenChange={(open) => !open && setEditVariant(null)} row={editVariant} onSuccess={() => { fetchData(); setEditVariant(null); }} />

      <ConfirmDialog
        open={deleteConfirmSeries != null}
        onOpenChange={(open) => !open && setDeleteConfirmSeries(null)}
        title="是否確定刪除系列？"
        description={
          deleteConfirmSeries ? (
            <>
              <p className="font-medium text-foreground">系列：「{deleteConfirmSeries.name || "未命名"}」</p>
              {(variantsBySeries[deleteConfirmSeries.id] ?? []).length > 0 && (
                <p className="mt-2 text-muted-foreground">此系列下共有 {(variantsBySeries[deleteConfirmSeries.id] ?? []).length} 筆規格，將一併刪除。</p>
              )}
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDeleteSeries}
        destructive
      />
      <ConfirmDialog
        open={deleteConfirmVariant != null}
        onOpenChange={(open) => !open && setDeleteConfirmVariant(null)}
        title="是否確定刪除規格？"
        description={
          deleteConfirmVariant ? (
            <>
              <p className="font-medium text-foreground">規格：「{deleteConfirmVariant.product_code || "未命名"}」</p>
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDeleteVariant}
        destructive
      />
    </div>
  );
}
