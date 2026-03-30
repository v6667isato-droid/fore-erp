"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { ProcurementMaterialRow } from "@/types/procurement";

export interface AddMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 建立成功後回傳新列，供採購表單加入清單 */
  onCreated: (row: ProcurementMaterialRow) => void;
}

export function AddMaterialDialog({ open, onOpenChange, onCreated }: AddMaterialDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setItemCategory("");
      setSpec("");
      setUnit("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nameT = name.trimEnd();
    const catT = itemCategory.trimEnd();
    const specT = spec.trimEnd();
    if (!nameT.trim()) {
      setError("請輸入標準品名");
      return;
    }
    setSaving(true);
    const payload = {
      name: nameT,
      item_category: catT || null,
      spec: specT || null,
      unit: unit.trim() || null,
    };
    const { data, error: err } = await supabase.from("procurement_materials").insert(payload).select("id, name, item_category, spec, unit, notes, created_at").single();
    setSaving(false);
    if (err) {
      if (/duplicate key|unique constraint|23505/i.test(err.message)) {
        setError("已有相同品名與規格的物料，請改用主檔選取或調整規格欄位");
      } else {
        setError(err.message || "新增失敗");
      }
      toast.error(err.message || "新增失敗");
      return;
    }
    const row = data as ProcurementMaterialRow;
    toast.success("已新增物料主檔");
    onCreated(row);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-material-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增採購物料</Dialog.Title>
              <p id="add-material-desc" className="mt-1 text-sm text-muted-foreground">
                建立後可於採購時選取，自動帶入類別、規格、單位；相同品名＋規格不可重複。
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-name" className="text-xs text-muted-foreground">標準品名 *</label>
              <input
                ref={firstRef}
                id="add-material-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setName((s) => s.trimEnd())}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="例如：不鏽鋼板"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-cat" className="text-xs text-muted-foreground">物品類別</label>
              <input id="add-material-cat" type="text" value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} onBlur={() => setItemCategory((s) => s.trimEnd())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="選填" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-spec" className="text-xs text-muted-foreground">規格</label>
              <input id="add-material-spec" type="text" value={spec} onChange={(e) => setSpec(e.target.value)} onBlur={() => setSpec((s) => s.trimEnd())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="選填" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-unit" className="text-xs text-muted-foreground">預設單位</label>
              <input id="add-material-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="例如：kg、張" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "建立"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
