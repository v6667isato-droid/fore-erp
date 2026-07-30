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
import { purchaseSpecFromMaterialParts } from "@/lib/procurement-material";
import { displayPoNumber, generatePoNumber } from "@/lib/purchase-order";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";
import { VendorCategoryFilterOptions } from "@/components/procurement/vendor-category-filter-options";
import {
  fetchVendorCategoryGroups,
  vendorCategoryFilterMatches,
  type VendorCategoryGroup,
} from "@/lib/vendor-category-groups";

export interface AddPurchaseDialogProps {
  onSuccess: () => void;
  onNavigateToVendors?: () => void;
}

type VendorOption = { id: string; name: string; main_category: string };

type LineDraft = {
  id: string;
  /** 採購物料主檔 id（必填） */
  materialId: string | null;
  /** 此列「採購物料」下拉用的類別篩選 */
  materialCategoryFilter: string;
  itemCategory: string;
  itemName: string;
  spec: string;
  spec2: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amortizationMonths: number;
};

function newLineId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyLine(): LineDraft {
  return {
    id: newLineId(),
    materialId: null,
    materialCategoryFilter: "",
    itemCategory: "",
    itemName: "",
    spec: "",
    spec2: "",
    quantity: "",
    unit: "",
    unitPrice: "",
    amortizationMonths: 1,
  };
}

const FILTER_MATERIAL_UNCATEGORIZED = "__uncategorized__";

