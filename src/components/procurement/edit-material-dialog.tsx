"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { ProcurementMaterialRow } from "@/types/procurement";

export interface EditMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ProcurementMaterialRow | null;
  onSaved: () => void;
}

export function EditMaterialDialog({ open, onOpenChange, row, onSaved }: EditMaterialDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [spec, setSpec] = useState("");
  const [spec2, setSpec2] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setName(row.name ?? "");
      setItemCategory(row.item_category ?? "");
      setSpec(row.spec ?? "");
      setSpec2(row.spec2 ?? "");
      setUnit(row.unit ?? "");
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
    if (!name.trimEnd().trim()) {
      setError("請輸入標準品名");
      return;
    }
    setSaving(true);
    const nameT = name.trimEnd();
    const catT = itemCategory.trimEnd();
    const specT = spec.trimEnd();
    const spec2T = spec2.trimEnd();
    const payload = {
      name: nameT,
      item_category: catT || null,
      spec: specT || null,
      spec2: spec2T || null,
      unit: unit.trim() || null,
    };
    const { error: err } = await supabase.from("procurement_materials").update(payload).eq("id", row.id);
    setSaving(false);
    if (err) {
      if (/duplicate key|unique constraint|23505/i.test(err.message)) {
        setError("已有相同品名、規格與規格2 的物料");
      } else {
        setError(err.message || "更新失敗");
      }
      toast.error(err.message || "更新失敗");
      return;
    }
    toast.success("已更新物料");
    onSaved();
    onOpenChange(false);
  }

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-material-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯採購物料</Dialog.Title>
              <p id="edit-material-desc" className="mt-1 text-sm text-muted-foreground">
                修改後若與其他物料「品名＋規格＋規格2」重複將無法儲存。
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
              <label htmlFor="edit-material-name" className="text-xs text-muted-foreground">標準品名 *</label>
              <input
                ref={firstRef}
                id="edit-material-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setName((s) => s.trimEnd())}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-material-cat" className="text-xs text-muted-foreground">物品類別</label>
              <input id="edit-material-cat" type="text" value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} onBlur={() => setItemCategory((s) => s.trimEnd())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-material-spec" className="text-xs text-muted-foreground">規格</label>
              <input id="edit-material-spec" type="text" value={spec} onChange={(e) => setSpec(e.target.value)} onBlur={() => setSpec((s) => s.trimEnd())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-material-spec2" className="text-xs text-muted-foreground">規格2</label>
              <input id="edit-material-spec2" type="text" value={spec2} onChange={(e) => setSpec2(e.target.value)} onBlur={() => setSpec2((s) => s.trimEnd())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-material-unit" className="text-xs text-muted-foreground">預設單位</label>
              <input id="edit-material-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
