"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_SERIES } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

export interface AddSeriesDialogProps {
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = ["桌", "椅", "櫃", "層架", "其他"];

export function AddSeriesDialog({ onSuccess }: AddSeriesDialogProps) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [productionTime, setProductionTime] = useState("");
  const [codeRule, setCodeRule] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCategory("");
      setNotes("");
      setProductionTime("");
      setCodeRule("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("請輸入系列名稱");
      return;
    }
    setAdding(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim() || null,
      notes: notes.trim() || null,
      production_time: productionTime.trim() || null,
      code_rule: codeRule.trim() || null,
    };
    let { error: err } = await supabase.from(TABLE_PRODUCT_SERIES).insert(payload);
    // 若資料表使用 series_name 而非 name，改用 series_name 重試
    const isNameColumnError = err && /'name' column|name.*(does not exist|schema cache)|Could not find.*name/i.test(err.message ?? "");
    if (err && /column .* does not exist/i.test(err.message ?? "") && !isNameColumnError) {
      const { notes: _n, production_time: _p, code_rule: _c, ...rest } = payload as {
        notes?: string;
        production_time?: string;
        code_rule?: string;
      };
      const res = await supabase.from(TABLE_PRODUCT_SERIES).insert(rest);
      err = res.error;
    }
    if (err && isNameColumnError) {
      const altPayload = { series_name: name.trim(), category: category.trim() || null, notes: notes.trim() || null };
      const res = await supabase.from(TABLE_PRODUCT_SERIES).insert(altPayload);
      err = res.error;
    }
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增系列失敗");
      setError(err.message || "新增系列失敗");
      return;
    }
    toast.success("已新增系列");
    setOpen(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          新增系列
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-series-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增系列</Dialog.Title>
              <p id="add-series-desc" className="mt-1 text-sm text-muted-foreground">建立產品系列後，可在此管理文案與規格。</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-series-name" className="text-xs text-muted-foreground">系列名稱 *</label>
              <input ref={firstRef} id="add-series-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="系列名稱" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-series-category" className="text-xs text-muted-foreground">類別</label>
              <input id="add-series-category" list="add-series-category-list" type="text" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="例：桌、椅" />
              <datalist id="add-series-category-list">
                {CATEGORY_OPTIONS.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-series-production-time" className="text-xs text-muted-foreground">交期（週）</label>
              <div className="flex items-center gap-2">
                <input
                  id="add-series-production-time"
                  type="number"
                  min={0}
                  step="any"
                  value={productionTime}
                  onChange={(e) => setProductionTime(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例如：3"
                />
                <span className="text-xs text-muted-foreground shrink-0">週</span>
              </div>
              <span className="text-[11px] text-muted-foreground">以週為單位輸入交期，僅做文字紀錄。</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-series-notes" className="text-xs text-muted-foreground">產品備註</label>
              <input id="add-series-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="顯示在系列名稱旁" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-series-code-rule" className="text-xs text-muted-foreground">編碼原則</label>
              <textarea
                id="add-series-code-rule"
                value={codeRule}
                onChange={(e) => setCodeRule(e.target.value)}
                rows={2}
                className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="例：系列縮寫 + 材質 + 尺寸，如：CHA-OAK-120"
              />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={adding}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={adding}>{adding ? "新增中…" : "新增系列"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
