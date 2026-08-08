"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileSpreadsheet, Printer, X } from "lucide-react";
import { toast } from "sonner";
import type { SeriesRow, VariantRow } from "@/types/products";
import { exportPriceListCsv } from "@/components/products/export-price-list-csv";
import {
  defaultPriceListValidUntil,
  priceListCategoryLabel,
  priceListFiltersFromSelection,
} from "@/lib/price-list";

export interface PriceListExportDialogProps {
  seriesList: SeriesRow[];
  variantsList: VariantRow[];
  categories: string[];
}

type ScopeMode = "category" | "series";

/**
 * 價目表產出：選擇範圍（全部＝類別全勾 / 依類別 / 手動勾選產品）＋有效期限，
 * 開啟 /print/price-list 即時預覽與列印。只列 show_on_sheet = true 的規格。
 */
export function PriceListExportDialog({
  seriesList,
  variantsList,
  categories,
}: PriceListExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ScopeMode>("category");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(new Set());
  const [validUntil, setValidUntil] = useState("");

  /** 有勾「顯示於價目表」規格的系列數（供提示） */
  const sheetVariantCountBySeries = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of variantsList) {
      if (v.show_on_price_list !== true || v.is_custom_order) continue;
      map[v.series_id] = (map[v.series_id] ?? 0) + 1;
    }
    return map;
  }, [variantsList]);

  const sortedSeries = useMemo(
    () =>
      [...seriesList].sort((a, b) => {
        const cat = (a.category || "").localeCompare(b.category || "", "zh-Hant");
        if (cat !== 0) return cat;
        return (a.name || "").localeCompare(b.name || "", "zh-Hant");
      }),
    [seriesList]
  );

  useEffect(() => {
    if (open) {
      setMode("category");
      setSelected(new Set(categories));
      setSelectedSeries(new Set());
      setValidUntil(defaultPriceListValidUntil());
    }
  }, [open, categories]);

  function toggleCategory(cat: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleSeries(id: string) {
    setSelectedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 類別模式回傳 categoryFilters（null=未選）；系列模式回傳 null 交由 seriesFilters 判斷 */
  function resolveCategoryFilters(): string[] | null {
    return priceListFiltersFromSelection(selected, categories);
  }

  function resolveScope(): { categoryFilters: string[]; seriesIdFilters: string[] } | null {
    if (mode === "category") {
      const filters = resolveCategoryFilters();
      if (filters === null) {
        toast.info("請至少選擇一個類別");
        return null;
      }
      return { categoryFilters: filters, seriesIdFilters: [] };
    }
    if (selectedSeries.size === 0) {
      toast.info("請至少勾選一個產品");
      return null;
    }
    return { categoryFilters: [], seriesIdFilters: [...selectedSeries] };
  }

  function buildPrintUrl(scope: { categoryFilters: string[]; seriesIdFilters: string[] }): string {
    const params = new URLSearchParams();
    for (const c of scope.categoryFilters) params.append("category", c);
    for (const s of scope.seriesIdFilters) params.append("series", s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) params.set("valid", validUntil);
    const qs = params.toString();
    return qs ? `/print/price-list?${qs}` : "/print/price-list";
  }

  function handleExportCsv() {
    const scope = resolveScope();
    if (!scope) return;
    const ok = exportPriceListCsv(
      seriesList,
      variantsList,
      scope.categoryFilters,
      scope.seriesIdFilters
    );
    if (!ok) {
      toast.info("所選範圍沒有勾選「顯示於價目表」的規格");
      return;
    }
    toast.success(
      mode === "category"
        ? `已匯出價目表 CSV（${priceListCategoryLabel(scope.categoryFilters)}）`
        : `已匯出價目表 CSV（${scope.seriesIdFilters.length} 個產品）`
    );
    setOpen(false);
  }

  function handleOpenPrint() {
    const scope = resolveScope();
    if (!scope) return;
    window.open(buildPrintUrl(scope), "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  const allSelected = categories.length > 0 && selected.size === categories.length;
  const noneSelected = mode === "category" ? selected.size === 0 : selectedSeries.size === 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="outline"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={!seriesList.length || !variantsList.length}
          aria-label="產出價目表"
        >
          <FileSpreadsheet className="h-4 w-4" />
          價目表
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(100vw-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">產出價目表</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground leading-relaxed">
                只列出勾選「顯示於價目表」的規格；列印頁為直式 A4，依產品分組，可切換中英版本。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {/* 範圍模式 */}
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="tablist" aria-label="選擇範圍">
              {(
                [
                  { key: "category", label: "全部／依類別" },
                  { key: "series", label: "手動勾選產品" },
                ] as { key: ScopeMode; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "category" ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">產品類別（全勾＝全部產品）</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline disabled:opacity-40"
                      onClick={() => setSelected(new Set(categories))}
                      disabled={allSelected || !categories.length}
                    >
                      全選
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:underline disabled:opacity-40"
                      onClick={() => setSelected(new Set())}
                      disabled={selected.size === 0}
                    >
                      清除
                    </button>
                  </div>
                </div>
                <div
                  className="mt-2 max-h-40 overflow-y-auto rounded-md border border-input bg-background p-2 space-y-0.5"
                  role="group"
                  aria-label="選擇產品類別"
                >
                  {categories.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground text-center">尚無類別資料</p>
                  ) : (
                    categories.map((c) => (
                      <label
                        key={c}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-input accent-primary"
                          checked={selected.has(c)}
                          onChange={() => toggleCategory(c)}
                        />
                        <span className="text-foreground">{c}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  勾選要列入的產品（已選 {selectedSeries.size}）
                </span>
                <div
                  className="mt-2 max-h-56 overflow-y-auto rounded-md border border-input bg-background p-2 space-y-0.5"
                  role="group"
                  aria-label="勾選產品"
                >
                  {sortedSeries.map((s) => {
                    const count = sheetVariantCountBySeries[s.id] ?? 0;
                    return (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-input accent-primary"
                          checked={selectedSeries.has(s.id)}
                          onChange={() => toggleSeries(s.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {s.name || "未命名"}
                          {s.category?.trim() && (
                            <span className="ml-1.5 text-[11px] text-muted-foreground">{s.category}</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            count > 0 ? "text-muted-foreground" : "text-accent-warn"
                          )}
                        >
                          {count > 0 ? `${count} 規格` : "無勾選規格"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 有效期限 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="price-list-valid-until" className="text-xs font-medium text-muted-foreground">
                有效期限（預設製表日 + 3 個月）
              </label>
              <input
                id="price-list-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="h-9 w-full max-w-[12rem] rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-9 flex-1 text-xs"
                onClick={handleExportCsv}
                disabled={noneSelected}
              >
                <FileSpreadsheet className="h-4 w-4" />
                匯出 CSV
              </Button>
              <Button
                type="button"
                className="h-9 flex-1 text-xs"
                onClick={handleOpenPrint}
                disabled={noneSelected}
              >
                <Printer className="h-4 w-4" />
                預覽 / 列印 PDF
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
