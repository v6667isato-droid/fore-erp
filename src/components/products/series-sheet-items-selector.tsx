"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_VARIANTS } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";

interface SheetItemRow {
  id: string;
  product_code: string;
  dims: string;
}

export interface SeriesSheetItemsSelectorProps {
  seriesId: string;
  /** 已勾選的規格 id（有序，即介紹表顯示順序）；父層儲存時寫回 show_on_sheet＋sheet_sort_order */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/**
 * 介紹表品項多選＋排序：列出系列所有規格（排除訂製款），操作邏輯與色樣選擇器一致。
 * 勾選＝顯示於介紹表（show_on_sheet），順序＝sheet_sort_order。
 */
export function SeriesSheetItemsSelector({
  seriesId,
  value,
  onChange,
  disabled = false,
}: SeriesSheetItemsSelectorProps) {
  const [items, setItems] = useState<SheetItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from(TABLE_PRODUCT_VARIANTS)
        .select("id, product_code, dimension_w, dimension_d, dimension_h, is_custom_order")
        .eq("series_id", seriesId)
        .is("deleted_at", null)
        .order("product_code", { ascending: true });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message || "載入規格失敗");
        setLoading(false);
        return;
      }
      setItems(
        ((data ?? []) as Record<string, unknown>[])
          .filter((r) => r.is_custom_order !== true)
          .map((r) => ({
            id: String(r.id),
            product_code: String(r.product_code ?? ""),
            dims: ["w", "d", "h"]
              .map((k) => {
                const v = r[`dimension_${k}`];
                return v != null ? `${k.toUpperCase()}${v}` : null;
              })
              .filter(Boolean)
              .join("×"),
          }))
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedSet = useMemo(() => new Set(value), [value]);

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  function move(id: string, dir: -1 | 1) {
    const idx = value.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= value.length) return;
    const arr = [...value];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onChange(arr);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">載入規格清單中…</p>;
  }
  if (loadError) {
    return <p className="text-sm text-destructive break-all">{loadError}</p>;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">此系列尚無規格（訂製款不列入介紹表）。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((it) => {
          const checked = selectedSet.has(it.id);
          return (
            <label
              key={it.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                disabled && "pointer-events-none opacity-60"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(it.id)}
                className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                disabled={disabled}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">
                  {it.product_code}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {it.dims || "—"}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {value.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            顯示順序（介紹表線圖格依此排序；同款不同木種仍會合併為一格）
          </span>
          <ul className="flex flex-col gap-1">
            {value.map((id, idx) => {
              const it = byId.get(id);
              if (!it) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {it.product_code}
                    <span className="ml-2 text-[10px] text-muted-foreground">{it.dims}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={disabled || idx === 0}
                    onClick={() => move(id, -1)}
                    aria-label={`${it.product_code} 上移`}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={disabled || idx === value.length - 1}
                    onClick={() => move(id, 1)}
                    aria-label={`${it.product_code} 下移`}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
