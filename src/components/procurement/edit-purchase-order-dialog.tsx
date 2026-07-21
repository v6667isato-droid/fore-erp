"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, X, XCircle, Trash2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { ProcurementMaterialRow } from "@/types/procurement";
import {
  normalizeAmortizationMonths,
  PURCHASE_AMORTIZATION_OPTIONS,
  resolveDefaultAmortizationMonths,
} from "@/lib/purchase-amortization";
import { computePurchaseLinePrices } from "@/lib/purchase-tax";
import { purchaseSpecFromMaterialParts, purchaseSpecPartsForDisplay } from "@/lib/procurement-material";
import { displayPoNumber, type PurchaseOrderGroup } from "@/lib/purchase-order";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";

const FILTER_MATERIAL_UNCATEGORIZED = "__uncategorized__";

export interface EditPurchaseOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PurchaseOrderGroup | null;
  onSuccess: () => void;
}

type VendorOption = { id: string; name: string; main_category?: string | null };

type EditLineDraft = {
  key: string;
  /** purchases.id；新加入的品項為 null */
  existingId: string | null;
  materialId: string | null;
  materialCategoryFilter: string;
  itemCategory: string;
  itemName: string;
  spec: string;
  spec2: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** true=單價欄為已稅；false=未稅（各品項獨立，沿用原紀錄） */
  taxInclusive: boolean;
  amortizationMonths: number;
};

function newLineKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyLine(): EditLineDraft {
  return {
    key: newLineKey(),
    existingId: null,
    materialId: null,
    materialCategoryFilter: "",
    itemCategory: "",
    itemName: "",
    spec: "",
    spec2: "",
    quantity: "",
    unit: "",
    unitPrice: "",
    taxInclusive: false,
    amortizationMonths: 1,
  };
}

