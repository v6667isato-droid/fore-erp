"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_SERIES } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SeriesRow } from "@/types/products";

export interface EditSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SeriesRow | null;
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = ["桌", "椅", "櫃", "層架", "其他"];

export function EditSeriesDialog({ open, onOpenChange, row, onSuccess }: EditSeriesDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [productionTime, setProductionTime] = useState("");
  const [codeRule, setCodeRule] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setName(row.name ?? "");
      setCategory(row.category ?? "");
      setNotes(row.notes ?? "");
      setProductionTime(row.production_time ?? "");
      setCodeRule(row.code_rule ?? "");
      setError(null);
    }
  }, [open, row]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!name.trim()) {
      setError("請輸入系列名稱");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim() || null,
      notes: notes.trim() || null,
      production_time: productionTime.trim() || null,
      code_rule: codeRule.trim() || null,
    };
    let { error: err } = await supabase.from(TABLE_PRODUCT_SERIES).update(payload).eq("id", row.id);
    if (err && /column .* does not exist/i.test(err.message ?? "")) {
      const { notes: _n, production_time: _p, code_rule: _c, ...rest } = payload as {
        notes?: string;
        production_time?: string;
        code_rule?: string;
      };
      const res = await supabase.from(TABLE_PRODUCT_SERIES).update(rest).eq("id", row.id);
      err = res.error;
    }
    if (err && /name/i.test(err.message ?? "")) {
      const altPayload = { series_name: name.trim(), category: category.trim() || null, notes: notes.trim() || null };
      const res = await supabase.from(TABLE_PRODUCT_SERIES).update(altPayload).eq("id", row.id);
      err = res.error;
    }
    setSaving(false);
    if (err) {
      toast.error(err.message || "更新系列失敗");
      setError(err.message || "更新系列失敗");
      return;
    }
    toast.success("已更新系列");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-series-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯系列</Dialog.Title>
              <p id="edit-series-desc" className="mt-1 text-sm text-muted-foreground">修改系列名稱、類別與備註</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-series-name" className="text-xs text-muted-foreground">系列名稱 *</label>
              <input ref={firstRef} id="edit-series-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-series-category" className="text-xs text-muted-foreground">類別</label>
              <input id="edit-series-category" list="edit-series-category-list" type="text" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <datalist id="edit-series-category-list">
                {CATEGORY_OPTIONS.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-series-production-time" className="text-xs text-muted-foreground">交期（週）</label>
              <div className="flex items-center gap-2">
                <input
                  id="edit-series-production-time"
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
              <label htmlFor="edit-series-notes" className="text-xs text-muted-foreground">產品備註</label>
              <input id="edit-series-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-series-code-rule" className="text-xs text-muted-foreground">編碼原則</label>
              <textarea
                id="edit-series-code-rule"
                value={codeRule}
                onChange={(e) => setCodeRule(e.target.value)}
                rows={2}
                className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="例：系列縮寫 + 材質 + 尺寸，如：CHA-OAK-120"
              />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
