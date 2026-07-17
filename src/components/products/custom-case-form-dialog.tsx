"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  TABLE_CUSTOM_CASES,
  CUSTOM_CASE_CATEGORY_OPTIONS,
  CUSTOM_CASE_KIND_LABEL,
  type CustomCaseKind,
  type CustomCaseRow,
} from "@/lib/custom-cases-db";
import { Button } from "@/components/ui/button";
import { X, Globe, Images } from "lucide-react";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import { ProductImagesDropzone } from "@/components/products/product-images-dropzone";
import { FocalPointPicker } from "@/components/products/focal-point-picker";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface CustomCaseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: CustomCaseKind;
  /** null 為新增；有值為編輯 */
  row: CustomCaseRow | null;
  onSuccess: () => void;
}

type FormTab = "basic" | "images" | "website";

/** 訂製案例／加工區共用的新增與編輯表單；kind=custom 時多一個「官網內容」分頁 */
export function CustomCaseFormDialog({
  open,
  onOpenChange,
  kind,
  row,
  onSuccess,
}: CustomCaseFormDialogProps) {
  const isEdit = row != null;
  const kindLabel = CUSTOM_CASE_KIND_LABEL[kind];
  const firstRef = useRef<HTMLInputElement>(null);

  const [caseCode, setCaseCode] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState("");
  const [material, setMaterial] = useState("");
  const [dimW, setDimW] = useState("");
  const [dimD, setDimD] = useState("");
  const [dimH, setDimH] = useState("");
  const [dimensionsNote, setDimensionsNote] = useState("");
  const [completedYear, setCompletedYear] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [notes, setNotes] = useState("");
  const [storyZh, setStoryZh] = useState("");
  const [storyEn, setStoryEn] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [objectPosition, setObjectPosition] = useState("");
  const [processImageUrls, setProcessImageUrls] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCaseCode(row?.case_code ?? "");
    setNameZh(row?.name_zh ?? "");
    setNameEn(row?.name_en ?? "");
    setCategory(row?.category ?? "");
    setMaterial(row?.material ?? "");
    setDimW(row?.dimension_w != null ? String(row.dimension_w) : "");
    setDimD(row?.dimension_d != null ? String(row.dimension_d) : "");
    setDimH(row?.dimension_h != null ? String(row.dimension_h) : "");
    setDimensionsNote(row?.dimensions_note ?? "");
    setCompletedYear(row?.completed_year ?? "");
    setBasePrice(row?.base_price != null ? String(row.base_price) : "");
    setNotes(row?.notes ?? "");
    setStoryZh(row?.story_zh ?? "");
    setStoryEn(row?.story_en ?? "");
    setImageUrl(row?.image_url ?? null);
    setObjectPosition(row?.object_position ?? "");
    setProcessImageUrls(row?.process_image_urls ?? []);
    setPublished(row?.published ?? false);
    setActiveTab("basic");
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
    if (!nameZh.trim()) {
      setError("請輸入名稱");
      setActiveTab("basic");
      return;
    }
    setSaving(true);

    const payload = {
      kind,
      case_code: caseCode.trim() || null,
      name_zh: nameZh.trim(),
      name_en: nameEn.trim() || null,
      category: category.trim() || null,
      material: material.trim() || null,
      dimension_w: parseNum(dimW),
      dimension_d: parseNum(dimD),
      dimension_h: parseNum(dimH),
      dimensions_note: dimensionsNote.trim() || null,
      completed_year: completedYear.trim() || null,
      base_price: kind === "processing" ? parseNum(basePrice) : (row?.base_price ?? null),
      notes: notes.trim() || null,
      story_zh: storyZh.trim() || null,
      story_en: storyEn.trim() || null,
      image_url: imageUrl?.trim() || null,
      object_position: objectPosition.trim() || null,
      process_image_urls: processImageUrls,
      published: kind === "custom" ? published : false,
    };

    const { error: err } = isEdit
      ? await supabase.from(TABLE_CUSTOM_CASES).update(payload).eq("id", row.id)
      : await supabase.from(TABLE_CUSTOM_CASES).insert(payload);

    setSaving(false);
    if (err) {
      toast.error(err.message || `${isEdit ? "更新" : "新增"}失敗`);
      setError(err.message || `${isEdit ? "更新" : "新增"}失敗`);
      return;
    }
    toast.success(isEdit ? `已更新${kindLabel}` : `已新增${kindLabel}`);
    onOpenChange(false);
    onSuccess();
  }

  const tabClass = (tab: FormTab) =>
    cn(
      "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
      activeTab === tab
        ? "border-b-2 border-primary bg-card text-foreground"
        : "text-muted-foreground hover:text-foreground"
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="custom-case-form-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? `編輯${kindLabel}` : `新增${kindLabel}`}
              </Dialog.Title>
              <p id="custom-case-form-desc" className="mt-1 text-sm text-muted-foreground">
                {kind === "custom"
                  ? "訂製案例可於「官網內容」分頁設定發佈到官網客製頁。"
                  : "加工區項目（維修保養等）僅供內部紀錄，不會出現在官網。"}
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

          <div className="flex border-b border-border bg-muted/20 px-5">
            <button type="button" onClick={() => setActiveTab("basic")} className={tabClass("basic")}>
              基本資料
            </button>
            <button type="button" onClick={() => setActiveTab("images")} className={tabClass("images")}>
              <Images className="h-4 w-4" />
              圖片
            </button>
            {kind === "custom" && (
              <button type="button" onClick={() => setActiveTab("website")} className={tabClass("website")}>
                <Globe className="h-4 w-4" />
                官網內容
              </button>
            )}
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {activeTab === "basic" && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="case-form-code" className="text-xs text-muted-foreground">
                        編號
                      </label>
                      <input
                        id="case-form-code"
                        type="text"
                        value={caseCode}
                        onChange={(e) => setCaseCode(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={kind === "custom" ? "例：C14" : "例：R01"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="case-form-category" className="text-xs text-muted-foreground">
                        類別
                      </label>
                      <input
                        id="case-form-category"
                        list="case-form-category-list"
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={kind === "custom" ? "例：桌、椅" : "例：維修、保養"}
                      />
                      <datalist id="case-form-category-list">
                        {CUSTOM_CASE_CATEGORY_OPTIONS[kind].map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-name-zh" className="text-xs text-muted-foreground">
                      名稱（中文）*
                    </label>
                    <input
                      ref={firstRef}
                      id="case-form-name-zh"
                      type="text"
                      value={nameZh}
                      onChange={(e) => setNameZh(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={kind === "custom" ? "例：藤編鞋櫃" : "例：餐桌桌面重新上油"}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-name-en" className="text-xs text-muted-foreground">
                      名稱（英文）
                    </label>
                    <input
                      id="case-form-name-en"
                      type="text"
                      value={nameEn}
                      onChange={(e) => setNameEn(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：Rattan Shoe Cabinet"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-material" className="text-xs text-muted-foreground">
                      材質／木種
                    </label>
                    <input
                      id="case-form-material"
                      type="text"
                      value={material}
                      onChange={(e) => setMaterial(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：白橡木、藤編門片"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">尺寸（mm）</span>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={dimW}
                        onChange={(e) => setDimW(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="寬 W"
                        aria-label="寬（mm）"
                      />
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={dimD}
                        onChange={(e) => setDimD(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="深 D"
                        aria-label="深（mm）"
                      />
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={dimH}
                        onChange={(e) => setDimH(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="高 H"
                        aria-label="高（mm）"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-dim-note" className="text-xs text-muted-foreground">
                      尺寸補充說明
                    </label>
                    <input
                      id="case-form-dim-note"
                      type="text"
                      value={dimensionsNote}
                      onChange={(e) => setDimensionsNote(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：依現場尺寸訂製（有填時優先顯示此文字）"
                    />
                  </div>
                  {kind === "processing" && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="case-form-base-price" className="text-xs text-muted-foreground">
                        定價
                      </label>
                      <input
                        id="case-form-base-price"
                        type="number"
                        min={0}
                        step="any"
                        value={basePrice}
                        onChange={(e) => setBasePrice(e.target.value)}
                        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="例：2200（可留空）"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-year" className="text-xs text-muted-foreground">
                      完成年份
                    </label>
                    <input
                      id="case-form-year"
                      type="text"
                      value={completedYear}
                      onChange={(e) => setCompletedYear(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：2023"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-notes" className="text-xs text-muted-foreground">
                      內部備註
                    </label>
                    <textarea
                      id="case-form-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[60px]"
                      placeholder="僅內部可見，不會出現在官網"
                    />
                  </div>
                </>
              )}

              {activeTab === "images" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">主圖</span>
                    <ProductImageDropzone value={imageUrl} onChange={setImageUrl} disabled={saving} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {kind === "custom" ? "製作過程圖（張數不限）" : "紀錄照片（張數不限）"}
                    </span>
                    <ProductImagesDropzone
                      value={processImageUrls}
                      onChange={setProcessImageUrls}
                      disabled={saving}
                    />
                  </div>
                </>
              )}

              {activeTab === "website" && kind === "custom" && (
                <>
                  <label className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={published}
                      onChange={(e) => setPublished(e.target.checked)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">發佈到官網</span>
                      <span className="text-[11px] text-muted-foreground">
                        勾選後此案例會顯示在官網「客製訂做」頁面
                      </span>
                    </span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-story-zh" className="text-xs text-muted-foreground">
                      案例故事（中文）
                    </label>
                    <textarea
                      id="case-form-story-zh"
                      value={storyZh}
                      onChange={(e) => setStoryZh(e.target.value)}
                      rows={5}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="case-form-story-en" className="text-xs text-muted-foreground">
                      案例故事（英文）
                    </label>
                    <textarea
                      id="case-form-story-en"
                      value={storyEn}
                      onChange={(e) => setStoryEn(e.target.value)}
                      rows={5}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      主圖裁切焦點（官網 4:5 裁切時盡量保留此處）
                    </span>
                    <FocalPointPicker
                      imageUrl={imageUrl}
                      value={objectPosition}
                      onChange={setObjectPosition}
                      disabled={saving}
                      previewAspect="4 / 5"
                    />
                  </div>
                </>
              )}

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
                {saving ? "儲存中…" : isEdit ? "儲存變更" : `新增${kindLabel}`}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
