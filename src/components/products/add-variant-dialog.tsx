"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_VARIANTS } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SeriesRow } from "@/types/products";

export interface AddVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: SeriesRow | null;
  onSuccess: () => void;
}

export function AddVariantDialog({ open, onOpenChange, series, onSuccess }: AddVariantDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [woodType, setWoodType] = useState("");
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && series) {
      setCode("");
      setWoodType("");
      setW("");
      setD("");
      setH("");
      setPrice("");
      setError(null);
    }
  }, [open, series]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!series) return;
    setError(null);
    if (!code.trim()) {
      setError("請輸入產品代碼");
      return;
    }
    setAdding(true);
    const payload = {
      series_id: series.id,
      product_code: code.trim(),
      wood_type: woodType.trim() || null,
      dimension_w: w.trim() ? Number(w) : null,
      dimension_d: d.trim() ? Number(d) : null,
      dimension_h: h.trim() ? Number(h) : null,
      base_price: price.trim() ? Number(price) : null,
    };
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).insert(payload);
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增規格失敗");
      setError(err.message || "新增規格失敗");
      return;
    }
    toast.success("已新增規格");
    onOpenChange(false);
    onSuccess();
  }

  if (!series) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-variant-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增規格</Dialog.Title>
              <p id="add-variant-desc" className="mt-1 text-sm text-muted-foreground">系列：{series.name}</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-variant-code" className="text-xs text-muted-foreground">產品代碼 *</label>
              <input ref={firstRef} id="add-variant-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
              {series.code_rule?.trim() && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  編碼原則：{series.code_rule.trim()}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-variant-wood" className="text-xs text-muted-foreground">木種</label>
              <input id="add-variant-wood" type="text" value={woodType} onChange={(e) => setWoodType(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-variant-w" className="text-xs text-muted-foreground">寬 W（cm）</label>
                <input id="add-variant-w" type="number" value={w} onChange={(e) => setW(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-variant-d" className="text-xs text-muted-foreground">深 D（cm）</label>
                <input id="add-variant-d" type="number" value={d} onChange={(e) => setD(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-variant-h" className="text-xs text-muted-foreground">高 H（cm）</label>
                <input id="add-variant-h" type="number" value={h} onChange={(e) => setH(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-variant-price" className="text-xs text-muted-foreground">基礎定價</label>
              <input id="add-variant-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="元" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={adding}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={adding}>{adding ? "新增中…" : "新增規格"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
