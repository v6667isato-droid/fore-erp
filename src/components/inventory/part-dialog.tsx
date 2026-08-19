"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SAFETY_STOCK,
  PART_CATEGORIES,
  PART_SOURCE_TYPES,
  PART_UNITS,
  type MaterialRow,
  type PartRow,
} from "@/types/inventory";
import { buildSku, fetchMaterials } from "@/lib/part-variants";

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

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** 單選勾選格：外觀同勾選方塊，語意為 radio（一顆零件只有一個分類／來源／單位） */
function PickChip({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        checked ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-muted/40",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="h-4 w-4 shrink-0 border-input accent-[var(--primary)]"
      />
      {children}
    </label>
  );
}

/** 邏輯零件編輯：零件屬性＋木種變體勾選；SKU 由系統產生、不開放手改 */
export function PartDialog({ open, onOpenChange, row, onSaved }: PartDialogProps) {
  const isEdit = row != null;
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [nameCode, setNameCode] = useState("");
  const [category, setCategory] = useState<string>(PART_CATEGORIES[0]);
  const [seriesId, setSeriesId] = useState("");
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  const [unit, setUnit] = useState<string>(PART_UNITS[0]);
  const [sourceType, setSourceType] = useState<string>("自製");
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [existingVariants, setExistingVariants] = useState<VariantLite[]>([]);
  const [dimLength, setDimLength] = useState("");
  const [dimWidth, setDimWidth] = useState("");
  const [dimThickness, setDimThickness] = useState("");
  const [sop, setSop] = useState("");
  const [safetyStock, setSafetyStock] = useState(String(DEFAULT_SAFETY_STOCK));
  const [referencePrice, setReferencePrice] = useState("");
  const [drawingUrl, setDrawingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(row?.name ?? "");
    setNameCode(row?.name_code ?? "");
    setCategory(row?.category ?? PART_CATEGORIES[0]);
    setSeriesId(row?.series_id ?? "");
    setUnit(row?.unit ?? PART_UNITS[0]);
    setSourceType(row?.source_type ?? "自製");
    setSelectedMaterials(new Set());
    setExistingVariants([]);
    setDimLength(row?.dim_length_mm != null ? String(row.dim_length_mm) : "");
    setDimWidth(row?.dim_width_mm != null ? String(row.dim_width_mm) : "");
    setDimThickness(row?.dim_thickness_mm != null ? String(row.dim_thickness_mm) : "");
    setSop(row?.sop ?? "");
    setSafetyStock(String(row?.safety_stock ?? DEFAULT_SAFETY_STOCK));
    setReferencePrice(row?.reference_unit_price != null ? String(row.reference_unit_price) : "");
    setDrawingUrl(row?.drawing_url ?? "");
    setNotes(row?.notes ?? "");
    setError(null);
  }, [open, row]);

  // 下拉選項：系列、木種對照表
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [seriesRes, materialsRes] = await Promise.all([
        supabase.from("product_series").select("id, series_name").is("deleted_at", null).order("series_name"),
        fetchMaterials().catch(() => [] as MaterialRow[]),
      ]);
      if (cancelled) return;
      setSeriesList((seriesRes.data as SeriesOption[]) ?? []);
      setMaterials(materialsRes);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 編輯模式：載入該零件的變體（含軟刪除者），由現存變體推出已勾木種
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

  const isWood = category === "木料";
  const isMake = sourceType === "自製";
  /** 勾了木種才走材質軸；木料但未勾任何木種＝不分木種的單一庫存 */
  const hasMaterialAxis = isWood && selectedMaterials.size > 0;

  /** 編輯舊資料時若單位不在 個／組 內，保留原單位為額外選項，避免存檔時被悄悄換掉 */
  const unitOptions = useMemo(() => {
    const list: string[] = [...PART_UNITS];
    if (unit && !list.includes(unit)) list.push(unit);
    return list;
  }, [unit]);

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
    const safety = Number(safetyStock);
    if (!Number.isFinite(safety) || safety < 0) {
      setError("安全庫存需為 0 以上的數字");
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
      unit: unit.trim() || PART_UNITS[0],
      // 採購型態已自畫面移除：新零件沿用「常備」，舊零件保留原值
      procurement_type: row?.procurement_type ?? "常備",
      source_type: sourceType,
      series_id: seriesId || null,
      has_material_axis: hasMaterialAxis,
      // 木種變體記在變體層；不分木種的零件保留舊有固定材種欄位值
      wood_species: hasMaterialAxis ? null : (row?.wood_species ?? null),
      dim_length_mm: dimL,
      dim_width_mm: dimW,
      dim_thickness_mm: dimT,
      sop: sop.trim() || null,
      safety_stock: safety,
      // 發注點已自畫面移除，缺料提醒門檻＝安全庫存
      reorder_point: safety,
      // 供應商欄位待採購模組串接後再開放
      vendor_id: row?.vendor_id ?? null,
      reference_unit_price: price,
      drawing_url: drawingUrl.trim() || null,
      // 多層 BOM 尚未開放設定
      is_component: row?.is_component ?? false,
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
    // 勾銷（含切換木種軸造成的另一型變體移除）：有異動紀錄則保留並提示
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
    // 新增勾選：軟刪除過的同木種變體直接復原（沿用原 sku，避免撞唯一鍵）
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
                SKU 由「系列-木種-代碼」自動產生；目前庫存由庫存異動紀錄自動加總，不在此填寫。
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
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="part-series" className="text-xs text-muted-foreground">產品系列</label>
                <select id="part-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={inputCls}>
                  <option value="">（共用／不分系列）</option>
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.series_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs text-muted-foreground">分類 *</legend>
              <div className="flex flex-wrap gap-2">
                {PART_CATEGORIES.map((c) => (
                  <PickChip key={c} name="part-category" value={c} checked={category === c} onSelect={setCategory}>
                    {c}
                  </PickChip>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs text-muted-foreground">來源 *</legend>
              <div className="flex flex-wrap gap-2">
                {PART_SOURCE_TYPES.map((t) => (
                  <PickChip key={t} name="part-source" value={t} checked={sourceType === t} onSelect={setSourceType}>
                    {t}
                  </PickChip>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">自製＝自行加工；缺料提醒會標「排加工」而非「補貨」。</p>
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs text-muted-foreground">單位 *</legend>
              <div className="flex flex-wrap gap-2">
                {unitOptions.map((u) => (
                  <PickChip key={u} name="part-unit" value={u} checked={unit === u} onSelect={setUnit}>
                    {u}
                  </PickChip>
                ))}
              </div>
            </fieldset>

            {isWood && (
              <fieldset className="rounded-lg border border-border bg-muted/20 p-3">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">木種（可複選，每個木種分開算庫存）</legend>
                <div className="flex flex-wrap gap-3">
                  {materials.length === 0 ? (
                    <p className="text-xs text-muted-foreground">尚無木種，請先到「變體選項設定」新增。</p>
                  ) : (
                    materials.map((m) => (
                      <label key={m.code} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={selectedMaterials.has(m.code)}
                          onChange={(e) => toggleMaterial(m.code, e.target.checked)}
                          className="h-4 w-4 rounded border-input accent-[var(--primary)]"
                        />
                        {m.name_zh}
                        <span className="text-xs text-muted-foreground">({m.code})</span>
                      </label>
                    ))
                  )}
                </div>
                {!hasMaterialAxis && materials.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">未勾選木種＝不分木種，只建立一筆庫存。</p>
                )}
              </fieldset>
            )}

            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-[11px] text-muted-foreground">SKU 預覽（系統產生，不可修改）</p>
              <div className="mt-1 flex flex-col gap-0.5">
                {skuPreviews.map((p) => (
                  <p key={p.sku} className="text-xs tabular-nums text-foreground">
                    {p.sku}
                    {p.isNew && <span className="ml-1 text-muted-foreground">（將建立）</span>}
                  </p>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-safety" className="text-xs text-muted-foreground">安全庫存量</label>
                <input id="part-safety" type="number" min="0" step="any" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} className={inputCls} />
                <p className="text-[11px] text-muted-foreground">庫存低於安全庫存時列入缺料提醒；各木種變體共用此設定。</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-price" className="text-xs text-muted-foreground">參考單價</label>
                <input id="part-price" type="number" min="0" step="any" value={referencePrice} onChange={(e) => setReferencePrice(e.target.value)} className={inputCls} placeholder="選填" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="part-drawing" className="text-xs text-muted-foreground">尺寸圖連結</label>
                <input id="part-drawing" type="url" value={drawingUrl} onChange={(e) => setDrawingUrl(e.target.value)} onBlur={() => setDrawingUrl((s) => s.trim())} className={inputCls} placeholder="https://…（選填）" />
              </div>
            </div>

            {(isWood || isMake) && (
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
                {isMake && (
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
                )}
              </div>
            )}

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
