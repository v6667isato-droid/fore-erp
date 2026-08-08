"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  defaultAmortizationMonthsForCategory,
  normalizeAmortizationMonths,
  PURCHASE_AMORTIZATION_OPTIONS,
} from "@/lib/purchase-amortization";
import { CategoryPicker } from "@/components/procurement/category-picker";
import {
  assignMaterialCategoryToGroup,
  fetchMaterialCategoryGroups,
  type MaterialCategoryGroup,
} from "@/lib/material-category-groups";
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
  const [spec2, setSpec2] = useState("");
  const [unit, setUnit] = useState("");
  const [amortizationMonths, setAmortizationMonths] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<MaterialCategoryGroup[]>([]);
  /** 自訂新類別要歸入的主類別 id；"" = 未分類 */
  const [customGroupId, setCustomGroupId] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setItemCategory("");
      setCustomGroupId("");
      setSpec("");
      setSpec2("");
      setUnit("");
      setAmortizationMonths(1);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase
      .from("procurement_materials")
      .select("item_category")
      .then(({ data }) => {
        if (cancelled || !data) return;
        const set = new Set<string>();
        for (const raw of data) {
          const c = String((raw as { item_category?: string | null }).item_category ?? "").trim();
          if (c) set.add(c);
        }
        setCategoryList([...set].sort((a, b) => a.localeCompare(b, "zh-Hant")));
      });
    void fetchMaterialCategoryGroups().then((groups) => {
      if (!cancelled) setCategoryGroups(groups);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nameT = name.trim();
    const catT = itemCategory.trim();
    const specT = spec.trim();
    const spec2T = spec2.trim();
    if (!nameT) {
      setError("請輸入標準品名");
      return;
    }
    setSaving(true);
    const payloadBase = {
      name: nameT,
      item_category: catT || null,
      spec: specT || null,
      spec2: spec2T || null,
      unit: unit.trim() || null,
    };
    const payload: Record<string, unknown> = {
      ...payloadBase,
      amortization_months: normalizeAmortizationMonths(amortizationMonths),
    };
    let { data, error: err } = await supabase
      .from("procurement_materials")
      .insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 動態組裝欄位，欄位集合因環境而異
        payload as any
      )
      .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
      .single();
    if (err && /column .* does not exist/i.test(err.message)) {
      const retry = await supabase
        .from("procurement_materials")
        .insert(payloadBase)
        .select("id, name, item_category, spec, spec2, unit, notes, created_at")
        .single();
      data = retry.data as typeof data;
      err = retry.error;
    }
    setSaving(false);
    if (err) {
      if (/duplicate key|unique constraint|23505/i.test(err.message)) {
        setError("已有相同品名、規格與規格2 的物料；請在主檔搜尋並選取現有資料，或調整這三項欄位其中之一。");
      } else {
        setError(err.message || "新增失敗");
      }
      toast.error(
        /duplicate key|unique constraint|23505/i.test(err.message) ? "品名／規格／規格2 組合已被使用。" : err.message || "新增失敗",
      );
      return;
    }
    if (customGroupId && catT) {
      const assignErr = await assignMaterialCategoryToGroup(catT, customGroupId);
      if (assignErr) toast.error(`物料已新增，但歸入主類別失敗：${assignErr}`);
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
                建立後可於採購時選取，自動帶入類別、規格、規格2、單位與預設攤提；相同品名＋規格＋規格2 不可重複。
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
                onBlur={() => setName((s) => s.trim())}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="例如：不鏽鋼板"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-cat" className="text-xs text-muted-foreground">物品類別</label>
              <CategoryPicker
                id="add-material-cat"
                value={itemCategory}
                onChange={(val) => {
                  setItemCategory(val);
                  setAmortizationMonths((prev) =>
                    prev <= 1 ? defaultAmortizationMonthsForCategory(val) : prev,
                  );
                }}
                categories={categoryList}
                groups={categoryGroups}
                open={open}
                customGroupId={customGroupId}
                onCustomGroupChange={setCustomGroupId}
                customPlaceholder="輸入新類別名稱，例：砂紙"
              />
              <p className="text-[11px] text-muted-foreground">依主類別分組顯示；可選「＋ 自訂新類別」輸入未列出的類別。</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-spec" className="text-xs text-muted-foreground">規格</label>
              <input id="add-material-spec" type="text" value={spec} onChange={(e) => setSpec(e.target.value)} onBlur={() => setSpec((s) => s.trim())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="選填" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-spec2" className="text-xs text-muted-foreground">規格2</label>
              <input id="add-material-spec2" type="text" value={spec2} onChange={(e) => setSpec2(e.target.value)} onBlur={() => setSpec2((s) => s.trim())} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="選填" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-unit" className="text-xs text-muted-foreground">預設單位</label>
              <input id="add-material-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="例如：kg、張" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-material-amort" className="text-xs text-muted-foreground">預設成本攤提</label>
              <select
                id="add-material-amort"
                value={amortizationMonths}
                onChange={(e) => setAmortizationMonths(Number(e.target.value) || 1)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="預設成本攤提月數"
              >
                {PURCHASE_AMORTIZATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">採購選取此物料時自動帶入；木料類別預設 12 個月。</p>
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
