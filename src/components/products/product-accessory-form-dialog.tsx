"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_ACCESSORIES,
  PRODUCT_ACCESSORY_CATEGORY_OPTIONS,
  type ProductAccessoryRow,
} from "@/lib/product-accessories-db";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

export interface ProductAccessoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null 為新增；有值為編輯 */
  row: ProductAccessoryRow | null;
  onSuccess: () => void;
}

/** 配件表的新增與編輯表單 */
export function ProductAccessoryFormDialog({
  open,
  onOpenChange,
  row,
  onSuccess,
}: ProductAccessoryFormDialogProps) {
  const isEdit = row != null;
  const firstRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [material, setMaterial] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory(row?.category ?? "");
    setName(row?.name ?? "");
    setSpec(row?.spec ?? "");
    setMaterial(row?.material ?? "");
    setPrice(row?.price != null ? String(row.price) : "");
    setNotes(row?.notes ?? "");
    setImageUrl(row?.image_url ?? null);
    setError(null);
    setTimeout(() => firstRef.current?.focus(), 0);
  }, [open, row]);

  function parseNum(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!category.trim()) {
      setError("請輸入分類");
      return;
    }
    if (!name.trim()) {
      setError("請輸入配件名稱");
      return;
    }
    setSaving(true);

    const payload = {
      category: category.trim(),
      name: name.trim(),
      spec: spec.trim() || null,
      material: material.trim() || null,
      price: parseNum(price),
      notes: notes.trim() || null,
      image_url: imageUrl?.trim() || null,
    };

    const { error: err } = isEdit
      ? await supabase.from(TABLE_PRODUCT_ACCESSORIES).update(payload).eq("id", row.id)
      : await supabase.from(TABLE_PRODUCT_ACCESSORIES).insert(payload);

    setSaving(false);
    if (err) {
      toast.error(err.message || `${isEdit ? "更新" : "新增"}失敗`);
      setError(err.message || `${isEdit ? "更新" : "新增"}失敗`);
      return;
    }
    toast.success(isEdit ? "已更新配件" : "已新增配件");
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="accessory-form-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? "編輯配件" : "新增配件"}
              </Dialog.Title>
              <p id="accessory-form-desc" className="mt-1 text-sm text-muted-foreground">
                配件選項依分類整理（門框、坐墊、坐墊布料等），僅供內部使用。
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="accessory-form-category" className="text-xs text-muted-foreground">
                    分類 *
                  </label>
                  <input
                    id="accessory-form-category"
                    list="accessory-form-category-list"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="例：門框、坐墊、坐墊布料"
                    required
                  />
                  <datalist id="accessory-form-category-list">
                    {PRODUCT_ACCESSORY_CATEGORY_OPTIONS.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="accessory-form-name" className="text-xs text-muted-foreground">
                    配件名稱 *
                  </label>
                  <input
                    ref={firstRef}
                    id="accessory-form-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="例：藤編門框、乳膠坐墊"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="accessory-form-spec" className="text-xs text-muted-foreground">
                    規格
                  </label>
                  <input
                    id="accessory-form-spec"
                    type="text"
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="例：厚度 5cm、W450 x D450"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="accessory-form-material" className="text-xs text-muted-foreground">
                    材質
                  </label>
                  <input
                    id="accessory-form-material"
                    type="text"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="例：白橡木、亞麻布"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="accessory-form-price" className="text-xs text-muted-foreground">
                  定價／加價
                </label>
                <input
                  id="accessory-form-price"
                  type="number"
                  min={0}
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例：1200（可留空）"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">圖片</span>
                <ProductImageDropzone value={imageUrl} onChange={setImageUrl} disabled={saving} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="accessory-form-notes" className="text-xs text-muted-foreground">
                  內部備註
                </label>
                <textarea
                  id="accessory-form-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[60px]"
                  placeholder="僅內部可見"
                />
              </div>

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增配件"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
