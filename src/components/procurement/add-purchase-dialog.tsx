"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, X, XCircle } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { PurchaseRow } from "@/types/procurement";

export interface AddPurchaseDialogProps {
  onSuccess: () => void;
  onNavigateToVendors?: () => void;
  /** 已採購紀錄，用於下拉選單選項（品名、物品類別、規格、單位） */
  purchases?: PurchaseRow[];
}

type VendorOption = { id: string; name: string; main_category: string };

export function AddPurchaseDialog({ onSuccess, onNavigateToVendors, purchases = [] }: AddPurchaseDialogProps) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorCategory, setVendorCategory] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemName, setItemName] = useState("");
  const [spec, setSpec] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vendorCategories = useMemo(() => {
    const set = new Set(vendors.map((v) => v.main_category).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  const vendorsByCategory = useMemo(() => {
    if (!vendorCategory) return vendors;
    return vendors.filter((v) => v.main_category === vendorCategory);
  }, [vendors, vendorCategory]);

  const itemCategories = useMemo(() => {
    const set = new Set(purchases.map((p) => p.item_category).filter(Boolean));
    return [...set].sort((a, b) => String(a).localeCompare(String(b)));
  }, [purchases]);

  const itemNamesByVendor = useMemo(() => {
    if (!vendorName.trim()) return [...new Set(purchases.map((p) => p.item_name).filter(Boolean))];
    return [...new Set(purchases.filter((p) => p.vendor_name === vendorName.trim()).map((p) => p.item_name).filter(Boolean))];
  }, [purchases, vendorName]);

  const specsByItemName = useMemo(() => {
    if (!itemName.trim()) return [];
    return [...new Set(purchases.filter((p) => p.item_name === itemName.trim()).map((p) => p.spec).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }, [purchases, itemName]);

  const units = useMemo(() => {
    return [...new Set(purchases.map((p) => p.unit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }, [purchases]);

  const totalPrice = useMemo(() => {
    const q = quantity.trim() ? Number(quantity) : 0;
    const p = unitPrice.trim() ? Number(unitPrice) : 0;
    if (Number.isNaN(q) || Number.isNaN(p)) return null;
    return q * p;
  }, [quantity, unitPrice]);

  useEffect(() => {
    if (open) {
      setPurchaseDate(new Date().toISOString().slice(0, 10));
      setVendorCategory("");
      setVendorName("");
      setItemCategory("");
      setItemName("");
      setSpec("");
      setQuantity("");
      setUnit("");
      setUnitPrice("");
      setError(null);
      supabase.from("vendors").select("id, name, main_category").then(({ data }) => {
        setVendors((data as VendorOption[]) ?? []);
      });
    }
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSpec("");
  }, [itemName]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    const qty = quantity.trim() ? Number(quantity) : 0;
    if (quantity.trim() && (Number.isNaN(qty) || qty < 0)) {
      setError("請輸入有效數量");
      return;
    }
    setAdding(true);
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
    let { error: err } = await supabase.from("purchases").insert(payload);
    if (err && /column .* does not exist/i.test(err.message)) {
      const reduced = { ...payload };
      delete reduced.vendor_name;
      err = (await supabase.from("purchases").insert(reduced)).error;
    }
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增失敗");
      setError(err.message || "新增失敗");
      return;
    }
    toast.success("已新增採購紀錄");
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
          新增採購
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-purchase-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增採購</Dialog.Title>
              <p id="add-purchase-desc" className="mt-1 text-sm text-muted-foreground">新增一筆採購／進貨紀錄</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-purchase-date" className="text-xs text-muted-foreground">日期 *</label>
              <input
                ref={firstRef}
                id="add-purchase-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-purchase-vendor-cat" className="text-xs text-muted-foreground">廠商類別</label>
                <div className="flex gap-1.5">
                  <select
                    id="add-purchase-vendor-cat"
                    value={vendorCategory}
                    onChange={(e) => {
                      setVendorCategory(e.target.value);
                      setVendorName("");
                    }}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商類別"
                  >
                    <option value="">請選擇</option>
                    {vendorCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setVendorCategory(""); setVendorName(""); }} title="清除廠商類別與廠商" aria-label="清除選擇">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-purchase-vendor" className="text-xs text-muted-foreground">廠商</label>
                <div className="flex gap-1.5">
                  <select
                    id="add-purchase-vendor"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商"
                  >
                    <option value="">請選擇</option>
                    {vendorsByCategory.map((v) => (
                      <option key={v.id} value={v.name}>{v.name}</option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setVendorName("")} title="清除廠商" aria-label="清除選擇">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            {onNavigateToVendors && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setOpen(false); onNavigateToVendors(); }}>
                找不到廠商？前往廠商資料新增
              </button>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-purchase-cat" className="text-xs text-muted-foreground">物品類別</label>
              <input
                id="add-purchase-cat"
                list="add-purchase-cat-list"
                type="text"
                value={itemCategory}
                onChange={(e) => setItemCategory(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="採購過會顯示選項"
              />
              <datalist id="add-purchase-cat-list">
                {itemCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-purchase-item" className="text-xs text-muted-foreground">品名 *</label>
              <input
                id="add-purchase-item"
                list="add-purchase-item-list"
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <datalist id="add-purchase-item-list">
                {itemNamesByVendor.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-purchase-spec" className="text-xs text-muted-foreground">規格</label>
              <input
                id="add-purchase-spec"
                list="add-purchase-spec-list"
                type="text"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={itemName.trim() ? "" : "請先選擇品名"}
              />
              <datalist id="add-purchase-spec-list">
                {specsByItemName.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-purchase-qty" className="text-xs text-muted-foreground">數量</label>
                <input
                  id="add-purchase-qty"
                  type="number"
                  min={0}
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="數量"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-purchase-unit" className="text-xs text-muted-foreground">單位</label>
                <input
                  id="add-purchase-unit"
                  list="add-purchase-unit-list"
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="採購過會顯示選項"
                />
                <datalist id="add-purchase-unit-list">
                  {units.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-purchase-price" className="text-xs text-muted-foreground">單價</label>
              <input
                id="add-purchase-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="0"
              />
            </div>

            {totalPrice !== null && (quantity.trim() || unitPrice.trim()) && (
              <p className="text-sm font-medium text-foreground">
                總價：{totalPrice.toLocaleString()} <span className="text-muted-foreground font-normal">（數量 × 單價）</span>
              </p>
            )}

            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={adding}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={adding}>{adding ? "新增中…" : "新增"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
