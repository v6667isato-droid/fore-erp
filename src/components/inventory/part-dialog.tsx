"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  PART_CATEGORIES,
  PART_PROCUREMENT_TYPES,
  PART_SOURCE_TYPES,
  type PartRow,
} from "@/types/inventory";

interface VendorOption {
  id: string;
  name: string;
}

interface ExistingPartLite {
  id: string;
  part_no: string;
  name: string;
  wood_species: string | null;
}

export interface PartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null＝新增；有值＝編輯 */
  row: PartRow | null;
  /** 新增模式下的預填來源（複製零件用）：帶入全部欄位但料號留白 */
  copyFrom?: PartRow | null;
  onSaved: () => void;
}

export function PartDialog({ open, onOpenChange, row, copyFrom, onSaved }: PartDialogProps) {
  const isEdit = row != null;
  const firstRef = useRef<HTMLInputElement>(null);
  const [partNo, setPartNo] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(PART_CATEGORIES[0]);
  const [unit, setUnit] = useState("個");
  const [procurementType, setProcurementType] = useState<string>("常備");
  const [sourceType, setSourceType] = useState<string>("採購");
  const [woodSpecies, setWoodSpecies] = useState("");
  const [speciesList, setSpeciesList] = useState<string[]>([]);
  const [existingParts, setExistingParts] = useState<ExistingPartLite[]>([]);
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
  /** 存檔後偵測到同名零件時的同步提示：目標 id 清單＋要寫入的欄位 */
  const [syncPrompt, setSyncPrompt] = useState<{
    ids: string[];
    name: string;
    fields: {
      dim_length_mm: number | null;
      dim_width_mm: number | null;
      dim_thickness_mm: number | null;
      sop: string | null;
      drawing_url: string | null;
    };
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    // 編輯帶原列；新增時若有 copyFrom（複製零件）帶入全部欄位但料號留白
    const src = row ?? copyFrom ?? null;
    setPartNo(row?.part_no ?? "");
    setName(src?.name ?? "");
    setCategory(src?.category ?? PART_CATEGORIES[0]);
    setUnit(src?.unit ?? "個");
    setProcurementType(src?.procurement_type ?? "常備");
    setSourceType(src?.source_type ?? "採購");
    setWoodSpecies(src?.wood_species ?? "");
    setDimLength(src?.dim_length_mm != null ? String(src.dim_length_mm) : "");
    setDimWidth(src?.dim_width_mm != null ? String(src.dim_width_mm) : "");
    setDimThickness(src?.dim_thickness_mm != null ? String(src.dim_thickness_mm) : "");
    setSop(src?.sop ?? "");
    setSafetyStock(String(src?.safety_stock ?? 0));
    setReorderPoint(String(src?.reorder_point ?? 0));
    setVendorId(src?.vendor_id ?? "");
    setReferencePrice(src?.reference_unit_price != null ? String(src.reference_unit_price) : "");
    setDrawingUrl(src?.drawing_url ?? "");
    setIsComponent(src?.is_component ?? false);
    setNotes(src?.notes ?? "");
    setError(null);
  }, [open, row, copyFrom]);

  // 既有零件清單（重複建檔即時提示用）＋材種建議清單（零件材種＋產品規格用過的材種）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [partsRes, variantsRes] = await Promise.all([
        supabase.from("parts").select("id, part_no, name, wood_species").is("deleted_at", null),
        supabase.from("product_variants").select("wood_type").is("deleted_at", null).not("wood_type", "is", null),
      ]);
      if (cancelled) return;
      setExistingParts((partsRes.data as ExistingPartLite[]) ?? []);
      const set = new Set<string>();
      for (const r of partsRes.data ?? []) {
        const v = String((r as { wood_species: string | null }).wood_species ?? "").trim();
        if (v) set.add(v);
      }
      for (const r of variantsRes.data ?? []) {
        const v = String((r as { wood_type: string | null }).wood_type ?? "").trim();
        if (v) set.add(v);
      }
      setSpeciesList([...set].sort((a, b) => a.localeCompare(b, "zh-Hant")));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** 重複建檔即時比對：同名同材種＝疑似重複（警告）；同名不同材種＝材種版本（提示） */
  const dupCheck = useMemo(() => {
    const nameT = name.trim();
    if (!nameT) return null;
    const speciesT = woodSpecies.trim();
    const sameName = existingParts.filter((p) => p.id !== row?.id && p.name === nameT);
    if (sameName.length === 0) return null;
    const exact = sameName.filter((p) => (p.wood_species ?? "").trim() === speciesT);
    if (exact.length > 0) return { level: "warn" as const, parts: exact };
    return { level: "info" as const, parts: sameName };
  }, [existingParts, name, woodSpecies, row]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase
      .from("vendors")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setVendors((data as VendorOption[]) ?? []);
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
    const partNoT = partNo.trim();
    const nameT = name.trim();
    if (!partNoT) {
      setError("請輸入料號");
      return;
    }
    if (!nameT) {
      setError("請輸入零件名稱");
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
    setSaving(true);
    const payload = {
      part_no: partNoT,
      name: nameT,
      category,
      unit: unit.trim() || "個",
      procurement_type: procurementType,
      source_type: sourceType,
      wood_species: woodSpecies.trim() || null,
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
      : await supabase.from("parts").insert(payload).select("id").single();
    setSaving(false);
    if (savedRes.error) {
      const msg = /duplicate key|unique constraint|23505/i.test(savedRes.error.message)
        ? "此料號已存在，請改用其他料號。"
        : savedRes.error.message || (isEdit ? "儲存失敗" : "新增失敗");
      setError(msg);
      toast.error(msg);
      return;
    }
    toast.success(isEdit ? "已更新零件" : "已新增零件");

    // 同名（不同材種）零件存在時，詢問是否同步尺寸/SOP/圖面。
    // 先查好並設定提示、再通知父層刷新，避免刷新造成的重繪把提示吃掉。
    const savedId = savedRes.data?.id ?? row?.id;
    if (savedId) {
      const { data: siblings } = await supabase
        .from("parts")
        .select("id")
        .eq("name", nameT)
        .is("deleted_at", null)
        .neq("id", savedId);
      if (siblings && siblings.length > 0) {
        setSyncPrompt({
          ids: siblings.map((s) => s.id),
          name: nameT,
          fields: {
            dim_length_mm: dimL,
            dim_width_mm: dimW,
            dim_thickness_mm: dimT,
            sop: sop.trim() || null,
            drawing_url: drawingUrl.trim() || null,
          },
        });
      }
    }
    onSaved();
    onOpenChange(false);
  }

  async function performSync() {
    if (!syncPrompt) return;
    const { error: err } = await supabase
      .from("parts")
      .update(syncPrompt.fields)
      .in("id", syncPrompt.ids);
    if (err) {
      toast.error(err.message || "同步失敗");
      return;
    }
    toast.success(`已同步尺寸／SOP／圖面到 ${syncPrompt.ids.length} 顆「${syncPrompt.name}」`);
    onSaved();
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <>
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
                目前庫存由庫存異動紀錄自動加總，不在此填寫。
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
                <label htmlFor="part-no" className="text-xs text-muted-foreground">料號 *</label>
                <input ref={firstRef} id="part-no" type="text" value={partNo} onChange={(e) => setPartNo(e.target.value)} onBlur={() => setPartNo((s) => s.trim())} className={inputCls} placeholder="例如：HW-0001" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-name" className="text-xs text-muted-foreground">名稱 *</label>
                <input id="part-name" type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName((s) => s.trim())} className={inputCls} placeholder="例如：櫃體銅製把手" required />
                {dupCheck && (
                  <p
                    className={
                      dupCheck.level === "warn"
                        ? "text-[11px] text-amber-700 dark:text-amber-400"
                        : "text-[11px] text-muted-foreground"
                    }
                    role={dupCheck.level === "warn" ? "alert" : undefined}
                  >
                    {dupCheck.level === "warn" ? (
                      <>
                        ⚠ 疑似重複建檔：已有同名同材種的零件（
                        {dupCheck.parts.map((p) => p.part_no).join("、")}
                        ）。若是同一顆請直接編輯既有資料；若為不同材種，請填材種欄位。
                      </>
                    ) : (
                      <>
                        已有 {dupCheck.parts.length} 顆同名零件（其他材種版本：
                        {dupCheck.parts.map((p) => `${p.part_no}${p.wood_species ? `・${p.wood_species}` : ""}`).join("、")}
                        ），存檔後可一鍵同步尺寸／SOP／圖面。
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-category" className="text-xs text-muted-foreground">分類 *</label>
                <select id="part-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {PART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              {category === "木料" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="part-wood-species" className="text-xs text-muted-foreground">材種</label>
                  <input
                    id="part-wood-species"
                    list="part-wood-species-suggestions"
                    type="text"
                    value={woodSpecies}
                    onChange={(e) => setWoodSpecies(e.target.value)}
                    onBlur={() => setWoodSpecies((s) => s.trim())}
                    autoComplete="off"
                    className={inputCls}
                    placeholder="白橡木、胡桃木…"
                  />
                  <datalist id="part-wood-species-suggestions">
                    {speciesList.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="part-unit" className="text-xs text-muted-foreground">單位</label>
                <input id="part-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} placeholder="個、支、片、才…" />
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
                <p className="text-[11px] text-muted-foreground">庫存低於發注點時列入補貨提醒。</p>
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

    <ConfirmDialog
      open={syncPrompt != null}
      onOpenChange={(o) => !o && setSyncPrompt(null)}
      title="同步到其他材種版本？"
      description={
        syncPrompt ? (
          <>
            <p>
              另有 {syncPrompt.ids.length} 顆同名零件「
              <span className="font-medium text-foreground">{syncPrompt.name}</span>
              」（其他材種版本）。
            </p>
            <p className="mt-2">
              是否將這次的<span className="font-medium text-foreground">尺寸、SOP、圖面連結</span>一併寫入？
              材種、料號、庫存與安全庫存設定不會被更動。
            </p>
          </>
        ) : null
      }
      confirmLabel="同步"
      cancelLabel="只改這顆"
      onConfirm={performSync}
    />
    </>
  );
}
