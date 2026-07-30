"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  PART_CATEGORIES,
  PART_PROCUREMENT_TYPES,
  PART_SOURCE_TYPES,
  type MaterialRow,
  type PartRow,
} from "@/types/inventory";
import { buildSku, fetchMaterials } from "@/lib/part-variants";

interface VendorOption {
  id: string;
  name: string;
}

interface SeriesOption {
  id: string;
  series_name: string;
}

/** 該零件的既有變體（含軟刪除者，供重勾時復原、避免 sku 撞唯一鍵） */
interface VariantLite {
  id: string;
  material_code: string | null;
  sku: string;
  deleted_at: string | null;
}

export interface PartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null＝新增；有值＝編輯 */
  row: PartRow | null;
  onSaved: () => void;
}

/** 邏輯零件編輯：零件屬性＋材質變體勾選；SKU 由系統產生、不開放手改 */
export function PartDialog({ open, onOpenChange, row, onSaved }: PartDialogProps) {
  const isEdit = row != null;
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [nameCode, setNameCode] = useState("");
  const [category, setCategory] = useState<string>(PART_CATEGORIES[0]);
  const [seriesId, setSeriesId] = useState("");
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  const [unit, setUnit] = useState("個");
  const [procurementType, setProcurementType] = useState<string>("常備");
  const [sourceType, setSourceType] = useState<string>("採購");
  const [hasMaterialAxis, setHasMaterialAxis] = useState(false);
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [existingVariants, setExistingVariants] = useState<VariantLite[]>([]);
  const [woodSpecies, setWoodSpecies] = useState("");
  const [speciesList, setSpeciesList] = useState<string[]>([]);
  const [dimLength, setDimLength] = useState("");
  const [dimWidth, setDimWidth] = useState("");
  const [dimThickness, setDimThickness] = useState("");
  const [sop, setSop] = useState("");
  const [safetyStock, setSafetyStock] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [vendorId, setVendorId] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  const [drawingUrl, setDrawingUrl] = useState("");
  const [isComponent, setIsComponent] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(row?.name ?? "");
    setNameCode(row?.name_code ?? "");
    setCategory(row?.category ?? PART_CATEGORIES[0]);
    setSeriesId(row?.series_id ?? "");
    setUnit(row?.unit ?? "個");
    setProcurementType(row?.procurement_type ?? "常備");
    setSourceType(row?.source_type ?? "採購");
    setHasMaterialAxis(row?.has_material_axis ?? false);
    setSelectedMaterials(new Set());
    setExistingVariants([]);
    setWoodSpecies(row?.wood_species ?? "");
    setDimLength(row?.dim_length_mm != null ? String(row.dim_length_mm) : "");
    setDimWidth(row?.dim_width_mm != null ? String(row.dim_width_mm) : "");
    setDimThickness(row?.dim_thickness_mm != null ? String(row.dim_thickness_mm) : "");
    setSop(row?.sop ?? "");
    setSafetyStock(String(row?.safety_stock ?? 0));
    setReorderPoint(String(row?.reorder_point ?? 0));
    setVendorId(row?.vendor_id ?? "");
    setReferencePrice(row?.reference_unit_price != null ? String(row.reference_unit_price) : "");
    setDrawingUrl(row?.drawing_url ?? "");
    setIsComponent(row?.is_component ?? false);
    setNotes(row?.notes ?? "");
    setError(null);
  }, [open, row]);

  // 下拉選項：系列、供應商、材質對照表、固定材種建議
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [seriesRes, vendorsRes, materialsRes, speciesRes] = await Promise.all([
        supabase.from("product_series").select("id, series_name").is("deleted_at", null).order("series_name"),
        supabase.from("vendors").select("id, name").is("deleted_at", null).order("name"),
        fetchMaterials().catch(() => [] as MaterialRow[]),
        supabase.from("parts").select("wood_species").is("deleted_at", null).not("wood_species", "is", null),
      ]);
      if (cancelled) return;
      setSeriesList((seriesRes.data as SeriesOption[]) ?? []);
      setVendors((vendorsRes.data as VendorOption[]) ?? []);
      setMaterials(materialsRes);
      const set = new Set<string>();
      for (const r of speciesRes.data ?? []) {
        const v = String((r as { wood_species: string | null }).wood_species ?? "").trim();
        if (v) set.add(v);
      }
      setSpeciesList([...set].sort((a, b) => a.localeCompare(b, "zh-Hant")));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 編輯模式：載入該零件的變體（含軟刪除者），由現存變體推出已勾材質
  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("part_variants")
        .select("id, material_code, sku, deleted_at")
        .eq("part_id", row.id);
      if (cancelled) return;
      if (err) {
        toast.error(err.message || "無法載入零件變體");
        return;
      }
      const all = (data as VariantLite[]) ?? [];
      setExistingVariants(all);
      const codes = new Set<string>();
      for (const v of all) {
        if (!v.deleted_at && v.material_code) codes.add(v.material_code);
      }
      setSelectedMaterials(codes);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  const seriesName = useMemo(
    () => seriesList.find((s) => s.id === seriesId)?.series_name ?? null,
    [seriesList, seriesId],
  );

  const liveVariants = useMemo(() => existingVariants.filter((v) => !v.deleted_at), [existingVariants]);

  /** SKU 預覽：既有變體顯示已存 sku（不重算），新勾選顯示將建立的 sku */
  const skuPreviews = useMemo(() => {
    const previewFor = (code: string | null): { sku: string; isNew: boolean } => {
      const existing = liveVariants.find((v) => (v.material_code ?? null) === code);
      if (existing) return { sku: existing.sku, isNew: false };
      return {
        sku: buildSku({
          seriesName,
          materialCode: code,
          nameCode: nameCode.trim().toUpperCase() || null,
          fallbackName: name.trim() || "？",
        }),
        isNew: true,
      };
    };
    if (!hasMaterialAxis) return [previewFor(null)];
    return materials.filter((m) => selectedMaterials.has(m.code)).map((m) => previewFor(m.code));
  }, [hasMaterialAxis, materials, selectedMaterials, liveVariants, seriesName, nameCode, name]);

  function toggleMaterial(code: string, checked: boolean) {
    setSelectedMaterials((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  async function variantHasMovements(variantId: string): Promise<boolean> {
    const { count } = await supabase
      .from("stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("part_variant_id", variantId);
    return (count ?? 0) > 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nameT = name.trim();
    if (!nameT) {
      setError("請輸入零件名稱");
      return;
    }
    if (hasMaterialAxis && selectedMaterials.size === 0) {
      setError("有木種變體的零件請至少勾選一個材質");
      return;
    }
    const safety = Number(safetyStock);
    const reorder = Number(reorderPoint);
    if (!Number.isFinite(safety) || safety < 0 || !Number.isFinite(reorder) || reorder < 0) {
      setError("安全庫存與發注點需為 0 以上的數字");
      return;
    }
    const priceT = referencePrice.trim();
    const price = priceT === "" ? null : Number(priceT);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      setError("參考單價需為 0 以上的數字");
      return;
    }
    const parseDim = (raw: string): number | null | undefined => {
      const t = raw.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const dimL = parseDim(dimLength);
    const dimW = parseDim(dimWidth);
    const dimT = parseDim(dimThickness);
    if (dimL === undefined || dimW === undefined || dimT === undefined) {
      setError("尺寸需為大於 0 的數字（mm）");
      return;
    }
    const nameCodeT = nameCode.trim().toUpperCase();
    setSaving(true);
    const payload = {
      name: nameT,
      name_code: nameCodeT || null,
      category,
      unit: unit.trim() || "個",
      procurement_type: procurementType,
      source_type: sourceType,
      series_id: seriesId || null,
      has_material_axis: hasMaterialAxis,
      // 材質軸零件的材質記在變體層；固定材種只留給無材質軸零件
      wood_species: hasMaterialAxis ? null : woodSpecies.trim() || null,
      dim_length_mm: dimL,
      dim_width_mm: dimW,
      dim_thickness_mm: dimT,
      sop: sop.trim() || null,
      safety_stock: safety,
      reorder_point: reorder,
      vendor_id: vendorId || null,
      reference_unit_price: price,
      drawing_url: drawingUrl.trim() || null,
      is_component: isComponent,
      notes: notes.trim() || null,
    };
    const savedRes = isEdit
      ? await supabase.from("parts").update(payload).eq("id", row.id).select("id").single()
      : await supabase
          .from("parts")
          .insert({
            ...payload,
            // part_no 為過渡期唯一欄：新零件填無材質段 SKU 佔位
            part_no: buildSku({ seriesName, materialCode: null, nameCode: nameCodeT || null, fallbackName: nameT }),
          })
          .select("id")
          .single();
    if (savedRes.error) {
      setSaving(false);
      const msg = /duplicate key|unique constraint|23505/i.test(savedRes.error.message)
        ? "已有相同料號／SKU 的零件，請調整名稱或代碼。"
        : savedRes.error.message || (isEdit ? "儲存失敗" : "新增失敗");
      setError(msg);
      toast.error(msg);
      return;
    }
    const partId = savedRes.data?.id ?? row?.id;
    if (!partId) {
      setSaving(false);
      toast.error("儲存後取不到零件 id");
      return;
    }

    // 變體同步：以勾選狀態為準；已有庫存異動的變體不可勾銷
    const { data: vData, error: vErr } = await supabase
      .from("part_variants")
      .select("id, material_code, sku, deleted_at")
      .eq("part_id", partId);
    if (vErr) {
      setSaving(false);
      toast.error(`零件已儲存，但同步變體失敗：${vErr.message}`);
      onSaved();
      onOpenChange(false);
      return;
    }
    const all = (vData as VariantLite[]) ?? [];
    const live = all.filter((v) => !v.deleted_at);
    const desired: (string | null)[] = hasMaterialAxis ? [...selectedMaterials] : [null];
    const keyOf = (c: string | null) => c ?? "__null__";
    const desiredSet = new Set(desired.map(keyOf));

    let failed = 0;
    // 勾銷（含切換 has_material_axis 造成的另一型變體移除）：有異動紀錄則保留並提示
    for (const v of live) {
      if (desiredSet.has(keyOf(v.material_code ?? null))) continue;
      if (await variantHasMovements(v.id)) {
        failed += 1;
        toast.error(`勾銷失敗：${v.sku} 已有庫存異動紀錄，仍保留該變體`);
        continue;
      }
      const { error: delErr } = await supabase
        .from("part_variants")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", v.id);
      if (delErr) {
        failed += 1;
        toast.error(`移除變體失敗（${v.sku}）：${delErr.message}`);
      }
    }
    // 新增勾選：軟刪除過的同材質變體直接復原（沿用原 sku，避免撞唯一鍵）
    for (const code of desired) {
      if (live.some((v) => keyOf(v.material_code ?? null) === keyOf(code))) continue;
      const revive = all.find((v) => v.deleted_at && keyOf(v.material_code ?? null) === keyOf(code));
      if (revive) {
        const { error: revErr } = await supabase
          .from("part_variants")
          .update({ deleted_at: null })
          .eq("id", revive.id);
        if (revErr) {
          failed += 1;
          toast.error(`復原變體失敗（${revive.sku}）：${revErr.message}`);
        }
        continue;
      }
      const sku = buildSku({ seriesName, materialCode: code, nameCode: nameCodeT || null, fallbackName: nameT });
      const { error: insErr } = await supabase
        .from("part_variants")
        .insert({ part_id: partId, material_code: code, sku });
      if (insErr) {
        failed += 1;
        toast.error(`建立變體失敗（${sku}）：${insErr.message}`);
      }
    }
    setSaving(false);
    if (failed === 0) toast.success(isEdit ? "已更新零件" : "已新增零件");
    else toast.warning(isEdit ? "零件已更新，但部分變體同步未完成" : "零件已新增，但部分變體同步未完成");
    onSaved();
    onOpenChange(false);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="part-dialog-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? "編輯零件" : "新增零件"}
              </Dialog.Title>
              <p id="part-dialog-desc" className="mt-1 text-sm text-muted-foreground">
                SKU 由「系列-材質-代碼」自動產生；目前庫存由庫存異動紀錄自動加總，不在此填寫。
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
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-name" className="text-xs text-muted-foreground">名稱 *</label>
                <input
                  ref={firstRef}
                  id="part-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setName((s) => s.trim())}
                  className={inputCls}
                  placeholder="例如：後腳、銅製把手 — 不含系列"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-name-code" className="text-xs text-muted-foreground">代碼</label>
                <input
                  id="part-name-code"
                  type="text"
                  value={nameCode}
                  onChange={(e) => setNameCode(e.target.value)}
                  onBlur={() => setNameCode((s) => s.trim().toUpperCase())}
                  className={inputCls}
                  placeholder="例如：REAR（自動組 SKU 用，建議英文大寫）"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-series" className="text-xs text-muted-foreground">產品系列</label>
                <select id="part-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={inputCls}>
                  <option value="">（共用／不分系列）</option>
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.series_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-category" className="text-xs text-muted-foreground">分類 *</label>
                <select id="part-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {PART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-source-type" className="text-xs text-muted-foreground">來源</label>
                <select id="part-source-type" value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={inputCls}>
                  {PART_SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">自製＝自行加工；缺料提醒會標「排加工」而非「補貨」。</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-proc-type" className="text-xs text-muted-foreground">採購型態</label>
                <select id="part-proc-type" value={procurementType} onChange={(e) => setProcurementType(e.target.value)} className={inputCls}>
                  {PART_PROCUREMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-unit" className="text-xs text-muted-foreground">單位</label>
                <input id="part-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} placeholder="個、支、片、才…" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-vendor" className="text-xs text-muted-foreground">供應商</label>
                <select id="part-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputCls}>
                  <option value="">（未指定）</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-safety" className="text-xs text-muted-foreground">安全庫存量</label>
                <input id="part-safety" type="number" min="0" step="any" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-reorder" className="text-xs text-muted-foreground">發注點</label>
                <input id="part-reorder" type="number" min="0" step="any" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} className={inputCls} />
                <p className="text-[11px] text-muted-foreground">庫存低於發注點時列入補貨提醒；各材質變體共用此設定。</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-price" className="text-xs text-muted-foreground">參考單價</label>
                <input id="part-price" type="number" min="0" step="any" value={referencePrice} onChange={(e) => setReferencePrice(e.target.value)} className={inputCls} placeholder="選填" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-drawing" className="text-xs text-muted-foreground">尺寸圖連結</label>
                <input id="part-drawing" type="url" value={drawingUrl} onChange={(e) => setDrawingUrl(e.target.value)} onBlur={() => setDrawingUrl((s) => s.trim())} className={inputCls} placeholder="https://…（選填）" />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={hasMaterialAxis}
                  onChange={(e) => setHasMaterialAxis(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-[var(--primary)]"
                />
                此零件有木種變體（依材質分開庫存）
              </label>
              {hasMaterialAxis ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-3">
                    {materials.map((m) => (
                      <label key={m.code} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={selectedMaterials.has(m.code)}
                          onChange={(e) => toggleMaterial(m.code, e.target.checked)}
                          className="h-4 w-4 rounded border-input accent-[var(--primary)]"
                        />
                        {m.code} {m.name_zh}
                      </label>
                    ))}
                  </div>
                  {skuPreviews.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[11px] text-muted-foreground">SKU 預覽（系統產生，不可修改）</p>
                      {skuPreviews.map((p) => (
                        <p key={p.sku} className="text-xs tabular-nums text-foreground">
                          {p.sku}
                          {p.isNew && <span className="ml-1 text-muted-foreground">（將建立）</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="part-wood-species" className="text-xs text-muted-foreground">固定材種</label>
                    <input
                      id="part-wood-species"
                      list="part-wood-species-suggestions"
                      type="text"
                      value={woodSpecies}
                      onChange={(e) => setWoodSpecies(e.target.value)}
                      onBlur={() => setWoodSpecies((s) => s.trim())}
                      autoComplete="off"
                      className={inputCls}
                      placeholder="樺木…（選填）"
                    />
                    <datalist id="part-wood-species-suggestions">
                      {speciesList.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-muted-foreground">SKU 預覽（系統產生，不可修改）</p>
                    {skuPreviews.map((p) => (
                      <p key={p.sku} className="text-xs tabular-nums text-foreground">
                        {p.sku}
                        {p.isNew && <span className="ml-1 text-muted-foreground">（將建立）</span>}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(category === "木料" || sourceType === "自製") && (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">加工尺寸（mm）</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="part-dim-l" className="text-xs text-muted-foreground">長</label>
                    <input id="part-dim-l" type="number" min="0" step="any" value={dimLength} onChange={(e) => setDimLength(e.target.value)} className={inputCls} placeholder="mm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="part-dim-w" className="text-xs text-muted-foreground">寬</label>
                    <input id="part-dim-w" type="number" min="0" step="any" value={dimWidth} onChange={(e) => setDimWidth(e.target.value)} className={inputCls} placeholder="mm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="part-dim-t" className="text-xs text-muted-foreground">厚</label>
                    <input id="part-dim-t" type="number" min="0" step="any" value={dimThickness} onChange={(e) => setDimThickness(e.target.value)} className={inputCls} placeholder="mm" />
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  <label htmlFor="part-sop" className="text-xs text-muted-foreground">製作 SOP</label>
                  <textarea
                    id="part-sop"
                    value={sop}
                    onChange={(e) => setSop(e.target.value)}
                    rows={3}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="選填，加工步驟／注意事項；未來可另外上傳圖面檔案"
                  />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isComponent}
                onChange={(e) => setIsComponent(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-[var(--primary)]"
              />
              此零件本身是組件（預留多層 BOM，目前不影響功能）
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="part-notes" className="text-xs text-muted-foreground">備註</label>
              <textarea id="part-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" placeholder="選填" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : isEdit ? "儲存" : "建立"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
