"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Printer, X } from "lucide-react";
import { toast } from "sonner";
import type { SeriesRow, VariantRow } from "@/types/products";
import { exportPriceListCsv } from "@/components/products/export-price-list-csv";
import {
  priceListCategoryLabel,
  priceListFiltersFromSelection,
} from "@/lib/price-list";

export interface PriceListExportDialogProps {
  seriesList: SeriesRow[];
  variantsList: VariantRow[];
  categories: string[];
}

export function PriceListExportDialog({
  seriesList,
  variantsList,
  categories,
}: PriceListExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(categories));
  }, [open, categories]);

  function toggleCategory(cat: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(categories));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function resolveFilters(): string[] | null {
    return priceListFiltersFromSelection(selected, categories);
  }

  function buildPrintUrl(filters: string[]): string {
    const params = new URLSearchParams();
    for (const c of filters) params.append("category", c);
    const qs = params.toString();
    return qs ? `/print/price-list?${qs}` : "/print/price-list";
  }

  function handleExportCsv() {
    const filters = resolveFilters();
    if (filters === null) {
      toast.info("請至少選擇一個類別");
      return;
    }
    const ok = exportPriceListCsv(seriesList, variantsList, filters);
    if (!ok) {
      toast.info("所選類別目前沒有可匯出的規格");
      return;
    }
    toast.success(`已匯出價目表 CSV（${priceListCategoryLabel(filters)}）`);
    setOpen(false);
  }

  function handleOpenPrint() {
    const filters = resolveFilters();
    if (filters === null) {
      toast.info("請至少選擇一個類別");
      return;
    }
    window.open(buildPrintUrl(filters), "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  const allSelected = categories.length > 0 && selected.size === categories.length;
  const noneSelected = selected.size === 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="outline"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={!seriesList.length || !variantsList.length}
          aria-label="匯出價目表"
        >
          <FileSpreadsheet className="h-4 w-4" />
          價目表
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(100vw-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">匯出價目表</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground leading-relaxed">
                對外建議售價（基礎定價）。CSV 不含圖片；列印 PDF 含產品圖。可勾選多個類別。
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
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">產品類別</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline disabled:opacity-40"
                    onClick={selectAll}
                    disabled={allSelected || !categories.length}
                  >
                    全選
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:underline disabled:opacity-40"
                    onClick={clearAll}
                    disabled={noneSelected}
                  >
                    清除
                  </button>
                </div>
              </div>
              <div
                className="mt-2 max-h-48 overflow-y-auto rounded-md border border-input bg-background p-2 space-y-0.5"
                role="group"
                aria-label="選擇產品類別"
              >
                {categories.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground text-center">尚無類別資料</p>
                ) : (
                  categories.map((c) => {
                    const checked = selected.has(c);
                    return (
                      <label
                        key={c}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-input accent-primary"
                          checked={checked}
                          onChange={() => toggleCategory(c)}
                        />
                        <span className="text-foreground">{c}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {noneSelected
                  ? "請至少勾選一個類別"
                  : allSelected
                    ? `已選全部（${categories.length} 類）`
                    : `已選 ${selected.size} / ${categories.length} 類`}
              </p>
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
                列印 PDF
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
