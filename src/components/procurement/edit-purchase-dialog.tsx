"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { PurchaseRow } from "@/types/procurement";

export interface EditPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PurchaseRow | null;
  onSuccess: () => void;
}

export function EditPurchaseDialog({ open, onOpenChange, row, onSuccess }: EditPurchaseDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [spec, setSpec] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setPurchaseDate(row.purchase_date || "");
      setVendorName(row.vendor_name ?? "");
      setItemName(row.item_name ?? "");
      setItemCategory(row.item_category ?? "");
      setSpec(row.spec ?? "");
      setQuantity(row.quantity === "—" ? "" : String(row.quantity));
      setUnit(row.unit ?? "");
      setUnitPrice(row.unit_price != null ? String(row.unit_price) : "");
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
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    if (!itemName.trim()) {
      setError("請輸入品名");
      return;
    }
    const price = unitPrice.trim() ? Number(unitPrice) : 0;
    if (Number.isNaN(price) || price < 0) {
      setError("請輸入有效單價");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      purchase_date: purchaseDate.trim(),
      vendor_name: vendorName.trim() || null,
      item_name: itemName.trim(),
      item_category: itemCategory.trim() || null,
      spec: spec.trim() || null,
      quantity: quantity.trim() ? Number(quantity) : null,
      unit: unit.trim() || null,
      unit_price: price,
    };
    let { error: err } = await supabase.from("purchases").update(payload).eq("id", row.id);
    if (err && /column .* does not exist/i.test(err.message)) {
      const reduced = { ...payload };
      delete reduced.vendor_name;
      err = (await supabase.from("purchases").update(reduced).eq("id", row.id)).error;
    }
    setSaving(false);
    if (err) {
      toast.error(err.message || "更新失敗");
      setError(err.message || "更新失敗");
      return;
    }
    toast.success("已更新採購紀錄");
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
          aria-describedby="edit-purchase-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯採購</Dialog.Title>
              <p id="edit-purchase-desc" className="mt-1 text-sm text-muted-foreground">修改採購／進貨紀錄</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-date" className="text-xs text-muted-foreground">日期 *</label>
              <input ref={firstRef} id="edit-purchase-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-vendor" className="text-xs text-muted-foreground">廠商名稱</label>
              <input id="edit-purchase-vendor" type="text" value={vendorName} onChange={(e) => setVendorName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="廠商" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-item" className="text-xs text-muted-foreground">品名 *</label>
              <input id="edit-purchase-item" type="text" value={itemName} onChange={(e) => setItemName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-cat" className="text-xs text-muted-foreground">類別</label>
              <input id="edit-purchase-cat" type="text" value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-spec" className="text-xs text-muted-foreground">規格</label>
              <input id="edit-purchase-spec" type="text" value={spec} onChange={(e) => setSpec(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-qty" className="text-xs text-muted-foreground">數量</label>
                <input id="edit-purchase-qty" type="number" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-unit" className="text-xs text-muted-foreground">單位</label>
                <input id="edit-purchase-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-purchase-price" className="text-xs text-muted-foreground">單價</label>
              <input id="edit-purchase-price" type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
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
