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
import { Package, ChevronDown, ChevronRight, FileText, Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { AddSeriesDialog } from "@/components/products/add-series-dialog";
import { AddVariantDialog } from "@/components/products/add-variant-dialog";
import { EditSeriesDialog } from "@/components/products/edit-series-dialog";
import { EditSeriesContentDialog } from "@/components/products/edit-series-content-dialog";
import { EditVariantDialog } from "@/components/products/edit-variant-dialog";
import { ViewSeriesDialog } from "@/components/products/view-series-dialog";
import { ViewVariantDialog } from "@/components/products/view-variant-dialog";
import { toast } from "sonner";

/** 支援 name 或 series_name 欄位（Supabase 表可能用其中一種） */
function mapSeries(r: Record<string, unknown>): SeriesRow {
  const nameVal = r.name ?? r.series_name;
  return {
    id: String(r.id),
    name: String(nameVal ?? ""),
    category: String(r.category ?? ""),
    notes: r.notes != null ? String(r.notes) : null,
    design_concept: r.design_concept != null ? String(r.design_concept) : null,
    faq_scripts: r.faq_scripts != null ? String(r.faq_scripts) : null,
    social_media_copy: r.social_media_copy != null ? String(r.social_media_copy) : null,
    website_article: r.website_article != null ? String(r.website_article) : null,
    customization_rules: r.customization_rules != null ? String(r.customization_rules) : null,
    website: r.website != null ? String(r.website) : null,
  };
}

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

export function ProductsPage() {
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [variantsList, setVariantsList] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState("");
  const [viewSeries, setViewSeries] = useState<SeriesRow | null>(null);
  const [editSeries, setEditSeries] = useState<SeriesRow | null>(null);
  const [editContentSeries, setEditContentSeries] = useState<SeriesRow | null>(null);
  const [addVariantSeries, setAddVariantSeries] = useState<SeriesRow | null>(null);
  const [viewVariant, setViewVariant] = useState<VariantRow | null>(null);
  const [editVariant, setEditVariant] = useState<VariantRow | null>(null);

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

  const filteredSeries = useMemo(() => {
    if (!filterCategory) return seriesList;
    return seriesList.filter((s) => s.category === filterCategory);
  }, [seriesList, filterCategory]);

  async function fetchData() {
    setLoading(true);
    setLoadError(null);
    let seriesData: Record<string, unknown>[] | null = null;
    let variantsData: Record<string, unknown>[] = [];

    const seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT).order("id", { ascending: true });
    if (seriesRes.error) {
      const noWebsite = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_NO_WEBSITE).order("id", { ascending: true });
      if (!noWebsite.error) {
        seriesData = noWebsite.data as Record<string, unknown>[];
      }
      if (seriesData === null) {
        const fallback = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_MINIMAL).order("id", { ascending: true });
        if (!fallback.error) {
          seriesData = fallback.data as Record<string, unknown>[];
        } else {
          const minimal = await supabase.from(TABLE_PRODUCT_SERIES).select("id, name, category").order("id", { ascending: true });
          if (!minimal.error) {
            seriesData = minimal.data as Record<string, unknown>[];
          } else if (/name does not exist/i.test(seriesRes.error.message ?? "")) {
            const contentCols = SERIES_CONTENT_COLUMNS.join(", ");
            const bySeriesNameFull = await supabase.from(TABLE_PRODUCT_SERIES).select(`id, series_name, category, notes, ${contentCols}, website`).order("id", { ascending: true });
            if (!bySeriesNameFull.error) {
              seriesData = (bySeriesNameFull.data ?? []) as unknown as Record<string, unknown>[];
            } else {
              const bySeriesName = await supabase.from(TABLE_PRODUCT_SERIES).select("id, series_name, category").order("id", { ascending: true });
              if (!bySeriesName.error) {
                seriesData = bySeriesName.data as Record<string, unknown>[];
              } else {
                const altMin = await supabase.from(TABLE_PRODUCT_SERIES).select("id, series_name").order("id", { ascending: true });
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
      seriesData = seriesRes.data as Record<string, unknown>[];
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

  useEffect(() => {
    fetchData();
  }, []);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteVariant(v: VariantRow) {
    if (!confirm(`確定要刪除規格「${v.product_code || "未命名"}」？`)) return;
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
        <AddSeriesDialog onSuccess={fetchData} />
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
              <TableHead className="text-xs font-semibold p-2">系列名稱</TableHead>
              <TableHead className="text-xs font-semibold p-2">類別</TableHead>
              <TableHead className="text-xs font-semibold p-2">規格數</TableHead>
              <TableHead className="text-xs font-semibold p-2">網站</TableHead>
              <TableHead className="text-xs font-semibold p-2 min-w-[200px]" aria-label="操作">操作</TableHead>
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
              filteredSeries.map((series) => {
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
                        <span>{series.name || "—"}</span>
                        {series.notes?.trim() && <span className="ml-1.5 text-xs text-muted-foreground">{series.notes}</span>}
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
                      <TableCell className="p-2">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewSeries(series)} aria-label={`總覽 ${series.name}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditSeries(series)} aria-label={`編輯系列 ${series.name}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditContentSeries(series)} aria-label={`編輯文案 ${series.name}`}>
                            <FileText className="h-4 w-4" />
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
                                    <TableHead className="text-xs font-semibold p-2">代碼</TableHead>
                                    <TableHead className="text-xs font-semibold p-2">木種</TableHead>
                                    <TableHead className="text-xs font-semibold p-2">尺寸</TableHead>
                                    <TableHead className="text-xs font-semibold p-2">定價</TableHead>
                                    <TableHead className="text-xs font-semibold p-2 min-w-[120px]">操作</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {variants.length === 0 ? (
                                    <TableRow>
                                      <TableCell colSpan={5} className="h-16 text-center text-sm text-muted-foreground">
                                        尚無規格，請點「新增規格」建立。
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    variants.map((v) => (
                                      <TableRow key={v.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                                        <TableCell className="text-sm p-2">{v.product_code || "—"}</TableCell>
                                        <TableCell className="text-sm p-2">{v.wood_type || "—"}</TableCell>
                                        <TableCell className="text-sm p-2">{formatDim(v)}</TableCell>
                                        <TableCell className="text-sm p-2">{v.base_price != null ? v.base_price.toLocaleString() : "—"}</TableCell>
                                        <TableCell className="p-2">
                                          <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewVariant(v)} aria-label={`檢視 ${v.product_code}`}>
                                              <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditVariant(v)} aria-label={`修改 ${v.product_code}`}>
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteVariant(v)} aria-label={`刪除 ${v.product_code}`}>
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
      <EditSeriesContentDialog
        open={editContentSeries != null}
        onOpenChange={(open) => !open && setEditContentSeries(null)}
        row={editContentSeries}
        onSuccess={() => {
          fetchData();
          setEditContentSeries(null);
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
    </div>
  );
}