export function AddPurchaseDialog({ onSuccess, onNavigateToVendors }: AddPurchaseDialogProps) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorCategory, setVendorCategory] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  /** true=單價欄為已稅；false=未稅（營業稅 5% 固定） */
  const [priceInputIsTaxInclusive, setPriceInputIsTaxInclusive] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<VendorCategoryGroup[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<ProcurementMaterialRow[]>([]);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

  const updateLine = useCallback((id: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const vendorCategories = useMemo(() => {
    const set = new Set(
      vendors.map((v) => v.main_category).filter((c): c is string => Boolean(c)),
    );
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [vendors]);

  const vendorsByCategory = useMemo(() => {
    if (!vendorCategory) return vendors;
    return vendors.filter((v) => vendorCategoryFilterMatches(vendorCategory, v.main_category ?? "", categoryGroups));
  }, [vendors, vendorCategory, categoryGroups]);

  /** 廠商欄 datalist：有選類別時只列該類；未選則列全部（可打字篩選） */
  const vendorDatalistOptions = useMemo(() => {
    return [...vendorsByCategory].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }, [vendorsByCategory]);

  function syncCategoryFromVendorName(name: string) {
    const matched = vendors.find((v) => v.name === name.trim());
    if (matched) setVendorCategory(matched.main_category);
  }

  function onVendorCategoryChange(next: string) {
    setVendorCategory(next);
    if (!vendorName.trim()) return;
    const ok = vendors.some((v) => v.name === vendorName.trim() && vendorCategoryFilterMatches(next, v.main_category ?? "", categoryGroups));
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
    (line: LineDraft): ProcurementMaterialRow[] => {
      const selected = line.materialId ? materials.find((m) => m.id === line.materialId) : null;
      const base = filterMaterialsByCategory(line.materialCategoryFilter);
      if (selected && !base.some((m) => m.id === selected.id)) {
        return [selected, ...base].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      }
      return base;
    },
    [materials, filterMaterialsByCategory],
  );

  const linePreview = useCallback(
    (line: LineDraft) => {
      const q = line.quantity.trim() ? Number(line.quantity) : 0;
      const p = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      if (Number.isNaN(q) || Number.isNaN(p)) return null;
      return computePurchaseLinePrices(p, q, priceInputIsTaxInclusive);
    },
    [priceInputIsTaxInclusive],
  );

  useEffect(() => {
    if (open) {
      setPurchaseDate(new Date().toISOString().slice(0, 10));
      setVendorCategory("");
      setVendorName("");
      setLines([emptyLine()]);
      setPriceInputIsTaxInclusive(false);
      setError(null);
      supabase.from("vendors").select("id, name, main_category").then(({ data }) => {
        setVendors((data as VendorOption[]) ?? []);
      });
      fetchVendorCategoryGroups().then(setCategoryGroups);
      supabase
        .from("procurement_materials")
        .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
        .order("name")
        .then(({ data }) => {
          setMaterials((data as ProcurementMaterialRow[]) ?? []);
        });
    }
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    const filled = lines.filter((l) => l.materialId);
    if (filled.length === 0) {
      setError("請至少選擇一筆採購物料");
      return;
    }
    for (const line of filled) {
      const price = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      if (Number.isNaN(price) || price < 0) {
        setError(`「${line.itemName.trim() || "品項"}」請輸入有效單價`);
        return;
      }
      const qty = line.quantity.trim() ? Number(line.quantity) : 0;
      if (line.quantity.trim() && (Number.isNaN(qty) || qty < 0)) {
        setError(`「${line.itemName.trim() || "品項"}」請輸入有效數量`);
        return;
      }
    }

    const vendor = vendorName.trim() || null;
    setAdding(true);

    // 先建採購單單頭（整合多品項、給編號）；舊 schema 無此表時退回無單頭模式
    let purchaseOrderId: string | null = null;
    let poNumber: string | null = null;
    for (let attempt = 0; attempt < 2 && purchaseOrderId == null; attempt++) {
      const candidate = generatePoNumber();
      const poRes = await supabase
        .from("purchase_orders")
        .insert({ po_number: candidate, purchase_date: purchaseDate.trim(), vendor_name: vendor })
        .select("id, po_number")
        .single();
      if (!poRes.error && poRes.data) {
        purchaseOrderId = (poRes.data as { id: string }).id;
        poNumber = (poRes.data as { po_number: string }).po_number;
        break;
      }
      // 編號撞號（unique 衝突）時重產一次；資料表不存在則直接退回舊模式
      if (!/duplicate key|unique/i.test(poRes.error?.message ?? "")) break;
    }

    const payloads: Record<string, unknown>[] = filled.map((line) => {
      const price = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      const qty = line.quantity.trim() ? Number(line.quantity) : 0;
      const tax = computePurchaseLinePrices(price, qty, priceInputIsTaxInclusive);
      return {
        purchase_date: purchaseDate.trim(),
        vendor_name: vendor,
        purchase_order_id: purchaseOrderId,
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
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 漸進刪除欄位以相容舊 schema
    let { error: err } = await supabase.from("purchases").insert(payloads as any);
    if (err && /column .* does not exist/i.test(err.message)) {
      const reduced = payloads.map((p) => {
        const r = { ...p };
        delete r.vendor_name;
        delete r.material_id;
        delete r.amortization_months;
        delete r.purchase_order_id;
        return r;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      err = (await supabase.from("purchases").insert(reduced as any)).error;
    }
    setAdding(false);
    if (err) {
      if (purchaseOrderId) {
        await supabase.from("purchase_orders").delete().eq("id", purchaseOrderId);
      }
      toast.error(err.message || "新增失敗");
      setError(err.message || "新增失敗");
      return;
    }
    toast.success(
      poNumber
        ? `已建立採購單 ${displayPoNumber(poNumber)}（${payloads.length} 筆品項）`
        : `已新增 ${payloads.length} 筆採購紀錄`,
    );
    setOpen(false);
    onSuccess();
  }

  return (
    <>
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
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-purchase-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增採購</Dialog.Title>
              <p id="add-purchase-desc" className="mt-1 text-sm text-muted-foreground">
                品項須自採購物料主檔選取；可一次新增多筆，日期與廠商共用，每列為一筆進貨紀錄
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
              <label htmlFor="add-purchase-date" className="text-xs text-muted-foreground">
                日期 *
              </label>
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-purchase-vendor-cat" className="text-xs text-muted-foreground">
                  廠商類別
                </label>
                <div className="flex gap-1.5">
                  <select
                    id="add-purchase-vendor-cat"
                    value={vendorCategory}
                    onChange={(e) => onVendorCategoryChange(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商類別"
                  >
                    <option value="">請選擇</option>
                    <VendorCategoryFilterOptions categories={vendorCategories} groups={categoryGroups} />
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
                <label htmlFor="add-purchase-vendor" className="text-xs text-muted-foreground">
                  廠商
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="add-purchase-vendor"
                    type="text"
                    list="add-purchase-vendor-datalist"
                    value={vendorName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVendorName(val);
                      syncCategoryFromVendorName(val);
                    }}
                    autoComplete="off"
                    placeholder={vendorCategory ? "打字篩選或從清單選擇" : "打字篩選或從清單選擇（可先選類別）"}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="廠商"
                  />
                  <datalist id="add-purchase-vendor-datalist">
                    {vendorDatalistOptions.map((v) => (
                      <option key={v.id} value={v.name} />
                    ))}
                  </datalist>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setVendorName("")} title="清除廠商" aria-label="清除選擇">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  選到與主檔完全相同的廠商名稱時，會自動帶出該廠的類別；可先選類別再選廠商，或直接選廠商帶出類別。
                </p>
              </div>
            </div>
            {onNavigateToVendors && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setOpen(false); onNavigateToVendors(); }}>
                找不到廠商？前往廠商資料新增
              </button>
            )}

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

            <div className="space-y-3 pt-1">
              <p className="text-xs font-medium text-foreground">品項明細</p>

              {lines.map((line, index) => {
                const matOptions = materialsOptionsForLine(line);
                const preview = linePreview(line);
                return (
                  <div key={line.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">品項 {index + 1}</span>
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => removeLine(line.id)} aria-label="移除此品項">
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          移除
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`add-purchase-material-cat-filter-${line.id}`} className="text-xs text-muted-foreground">
                        篩選物料類別
                      </label>
                      <select
                        id={`add-purchase-material-cat-filter-${line.id}`}
                        value={line.materialCategoryFilter}
                        onChange={(e) => updateLine(line.id, { materialCategoryFilter: e.target.value })}
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
                      <p className="text-[11px] text-muted-foreground">縮小下方「採購物料」選項；已選物料若不在篩選結果內仍會保留在清單中。</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`add-purchase-material-${line.id}`} className="text-xs text-muted-foreground">
                        採購物料 *
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <select
                          id={`add-purchase-material-${line.id}`}
                          value={line.materialId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) {
                              updateLine(line.id, {
                                materialId: null,
                                itemName: "",
                                itemCategory: "",
                                spec: "",
                                spec2: "",
                                unit: "",
                              });
                              return;
                            }
                            const m = materials.find((x) => x.id === v);
                            if (!m) return;
                            updateLine(line.id, {
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
                    </div>

                    <div className="grid grid-cols-1 gap-2 rounded-md border border-border/80 bg-background/50 px-3 py-2 sm:grid-cols-2">
                      <div className="text-xs">
                        <span className="text-muted-foreground">品名</span>
                        <p className="mt-0.5 font-medium text-foreground">{line.materialId ? line.itemName : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">物品類別</span>
                        <p className="mt-0.5 text-foreground">{line.materialId ? line.itemCategory || "—" : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">規格</span>
                        <p className="mt-0.5 text-foreground">{line.materialId ? line.spec || "—" : "—"}</p>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">規格2</span>
                        <p className="mt-0.5 text-foreground">{line.materialId ? line.spec2 || "—" : "—"}</p>
                      </div>
                      <div className="text-xs sm:col-span-2">
                        <span className="text-muted-foreground">單位</span>
                        <p className="mt-0.5 text-foreground">{line.materialId ? line.unit || "—" : "—"}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`add-purchase-qty-${line.id}`} className="text-xs text-muted-foreground">
                          數量
                        </label>
                        <input
                          id={`add-purchase-qty-${line.id}`}
                          type="number"
                          min={0}
                          step="any"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="數量"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`add-purchase-price-${line.id}`} className="text-xs text-muted-foreground">
                          單價（{priceInputIsTaxInclusive ? "已稅" : "未稅"}）
                        </label>
                        <input
                          id={`add-purchase-price-${line.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`add-purchase-amort-${line.id}`} className="text-xs text-muted-foreground">
                          成本攤提
                        </label>
                        <select
                          id={`add-purchase-amort-${line.id}`}
                          value={line.amortizationMonths}
                          onChange={(e) =>
                            updateLine(line.id, { amortizationMonths: Number(e.target.value) || 1 })
                          }
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label="成本攤提月數"
                        >
                          {PURCHASE_AMORTIZATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-muted-foreground">
                          依物料主檔預設帶入，可於此筆採購覆寫。
                        </p>
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

              <Button type="button" variant="outline" className="h-9 w-full sm:w-auto" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1.5" />
                新增品項
              </Button>
            </div>

            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={adding}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={adding}>
                {adding ? "新增中…" : "新增"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <AddMaterialDialog
      open={materialDialogOpen}
      onOpenChange={setMaterialDialogOpen}
      onCreated={(m) => {
        const row: ProcurementMaterialRow = {
          ...m,
          item_category: m.item_category ?? "",
          spec: m.spec ?? "",
          spec2: m.spec2 ?? "",
          unit: m.unit ?? "",
        };
        setMaterials((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")));
      }}
    />
    </>
  );
}