export function EditPurchaseOrderDialog({ open, onOpenChange, group, onSuccess }: EditPurchaseOrderDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorCategory, setVendorCategory] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [lines, setLines] = useState<EditLineDraft[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [materials, setMaterials] = useState<ProcurementMaterialRow[]>([]);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

  useEffect(() => {
    if (!open || !group) return;
    setPurchaseDate(group.purchase_date || "");
    setVendorName(group.vendor_name === "—" ? "" : group.vendor_name);
    setVendorCategory("");
    setPoNotes(group.po_notes ?? "");
    setLines(
      group.lines.map((row) => {
        const parts = purchaseSpecPartsForDisplay(row.spec ?? "", row.spec2 ?? null);
        return {
          key: row.id,
          existingId: row.id,
          materialId: row.material_id ?? null,
          materialCategoryFilter: "",
          itemCategory: row.item_category ?? "",
          itemName: row.item_name === "—" ? "" : row.item_name,
          spec: parts.primary,
          spec2: parts.secondary,
          quantity: row.quantity === "—" ? "" : String(row.quantity),
          unit: row.unit ?? "",
          unitPrice: row.unit_price != null ? String(row.unit_price) : "",
          taxInclusive: Boolean(row.unit_price_is_tax_inclusive),
          amortizationMonths: normalizeAmortizationMonths(row.amortization_months),
        };
      }),
    );
    setRemovedIds([]);
    setError(null);
  }, [open, group]);

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
      .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
      .order("name")
      .then(({ data }) => {
        setMaterials((data as ProcurementMaterialRow[]) ?? []);
      });
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !group) return;
    const vn = group.vendor_name === "—" ? "" : group.vendor_name.trim();
    if (!vn) {
      setVendorCategory("");
      return;
    }
    const v = vendors.find((x) => x.name === vn);
    if (v) setVendorCategory(v.main_category ?? "");
  }, [open, group, vendors]);

  const updateLine = useCallback((key: string, patch: Partial<EditLineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

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

  const filterMaterialsByCategory = useCallback(
    (filter: string): ProcurementMaterialRow[] => {
      if (!filter) return materials;
      if (filter === FILTER_MATERIAL_UNCATEGORIZED) {
        return materials.filter((m) => !m.item_category?.trim());
      }
      return materials.filter((m) => (m.item_category || "").trim() === filter);
    },
    [materials],
  );

  const materialsOptionsForLine = useCallback(
    (line: EditLineDraft): ProcurementMaterialRow[] => {
      const selected = line.materialId ? materials.find((m) => m.id === line.materialId) : null;
      const base = filterMaterialsByCategory(line.materialCategoryFilter);
      if (selected && !base.some((m) => m.id === selected.id)) {
        return [selected, ...base].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      }
      return base;
    },
    [materials, filterMaterialsByCategory],
  );

  const linePreview = useCallback((line: EditLineDraft) => {
    const q = line.quantity.trim() ? Number(line.quantity) : 0;
    const p = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
    if (Number.isNaN(q) || Number.isNaN(p)) return null;
    return computePurchaseLinePrices(p, q, line.taxInclusive);
  }, []);

  const totalPreview = useMemo(() => {
    let incTax = 0;
    let exTax = 0;
    for (const line of lines) {
      const p = linePreview(line);
      if (!p) continue;
      incTax += p.tax_included_amount;
      exTax += p.amount_ex_tax;
    }
    return { incTax, exTax };
  }, [lines, linePreview]);

  const canAddLine = Boolean(group?.purchase_order_id);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev.find((l) => l.key === key);
      if (target?.existingId) {
        setRemovedIds((ids) => [...ids, target.existingId as string]);
      }
      return prev.filter((l) => l.key !== key);
    });
  }

  function linePayload(line: EditLineDraft, vendor: string | null): Record<string, unknown> {
    const price = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
    const qty = line.quantity.trim() ? Number(line.quantity) : 0;
    const tax = computePurchaseLinePrices(price, qty, line.taxInclusive);
    return {
      purchase_date: purchaseDate.trim(),
      vendor_name: vendor,
      item_name: line.itemName.trim(),
      item_category: line.itemCategory.trim() || null,
      spec: purchaseSpecFromMaterialParts(line.spec, line.spec2) || null,
      spec2: line.spec2.trim() || null,
      quantity: line.quantity.trim() ? Number(line.quantity) : null,
      unit: line.unit.trim() || null,
      material_id: line.materialId,
      unit_price: tax.unit_price,
      unit_price_is_tax_inclusive: tax.unit_price_is_tax_inclusive,
      unit_price_ex_tax: tax.unit_price_ex_tax,
      unit_price_inc_tax: tax.unit_price_inc_tax,
      amount_ex_tax: tax.amount_ex_tax,
      amortization_months: normalizeAmortizationMonths(line.amortizationMonths),
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setError(null);
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    if (lines.length === 0) {
      setError("採購單至少須保留一筆品項");
      return;
    }
    for (const [index, line] of lines.entries()) {
      const label = line.itemName.trim() || `品項 ${index + 1}`;
      if (!line.existingId && !line.materialId) {
        setError(`「${label}」為新增品項，請選擇採購物料`);
        return;
      }
      if (!line.itemName.trim()) {
        setError(`品項 ${index + 1} 請選擇採購物料`);
        return;
      }
      const price = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      if (Number.isNaN(price) || price < 0) {
        setError(`「${label}」請輸入有效單價`);
        return;
      }
      const qty = line.quantity.trim() ? Number(line.quantity) : 0;
      if (line.quantity.trim() && (Number.isNaN(qty) || qty < 0)) {
        setError(`「${label}」請輸入有效數量`);
        return;
      }
    }

    const vendor = vendorName.trim() || null;
    setSaving(true);

    if (group.purchase_order_id) {
      const { error: poErr } = await supabase
        .from("purchase_orders")
        .update({
          purchase_date: purchaseDate.trim(),
          vendor_name: vendor,
          notes: poNotes.trim() || null,
        })
        .eq("id", group.purchase_order_id);
      if (poErr) {
        setSaving(false);
        toast.error(poErr.message || "更新採購單失敗");
        setError(poErr.message || "更新採購單失敗");
        return;
      }
    }

    for (const line of lines) {
      if (!line.existingId) continue;
      const { error: updErr } = await supabase
        .from("purchases")
        .update(linePayload(line, vendor))
        .eq("id", line.existingId);
      if (updErr) {
        setSaving(false);
        toast.error(updErr.message || "更新品項失敗");
        setError(updErr.message || "更新品項失敗");
        return;
      }
    }

    if (removedIds.length > 0) {
      const { error: delErr } = await supabase
        .from("purchases")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", removedIds);
      if (delErr) {
        setSaving(false);
        toast.error(delErr.message || "刪除品項失敗");
        setError(delErr.message || "刪除品項失敗");
        return;
      }
    }

    const newLines = lines.filter((l) => !l.existingId);
    if (newLines.length > 0 && group.purchase_order_id) {
      const payloads = newLines.map((l) => ({
        ...linePayload(l, vendor),
        purchase_order_id: group.purchase_order_id,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 動態欄位 payload
      const { error: insErr } = await supabase.from("purchases").insert(payloads as any);
      if (insErr) {
        setSaving(false);
        toast.error(insErr.message || "新增品項失敗");
        setError(insErr.message || "新增品項失敗");
        return;
      }
    }

    setSaving(false);
    toast.success(`已更新採購單 ${displayPoNumber(group.po_number)}`);
    onOpenChange(false);
    onSuccess();
  }

  if (!group) return null;

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-po-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                編輯採購單 {displayPoNumber(group.po_number)}
              </Dialog.Title>
              <p id="edit-po-desc" className="mt-1 text-sm text-muted-foreground">
                日期與廠商為整張共用；可修改、移除或新增品項，按「儲存」後一併生效
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
              <label htmlFor="edit-po-date" className="text-xs text-muted-foreground">日期 *</label>
              <input
                ref={firstRef}
                id="edit-po-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-po-vendor-cat" className="text-xs text-muted-foreground">廠商類別</label>
                <div className="flex gap-1.5">
                  <select
                    id="edit-po-vendor-cat"
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
                <label htmlFor="edit-po-vendor" className="text-xs text-muted-foreground">廠商</label>
                <div className="flex gap-1.5">
                  <input
                    id="edit-po-vendor"
                    type="text"
                    list="edit-po-vendor-datalist"
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
                  <datalist id="edit-po-vendor-datalist">
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

            {group.purchase_order_id && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-po-notes" className="text-xs text-muted-foreground">採購單備註</label>
                <textarea
                  id="edit-po-notes"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  rows={2}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="整張採購單的備註（選填）"
                />
              </div>
            )}

            <div className="space-y-3 pt-1">
              <p className="text-xs font-medium text-foreground">品項明細</p>

              {lines.map((line, index) => {
                const matOptions = materialsOptionsForLine(line);
                const preview = linePreview(line);
                return (
                  <div key={line.key} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        品項 {index + 1}
                        {!line.existingId && <span className="ml-1 text-primary">（新增）</span>}
                      </span>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => removeLine(line.key)}
                          aria-label="移除此品項"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          移除
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`edit-po-material-cat-filter-${line.key}`} className="text-xs text-muted-foreground">
                        篩選物料類別
                      </label>
                      <select
                        id={`edit-po-material-cat-filter-${line.key}`}
                        value={line.materialCategoryFilter}
                        onChange={(e) => updateLine(line.key, { materialCategoryFilter: e.target.value })}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-md"
                        aria-label="依物品類別篩選採購物料"
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
                      <label htmlFor={`edit-po-material-${line.key}`} className="text-xs text-muted-foreground">
                        採購物料 {line.existingId ? "" : "*"}
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <select
                          id={`edit-po-material-${line.key}`}
                          value={line.materialId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) {
                              // 清除選取時保留既有品名等欄位，僅解除主檔對應
                              updateLine(line.key, { materialId: null });
                              return;
                            }
                            const m = materials.find((x) => x.id === v);
                            if (!m) return;
                            updateLine(line.key, {
                              materialId: m.id,
                              itemName: m.name,
                              itemCategory: m.item_category ?? "",
                              spec: m.spec ?? "",
                              spec2: m.spec2 ?? "",
                              unit: m.unit ?? "",
                              amortizationMonths: resolveDefaultAmortizationMonths(m),
                            });
                          }}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label="選擇採購物料主檔"
                        >
                          <option value="">請選擇</option>
                          {matOptions.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.item_category ? `[${m.item_category}] ` : ""}
                              {m.name}
                              {m.spec ? ` — ${m.spec}` : ""}
                              {m.spec2 ? ` · ${m.spec2}` : ""}
                            </option>
                          ))}
                        </select>
                        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setMaterialDialogOpen(true)}>
                          新增物料
                        </Button>
                      </div>
                      {line.existingId && !line.materialId && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-500">
                          此筆尚未對應主檔；選取物料後品名／類別／規格／單位將以主檔為準。
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 rounded-md border border-border/80 bg-background/50 px-3 py-2 sm:grid-cols-2">
                      <div className="text-xs">
                        <span className="text-muted-foreground">品名</span>
                        <p className="mt-0.5 font-medium text-foreground">{line.itemName.trim() ? line.itemName : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">物品類別</span>
                        <p className="mt-0.5 text-foreground">{line.itemCategory.trim() ? line.itemCategory : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">規格</span>
                        <p className="mt-0.5 text-foreground">{line.spec.trim() ? line.spec : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">規格2</span>
                        <p className="mt-0.5 text-foreground">{line.spec2.trim() ? line.spec2 : "—"}</p>
                      </div>
                      <div className="text-xs sm:col-span-2">
                        <span className="text-muted-foreground">單位</span>
                        <p className="mt-0.5 text-foreground">{line.unit.trim() ? line.unit : "—"}</p>
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={line.taxInclusive}
                        onChange={(e) => updateLine(line.key, { taxInclusive: e.target.checked })}
                        className="h-4 w-4 rounded border-input"
                      />
                      單價為<strong className="font-medium">已稅</strong>金額（未勾選則為未稅，稅率固定 5%）
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`edit-po-qty-${line.key}`} className="text-xs text-muted-foreground">數量</label>
                        <input
                          id={`edit-po-qty-${line.key}`}
                          type="number"
                          min={0}
                          step="any"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="數量"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`edit-po-price-${line.key}`} className="text-xs text-muted-foreground">
                          單價（{line.taxInclusive ? "已稅" : "未稅"}）
                        </label>
                        <input
                          id={`edit-po-price-${line.key}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`edit-po-amort-${line.key}`} className="text-xs text-muted-foreground">成本攤提</label>
                        <select
                          id={`edit-po-amort-${line.key}`}
                          value={line.amortizationMonths}
                          onChange={(e) => updateLine(line.key, { amortizationMonths: Number(e.target.value) || 1 })}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label="成本攤提月數"
                        >
                          {PURCHASE_AMORTIZATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {preview !== null && (line.quantity.trim() || line.unitPrice.trim()) && (
                      <div className="space-y-0.5 text-sm">
                        <p className="text-foreground">
                          未稅總價：<span className="font-medium tabular-nums">{preview.amount_ex_tax.toLocaleString()}</span>
                        </p>
                        <p className="text-foreground">
                          含稅總價：<span className="font-medium tabular-nums">{preview.tax_included_amount.toLocaleString()}</span>
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {canAddLine ? (
                <Button type="button" variant="outline" className="h-9 w-full sm:w-auto" onClick={addLine}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  新增品項
                </Button>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  此筆為舊資料（無採購單單頭），無法在此新增品項；請使用「新增採購」另建採購單。
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/15 px-3 py-2 text-sm">
              <p className="text-foreground">
                整單未稅總計：<span className="font-medium tabular-nums">{totalPreview.exTax.toLocaleString()}</span>
                <span className="mx-2 text-muted-foreground">｜</span>
                整單含稅總計：<span className="font-medium tabular-nums">{totalPreview.incTax.toLocaleString()}</span>
              </p>
              {removedIds.length > 0 && (
                <p className="mt-1 text-xs text-destructive">已標記移除 {removedIds.length} 筆品項，儲存後生效。</p>
              )}
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
    <AddMaterialDialog
      open={materialDialogOpen}
      onOpenChange={setMaterialDialogOpen}
      onCreated={(m) => {
        const rowM: ProcurementMaterialRow = {
          ...m,
          item_category: m.item_category ?? "",
          spec: m.spec ?? "",
          spec2: m.spec2 ?? "",
          unit: m.unit ?? "",
        };
        setMaterials((prev) => [...prev, rowM].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")));
      }}
    />
    </>
  );
}
