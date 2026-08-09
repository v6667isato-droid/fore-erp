"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_MATERIAL_SWATCHES, SWATCH_SELECT } from "@/lib/products-db";
import type { SwatchRow } from "@/types/products";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";

function mapSwatch(r: Record<string, unknown>): SwatchRow {
  return {
    id: String(r.id),
    category:
      r.category === "fabric" || r.category === "door" || r.category === "cloth"
        ? r.category
        : "wood",
    name: String(r.name ?? ""),
    name_en: r.name_en != null ? String(r.name_en) : null,
    image_url: r.image_url != null && String(r.image_url) ? String(r.image_url) : null,
    sort_order: Number(r.sort_order ?? 0),
    is_active: r.is_active !== false,
  };
}

export interface SeriesSwatchesSelectorProps {
  /** 已勾選的色樣 id（有序，即介紹表顯示順序） */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/**
 * 系列介紹表色樣多選器：從 material_swatches 勾選並排序。
 * 已停用色樣不出現在可勾清單，但若先前已勾選仍保留（顯示「已停用」標記）。
 */
export function SeriesSwatchesSelector({ value, onChange, disabled = false }: SeriesSwatchesSelectorProps) {
  const [swatches, setSwatches] = useState<SwatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from(TABLE_MATERIAL_SWATCHES)
        .select(SWATCH_SELECT)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message || "載入色樣失敗");
        setLoading(false);
        return;
      }
      setSwatches(((data ?? []) as Record<string, unknown>[]).map(mapSwatch));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(swatches.map((s) => [s.id, s])), [swatches]);
  const selectedSet = useMemo(() => new Set(value), [value]);
  /** 可勾清單：啟用中，或雖停用但已勾選（讓使用者能看到並取消） */
  const selectable = useMemo(
    () => swatches.filter((s) => s.is_active || selectedSet.has(s.id)),
    [swatches, selectedSet]
  );
  const woodList = selectable.filter((s) => s.category === "wood");
  const doorList = selectable.filter((s) => s.category === "door");
  const fabricList = selectable.filter((s) => s.category === "fabric");
  const clothList = selectable.filter((s) => s.category === "cloth");

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
    return <p className="text-sm text-muted-foreground">載入色樣清單中…</p>;
  }
  if (loadError) {
    return <p className="text-sm text-destructive break-all">{loadError}</p>;
  }
  if (swatches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        尚無色樣主檔。請先到「產品資料 → 材料色樣」建立材種／座墊／布樣色樣。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {[
        { label: "材種", list: woodList },
        { label: "門片種類", list: doorList },
        { label: "座墊", list: fabricList },
        { label: "布樣", list: clothList },
      ].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((s) => {
                const checked = selectedSet.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                      checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                      disabled && "pointer-events-none opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                      disabled={disabled}
                    />
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                      {s.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.image_url} alt={s.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[8px] text-muted-foreground">無照</span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{s.name}</span>
                      <span className={cn("block truncate text-[10px]", !s.image_url && s.is_active ? "text-accent-warn" : "text-muted-foreground")}>
                        {!s.is_active ? "已停用" : !s.image_url ? "缺照片（介紹表不會顯示）" : s.name_en?.trim() || ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )
      )}

      {value.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            顯示順序（介紹表上材種 → 門片 → 座墊 → 布樣分群，各群內依此排序）
          </span>
          <ul className="flex flex-col gap-1">
            {value.map((id, idx) => {
              const s = byId.get(id);
              if (!s) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                    {s.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image_url} alt={s.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[8px] text-muted-foreground">無照</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {s.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {s.category === "wood" ? "材種" : s.category === "door" ? "門片" : s.category === "cloth" ? "布樣" : "座墊"}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={disabled || idx === 0}
                    onClick={() => move(id, -1)}
                    aria-label={`${s.name} 上移`}
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
                    aria-label={`${s.name} 下移`}
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
