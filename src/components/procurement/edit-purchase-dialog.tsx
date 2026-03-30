"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X, XCircle } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { PurchaseRow, ProcurementMaterialRow } from "@/types/procurement";
import { computePurchaseLinePrices } from "@/lib/purchase-tax";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";

const FILTER_MATERIAL_UNCATEGORIZED = "__uncategorized__";

export interface EditPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PurchaseRow | null;
  onSuccess: () => void;
}

type VendorOption = { id: string; name: string; main_category?: string | null };

export function EditPurchaseDialog({ open, onOpenChange, row, onSuccess }: EditPurchaseDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorCategory, setVendorCategory] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [spec, setSpec] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [priceInputIsTaxInclusive, setPriceInputIsTaxInclusive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [materials, setMaterials] = useState<ProcurementMaterialRow[]>([]);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [materialCategoryFilter, setMaterialCategoryFilter] = useState("");
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

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
      setPriceInputIsTaxInclusive(Boolean(row.unit_price_is_tax_inclusive));
      setMaterialId(row.material_id ?? null);
      setMaterialCategoryFilter("");
      setError(null);
    }
  }, [open, row]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("vendors")
      .select("id, name, main_category")
      .then(({ data }) => {
        setVendors((data as VendorOption[]) ?? []);
      });
    supabase
      .from("procurement_materials")
      .select("id, name, item_category, spec, unit, notes, created_at")
      .order("name")
      .then(({ data }) => {
        setMaterials((data as ProcurementMaterialRow[]) ?? []);
      });
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  const vendorCategories = useMemo(() => {
    const set = new Set(
      vendors.map((v) => v.main_category).filter((c): c is string => Boolean(c)),
    );
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [vendors]);

  const vendorsByCategory = useMemo(() => {
    if (!vendorCategory) return vendors;
    return vendors.filter((v) => v.main_category === vendorCategory);
  }, [vendors, vendorCategory]);

  const vendorDatalistOptions = useMemo(() => {
    return [...vendorsByCategory].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }, [vendorsByCategory]);

  function syncCategoryFromVendorName(name: string) {
    const matched = vendors.find((v) => v.name === name.trim());
    if (matched) setVendorCategory(matched.main_category ?? "");
  }

  function onVendorCategoryChange(next: string) {
    setVendorCategory(next);
    if (!vendorName.trim()) return;
    const ok = vendors.some((v) => v.name === vendorName.trim() && (!next || v.main_category === next));
    if (!ok) setVendorName("");
  }

  const pricePreview = useMemo(() => {
    if (!open || !row) return null;
    const p = unitPrice.trim() ? Number(unitPrice) : NaN;
    const q = quantity.trim() ? Number(quantity) : 0;
    if (Number.isNaN(p) || Number.isNaN(q) || p < 0) return null;
    return computePurchaseLinePrices(p, q, priceInputIsTaxInclusive);
  }, [open, row, unitPrice, quantity, priceInputIsTaxInclusive]);

  useEffect(() => {
    if (!open || !row) return;
    const vn = (row.vendor_name ?? "").trim();
    if (!vn) {
      setVendorCategory("");
      return;
    }
    const v = vendors.find((x) => x.name === vn);
    if (v) setVendorCategory(v.main_category ?? "");
  }, [open, row?.id, row?.vendor_name, vendors]);

  const materialCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of materials) {
      const c = m.item_category?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [materials]);

  const hasUncategorizedMaterials = useMemo(
    () => materials.some((m) => !m.item_category?.trim()),
    [materials],
  );

  const filteredMaterials = useMemo(() => {
    if (!materialCategoryFilter) return materials;
    if (materialCategoryFilter === FILTER_MATERIAL_UNCATEGORIZED) {
      return materials.filter((m) => !m.item_category?.trim());
    }
    return materials.filter((m) => (m.item_category || "").trim() === materialCategoryFilter);
  }, [materials, materialCategoryFilter]);

  const materialSelectOptions = useMemo(() => {
    const selected = materialId ? materials.find((m) => m.id === materialId) : null;
    const base = filteredMaterials;
    if (selected && !base.some((m) => m.id === selected.id)) {
      return [selected, ...base].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    }
    return base;
  }, [materials, materialId, filteredMaterials]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    if (!materialId) {
      setError("請選擇採購物料");
      return;
    }
    const price = unitPrice.trim() ? Number(unitPrice) : 0;
    if (Number.isNaN(price) || price < 0) {
      setError("請輸入有效單價");
      return;
    }
    setSaving(true);
    const qty = quantity.trim() ? Number(quantity) : 0;
    const tax = computePurchaseLinePrices(price, qty, priceInputIsTaxInclusive);
    const payload: Record<string, unknown> = {
      purchase_date: purchaseDate.trim(),
      vendor_name: vendorName.trim() || null,
      item_name: itemName.trim(),
      item_category: itemCategory.trim() || null,
      spec: spec.trim() || null,
      quantity: quantity.trim() ? Number(quantity) : null,
      unit: unit.trim() || null,
      material_id: materialId,
      unit_price: tax.unit_price,
      unit_price_is_tax_inclusive: tax.unit_price_is_tax_inclusive,
      unit_price_ex_tax: tax.unit_price_ex_tax,
      unit_price_inc_tax: tax.unit_price_inc_tax,
      amount_ex_tax: tax.amount_ex_tax,
    };
    let { error: err } = await supabase.from("purchases").update(payload).eq("id", row.id);
    if (err && /column .* does not exist/i.test(err.message)) {
      const reduced = { ...payload };
      delete reduced.vendor_name;
      delete reduced.material_id;
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
    <>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-vendor-cat" className="text-xs text-muted-foreground">廠商類別</label>
                <div className="flex gap-1.5">
                  <select
                    id="edit-purchase-vendor-cat"
                    value={vendorCategory}
                    onChange={(e) => onVendorCategoryChange(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商類別"
                  >
                    <option value="">（不篩選）</option>
                    {vendorCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setVendorCategory("");
                      setVendorName("");
                    }}
                    title="清除廠商類別與廠商"
                    aria-label="清除選擇"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-vendor" className="text-xs text-muted-foreground">廠商名稱</label>
                <div className="flex gap-1.5">
                  <input
                    id="edit-purchase-vendor"
                    type="text"
                    list="edit-purchase-vendor-datalist"
                    value={vendorName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVendorName(val);
                      syncCategoryFromVendorName(val);
                    }}
                    autoComplete="off"
                    placeholder="打字篩選或從清單選擇"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商"
                  />
                  <datalist id="edit-purchase-vendor-datalist">
                    {vendorDatalistOptions.map((v) => (
                      <option key={v.id} value={v.name} />
                    ))}
                  </datalist>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setVendorName("")} title="清除廠商" aria-label="清除廠商">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug -mt-1">
              選到與主檔完全相同的廠商名稱時會自動帶出類別；可先選類別再選廠商，或直接選廠商帶出類別。
            </p>
            <div className="flex flex-col gap-1.5 sm:max-w-md">
              <label htmlFor="edit-purchase-material-cat-filter" className="text-xs text-muted-foreground">
                篩選物料類別
              </label>
              <select
                id="edit-purchase-material-cat-filter"
                value={materialCategoryFilter}
                onChange={(e) => setMaterialCategoryFilter(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="依物品類別篩選物料主檔"
              >
                <option value="">全部類別</option>
                {hasUncategorizedMaterials ? (
                  <option value={FILTER_MATERIAL_UNCATEGORIZED}>（未分類）</option>
                ) : null}
                {materialCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">採購物料 *</span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <select
                  id="edit-purchase-material"
                  value={materialId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      setMaterialId(null);
                      return;
                    }
                    const m = materials.find((x) => x.id === v);
                    if (!m) return;
                    setMaterialId(m.id);
                    setItemName(m.name);
                    setItemCategory(m.item_category ?? "");
                    setSpec(m.spec ?? "");
                    setUnit(m.unit ?? "");
                  }}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="選擇採購物料主檔"
                >
                  <option value="">請選擇</option>
                  {materialSelectOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.item_category ? `[${m.item_category}] ` : ""}
                      {m.name}
                      {m.spec ? ` — ${m.spec}` : ""}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setMaterialDialogOpen(true)}>
                  新增物料
                </Button>
              </div>
              {!materialId && row && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500">此筆尚未對應主檔，請自上方選取物料；選取後品名／類別／規格／單位將以主檔為準。</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2 sm:grid-cols-2">
              <div className="text-xs">
                <span className="text-muted-foreground">品名</span>
                <p className="mt-0.5 font-medium text-foreground">{itemName.trim() ? itemName : "—"}</p>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">物品類別</span>
                <p className="mt-0.5 text-foreground">{itemCategory.trim() ? itemCategory : "—"}</p>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">規格</span>
                <p className="mt-0.5 text-foreground">{spec.trim() ? spec : "—"}</p>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">單位</span>
                <p className="mt-0.5 text-foreground">{unit.trim() ? unit : "—"}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs font-medium text-foreground">單價為已稅或未稅</span>
                <span className="text-xs text-muted-foreground">營業稅率固定 5%，總價由數量與單價自動計算。</span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={priceInputIsTaxInclusive}
                  onChange={(e) => setPriceInputIsTaxInclusive(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                單價為<strong className="font-medium">已稅</strong>金額（未勾選則為未稅）
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-qty" className="text-xs text-muted-foreground">數量</label>
                <input id="edit-purchase-qty" type="number" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-purchase-price" className="text-xs text-muted-foreground">單價（{priceInputIsTaxInclusive ? "已稅" : "未稅"}）</label>
                <input id="edit-purchase-price" type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            {pricePreview && (
              <div className="space-y-0.5 text-sm text-foreground">
                <p>未稅總價：<span className="font-medium tabular-nums">{pricePreview.amount_ex_tax.toLocaleString()}</span></p>
                <p>含稅總價：<span className="font-medium tabular-nums">{pricePreview.tax_included_amount.toLocaleString()}</span></p>
              </div>
            )}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <AddMaterialDialog
      open={materialDialogOpen}
      onOpenChange={setMaterialDialogOpen}
      onCreated={(m) => {
        const rowM: ProcurementMaterialRow = {
          ...m,
          item_category: m.item_category ?? "",
          spec: m.spec ?? "",
          unit: m.unit ?? "",
        };
        setMaterials((prev) => [...prev, rowM].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")));
      }}
    />
    </>
  );
}
