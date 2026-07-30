"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PartDialog } from "@/components/inventory/part-dialog";
import { StockMovementDialog } from "@/components/inventory/stock-movement-dialog";
import { StocktakeDialog } from "@/components/inventory/stocktake-dialog";
import { AssignStocktakeDialog } from "@/components/inventory/assign-stocktake-dialog";
import { AssignMakePartsDialog } from "@/components/inventory/assign-make-parts-dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
  ClipboardList,
  UserPlus,
  Hammer,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PART_CATEGORIES,
  formatPartDimensions,
  type MaterialRow,
  type PartRow,
  type PartVariantStockRow,
} from "@/types/inventory";
import { buildSku, fetchMaterials } from "@/lib/part-variants";

export interface PartsTabProps {
  isAdmin?: boolean;
}

/** 一個系列區塊：軸零件走材質矩陣、無材質軸零件走單列 */
interface Section {
  key: string;
  name: string;
  axisParts: PartRow[];
  simpleParts: PartRow[];
}

const NO_SERIES_KEY = "__none__";

export function PartsTab({ isAdmin = false }: PartsTabProps) {
  const [parts, setParts] = useState<PartRow[]>([]);
  const [variants, setVariants] = useState<PartVariantStockRow[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [seriesList, setSeriesList] = useState<{ id: string; series_name: string }[]>([]);
  const [vendorNameById, setVendorNameById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSeries, setFilterSeries] = useState("");
  const [onlyNeedsReorder, setOnlyNeedsReorder] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<PartRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PartRow | null>(null);
  const [movementVariant, setMovementVariant] = useState<PartVariantStockRow | null>(null);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [assignStocktakeOpen, setAssignStocktakeOpen] = useState(false);
  const [assignMakeOpen, setAssignMakeOpen] = useState(false);

  const fetchParts = useCallback(async () => {
    setLoading(true);
    const [partsRes, variantsRes, materialsRes, vendorsRes, seriesRes] = await Promise.all([
      supabase
        .from("parts")
        .select(
          "id, part_no, name, category, unit, procurement_type, source_type, wood_species, series_id, has_material_axis, name_code, safety_stock, reorder_point, vendor_id, reference_unit_price, drawing_url, dim_length_mm, dim_width_mm, dim_thickness_mm, sop, is_component, notes, created_at",
        )
        .is("deleted_at", null),
      supabase.from("part_variant_stock_status").select("*"),
      fetchMaterials().catch(() => [] as MaterialRow[]),
      supabase.from("vendors").select("id, name").is("deleted_at", null),
      supabase.from("product_series").select("id, series_name").is("deleted_at", null).order("series_name"),
    ]);
    setLoading(false);
    if (partsRes.error || variantsRes.error) {
      toast.error(partsRes.error?.message || variantsRes.error?.message || "無法載入零件");
      setParts([]);
      setVariants([]);
      return;
    }
    setParts((partsRes.data as PartRow[]) ?? []);
    setVariants(
      ((((variantsRes.data ?? []) as unknown) as PartVariantStockRow[])).map((v) => ({
        ...v,
        current_stock: Number(v.current_stock ?? 0),
        needs_reorder: Boolean(v.needs_reorder),
        below_safety: Boolean(v.below_safety),
      })),
    );
    setMaterials(materialsRes);
    const vm = new Map<string, string>();
    for (const v of vendorsRes.data ?? []) vm.set(v.id, v.name);
    setVendorNameById(vm);
    setSeriesList((seriesRes.data as { id: string; series_name: string }[]) ?? []);
  }, []);

  useEffect(() => {
    void fetchParts();
  }, [fetchParts]);

  const variantsByPart = useMemo(() => {
    const m = new Map<string, PartVariantStockRow[]>();
    for (const v of variants) {
      const list = m.get(v.part_id);
      if (list) list.push(v);
      else m.set(v.part_id, [v]);
    }
    return m;
  }, [variants]);

  const seriesNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of seriesList) m.set(s.id, s.series_name);
    return m;
  }, [seriesList]);

  // 缺料顆數以「變體」計（每個材質分開算庫存）
  const reorderCount = useMemo(() => variants.filter((v) => v.needs_reorder).length, [variants]);

  const searchQ = search.trim().toLowerCase();

  const filteredParts = useMemo(() => {
    let list = parts;
    if (filterCategory) list = list.filter((p) => p.category === filterCategory);
    if (filterSeries === NO_SERIES_KEY) list = list.filter((p) => !p.series_id);
    else if (filterSeries) list = list.filter((p) => p.series_id === filterSeries);
    if (onlyNeedsReorder) {
      list = list.filter((p) => (variantsByPart.get(p.id) ?? []).some((v) => v.needs_reorder));
    }
    if (!searchQ) return list;
    return list.filter((p) => {
      if (p.name.toLowerCase().includes(searchQ)) return true;
      if ((p.wood_species || "").toLowerCase().includes(searchQ)) return true;
      if ((p.notes || "").toLowerCase().includes(searchQ)) return true;
      const vendor = p.vendor_id ? vendorNameById.get(p.vendor_id) : null;
      if ((vendor || "").toLowerCase().includes(searchQ)) return true;
      return (variantsByPart.get(p.id) ?? []).some(
        (v) =>
          v.sku.toLowerCase().includes(searchQ) ||
          (v.material_name || "").toLowerCase().includes(searchQ),
      );
    });
  }, [parts, filterCategory, filterSeries, onlyNeedsReorder, searchQ, variantsByPart, vendorNameById]);

  // 分區：各系列（依名稱排序）＋最後的共用區；區內固定依零件名稱排序
  const sections = useMemo(() => {
    const byName = (a: PartRow, b: PartRow) => a.name.localeCompare(b.name, "zh-Hant");
    const build = (key: string, name: string, list: PartRow[]): Section => ({
      key,
      name,
      axisParts: list.filter((p) => p.has_material_axis).sort(byName),
      simpleParts: list.filter((p) => !p.has_material_axis).sort(byName),
    });
    const out: Section[] = [];
    for (const s of seriesList) {
      const list = filteredParts.filter((p) => p.series_id === s.id);
      if (list.length > 0) out.push(build(s.id, s.series_name, list));
    }
    const shared = filteredParts.filter((p) => !p.series_id || !seriesNameById.has(p.series_id));
    if (shared.length > 0) out.push(build(NO_SERIES_KEY, "共用／不分系列", shared));
    return out;
  }, [filteredParts, seriesList, seriesNameById]);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 補建缺格變體（矩陣「—」格／無變體的單列零件） */
  async function createVariant(part: PartRow, materialCode: string | null) {
    const sku = buildSku({
      seriesName: part.series_id ? (seriesNameById.get(part.series_id) ?? null) : null,
      materialCode,
      nameCode: part.name_code,
      fallbackName: part.name,
    });
    const { error } = await supabase
      .from("part_variants")
      .insert({ part_id: part.id, material_code: materialCode, sku });
    if (error) {
      toast.error(error.message || `建立變體失敗（${sku}）`);
      return;
    }
    toast.success(`已建立變體 ${sku}`);
    void fetchParts();
  }

  async function performDelete() {
    if (!deleteRow) return;
    const id = deleteRow.id;
    const variantIds = (variantsByPart.get(id) ?? []).map((v) => v.id);
    setDeleteRow(null);
    const now = new Date().toISOString();
    const { error } = await supabase.from("parts").update({ deleted_at: now }).eq("id", id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    const { error: varErr } = await supabase
      .from("part_variants")
      .update({ deleted_at: now })
      .eq("part_id", id)
      .is("deleted_at", null);
    if (varErr) toast.error(`零件已刪除，但變體軟刪除失敗：${varErr.message}`);
    // 連動移除 BOM 引用，避免用料表殘留已刪除零件、工單開工誤扣其庫存
    const { error: lineErr } = await supabase.from("bom_lines").delete().eq("part_id", id);
    const { error: lineVarErr } =
      variantIds.length > 0
        ? await supabase.from("bom_lines").delete().in("part_variant_id", variantIds)
        : { error: null };
    // 舊 bom_items 過渡期仍在使用，一併清除
    const { error: bomErr } = await supabase.from("bom_items").delete().eq("part_id", id);
    if (lineErr || lineVarErr || bomErr) {
      toast.error(
        `零件已刪除，但清除 BOM 引用失敗：${lineErr?.message || lineVarErr?.message || bomErr?.message}`,
      );
    } else {
      toast.success("已刪除零件（含其變體與 BOM 用料引用）");
    }
    void fetchParts();
  }

  /** 零件名稱＋標籤＋次要資訊（矩陣列與單列共用） */
  function PartMeta({ p }: { p: PartRow }) {
    const dims = formatPartDimensions(p);
    return (
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {p.name}
          {p.wood_species && (
            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">{p.wood_species}</span>
          )}
          {p.source_type === "自製" && (
            <span className="ml-1.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-400 align-middle">自製</span>
          )}
          {p.is_component && (
            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">組件</span>
          )}
        </p>
        {(dims || p.drawing_url) && (
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {dims && <span className="tabular-nums">{dims} mm</span>}
            {p.drawing_url && (
              <a
                href={p.drawing_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
                aria-label={`開啟 ${p.name} 尺寸圖`}
              >
                <ExternalLink className="h-3 w-3" />
                圖面
              </a>
            )}
          </p>
        )}
      </div>
    );
  }

  function StockCell({ v, sourceType }: { v: PartVariantStockRow; sourceType: string }) {
    return (
      <button
        type="button"
        onClick={() => setMovementVariant(v)}
        className="inline-flex min-h-9 items-center justify-end gap-1 rounded-md px-2 py-1 hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
        title={`${v.sku}：庫存異動（進料／領用／盤點）`}
        aria-label={`登錄 ${v.sku} 庫存異動`}
      >
        <span
          className={cn(
            "font-medium tabular-nums text-sm",
            v.needs_reorder ? "text-destructive" : v.below_safety ? "text-amber-600 dark:text-amber-400" : "text-foreground",
          )}
        >
          {v.current_stock}
        </span>
        <span className="text-xs text-muted-foreground">{v.unit}</span>
        {v.needs_reorder && (
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            aria-label={sourceType === "自製" ? "低於發注點（排加工）" : "低於發注點（補貨）"}
          />
        )}
      </button>
    );
  }

  function AdminActions({ p }: { p: PartRow }) {
    if (!isAdmin) return null;
    return (
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(p)} aria-label={`編輯 ${p.name}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => setDeleteRow(p)}
          aria-label={`刪除 ${p.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // 只在首次載入時整頁顯示載入中；重抓（存檔後刷新）保留列表與已掛載的 dialog
  if (loading && parts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" role="status">
        載入零件主檔中…
      </div>
    );
  }

  const emptyMessage = parts.length === 0 ? "尚無零件，請新增" : "無符合篩選或搜尋的零件";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          目前庫存由庫存異動紀錄加總計算。共 {parts.length} 顆零件
          {reorderCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyNeedsReorder((v) => !v)}
              className={cn(
                "ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                onlyNeedsReorder
                  ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400",
              )}
              aria-pressed={onlyNeedsReorder}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {reorderCount} 項待補貨
            </button>
          )}
        </p>
        {isAdmin && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={() => setAssignMakeOpen(true)} disabled={parts.length === 0}>
              <Hammer className="h-4 w-4 mr-1.5" />
              指派製作
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={() => setAssignStocktakeOpen(true)} disabled={parts.length === 0}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              指派盤點
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={() => setStocktakeOpen(true)} disabled={parts.length === 0}>
              <ClipboardList className="h-4 w-4 mr-1.5" />
              盤點模式
            </Button>
            <Button type="button" className="h-9" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              新增零件
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-[14rem]">
          <label htmlFor="part-filter-category" className="text-xs text-muted-foreground">篩選分類</label>
          <select
            id="part-filter-category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依零件分類篩選"
          >
            <option value="">全部分類</option>
            {PART_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-[13rem]">
          <label htmlFor="part-filter-series" className="text-xs text-muted-foreground">篩選系列</label>
          <select
            id="part-filter-series"
            value={filterSeries}
            onChange={(e) => setFilterSeries(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依產品系列篩選"
          >
            <option value="">全部系列</option>
            <option value={NO_SERIES_KEY}>（共用／不分系列）</option>
            {seriesList.map((s) => (
              <option key={s.id} value={s.id}>{s.series_name}</option>
            ))}
          </select>
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋名稱、SKU、材質、供應商、備註…"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="搜尋零件"
          />
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        sections.map((sec) => {
          // 搜尋時自動展開有命中的區（無命中的區已被整段過濾掉）
          const expanded = searchQ ? true : !collapsed.has(sec.key);
          const count = sec.axisParts.length + sec.simpleParts.length;
          return (
            <div key={sec.key} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(sec.key)}
                className="flex h-11 w-full items-center justify-between gap-3 px-4 text-left hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
              >
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{sec.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {count} 顆零件
                  <ChevronDown className={cn("h-4 w-4 transition-transform", !expanded && "-rotate-90")} aria-hidden />
                </span>
              </button>

              {expanded && (
                <div className="border-t border-border">
                  {sec.axisParts.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th className="sticky left-0 z-10 bg-card p-2 pl-4 text-xs font-semibold text-muted-foreground">零件</th>
                            {materials.map((m) => (
                              <th key={m.code} className="whitespace-nowrap p-2 text-right text-xs font-semibold text-muted-foreground">
                                {m.name_zh}
                              </th>
                            ))}
                            {isAdmin && <th className="p-2 pr-4 text-right text-xs font-semibold text-muted-foreground">操作</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {sec.axisParts.map((p) => {
                            const vs = variantsByPart.get(p.id) ?? [];
                            return (
                              <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                                <td className="sticky left-0 z-10 min-w-[10rem] bg-card p-2 pl-4 align-top">
                                  <PartMeta p={p} />
                                </td>
                                {materials.map((m) => {
                                  const v = vs.find((x) => x.material_code === m.code);
                                  return (
                                    <td key={m.code} className="whitespace-nowrap p-2 text-right align-top">
                                      {v ? (
                                        <StockCell v={v} sourceType={p.source_type} />
                                      ) : (
                                        <span className="inline-flex min-h-9 items-center justify-end gap-1">
                                          <span className="text-sm text-muted-foreground">—</span>
                                          {isAdmin && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-muted-foreground"
                                              onClick={() => void createVariant(p, m.code)}
                                              aria-label={`建立 ${p.name} ${m.name_zh} 變體`}
                                              title={`建立 ${m.name_zh} 變體`}
                                            >
                                              <Plus className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                                {isAdmin && (
                                  <td className="whitespace-nowrap p-2 pr-4 text-right align-top">
                                    <AdminActions p={p} />
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sec.simpleParts.length > 0 && (
                    <div className={cn(sec.axisParts.length > 0 && "border-t border-border")}>
                      {sec.simpleParts.map((p) => {
                        const v = (variantsByPart.get(p.id) ?? [])[0] ?? null;
                        return (
                          <div
                            key={p.id}
                            className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 last:border-b-0 hover:bg-muted/20 sm:flex-nowrap"
                          >
                            {v ? (
                              <button
                                type="button"
                                onClick={() => setMovementVariant(v)}
                                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`登錄 ${v.sku} 庫存異動`}
                                title={`${v.sku}：庫存異動（進料／領用／盤點）`}
                              >
                                <div className="min-w-0 flex-1">
                                  <PartMeta p={p} />
                                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{v.sku}</p>
                                </div>
                                <span className="flex shrink-0 items-center gap-1">
                                  <span
                                    className={cn(
                                      "text-sm font-medium tabular-nums",
                                      v.needs_reorder ? "text-destructive" : v.below_safety ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                                    )}
                                  >
                                    {v.current_stock}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{v.unit}</span>
                                  {v.needs_reorder && (
                                    <AlertTriangle
                                      className="h-3.5 w-3.5 shrink-0 text-destructive"
                                      aria-label={p.source_type === "自製" ? "低於發注點（排加工）" : "低於發注點（補貨）"}
                                    />
                                  )}
                                </span>
                              </button>
                            ) : (
                              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <PartMeta p={p} />
                                </div>
                                <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                                  —
                                  {isAdmin && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground"
                                      onClick={() => void createVariant(p, null)}
                                      aria-label={`建立 ${p.name} 庫存變體`}
                                      title="補建庫存變體"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </span>
                              </div>
                            )}
                            <AdminActions p={p} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      <PartDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        onSaved={() => void fetchParts()}
      />

      <PartDialog
        open={editRow != null}
        onOpenChange={(o) => !o && setEditRow(null)}
        row={editRow}
        onSaved={() => void fetchParts()}
      />

      <StockMovementDialog
        open={movementVariant != null}
        onOpenChange={(o) => !o && setMovementVariant(null)}
        variant={movementVariant}
        onSaved={() => void fetchParts()}
      />

      <StocktakeDialog
        open={stocktakeOpen}
        onOpenChange={setStocktakeOpen}
        onSaved={() => void fetchParts()}
      />

      <AssignStocktakeDialog open={assignStocktakeOpen} onOpenChange={setAssignStocktakeOpen} />

      <AssignMakePartsDialog open={assignMakeOpen} onOpenChange={setAssignMakeOpen} />

      <ConfirmDialog
        open={deleteRow != null}
        onOpenChange={(open) => !open && setDeleteRow(null)}
        title="是否確定刪除此零件？"
        description={
          deleteRow ? (
            <>
              <p className="font-medium text-foreground">
                {deleteRow.series_id ? `${seriesNameById.get(deleteRow.series_id) ?? "—"}｜` : ""}
                {deleteRow.name}
              </p>
              <p className="mt-2 text-muted-foreground text-sm">
                為軟刪除：歷史庫存異動紀錄保留，僅自主檔清單隱藏；其全部材質變體一併移除，各 BOM 中引用此零件的用料列也會刪除。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
