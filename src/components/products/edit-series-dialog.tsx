"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_SERIES, TABLE_PRODUCT_VARIANTS, TABLE_SERIES_SWATCHES, SERIES_CONTENT_COLUMNS, PRODUCT_CATEGORY_OPTIONS } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import { ProductImagesDropzone } from "@/components/products/product-images-dropzone";
import { SeriesImageMetaEditor } from "@/components/products/series-image-meta-editor";
import { SeriesSwatchesSelector } from "@/components/products/series-swatches-selector";
import { SeriesSheetItemsSelector } from "@/components/products/series-sheet-items-selector";
import { X, FileText, MessageCircle, Images, Palette } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SeriesRow, SeriesImageMeta } from "@/types/products";
import { cn } from "@/lib/utils";

export interface EditSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SeriesRow | null;
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = PRODUCT_CATEGORY_OPTIONS;

const CONTENT_FIELDS: { key: (typeof SERIES_CONTENT_COLUMNS)[number]; label: string }[] = [
  { key: "design_concept", label: "設計理念" },
  { key: "social_media_copy", label: "社群文案" },
  { key: "website_article", label: "網站文章" },
  { key: "faq_scripts", label: "客服問答" },
  { key: "customization_rules", label: "客製與保養" },
];

const TAB_1_KEYS = ["design_concept", "social_media_copy", "website_article"];
const TAB_2_KEYS = ["faq_scripts", "customization_rules"];

type EditSeriesTab = "basic" | "images" | "sheet" | "marketing" | "support";

export function EditSeriesDialog({ open, onOpenChange, row, onSuccess }: EditSeriesDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const firstContentRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [designConceptEn, setDesignConceptEn] = useState("");
  const [customizationRulesEn, setCustomizationRulesEn] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [productionTime, setProductionTime] = useState("");
  const [codeRule, setCodeRule] = useState("");
  const [contentValues, setContentValues] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  /** 第二張主視覺圖：官網作品牆 hover 顯示；未上傳＝官網維持微放大 */
  const [hoverImageUrl, setHoverImageUrl] = useState<string | null>(null);
  const [sizeChartUrls, setSizeChartUrls] = useState<string[]>([]);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [imageMeta, setImageMeta] = useState<Record<string, SeriesImageMeta>>({});
  const [activeTab, setActiveTab] = useState<EditSeriesTab>("basic");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 介紹表：勾選的色樣 id（有序）與是否顯示報價欄 */
  const [sheetSwatchIds, setSheetSwatchIds] = useState<string[]>([]);
  const [showPriceOnSheet, setShowPriceOnSheet] = useState(false);
  /** 介紹表：勾選的品項 id（有序＝顯示順序），儲存時寫回 show_on_sheet＋sheet_sort_order */
  const [sheetItemIds, setSheetItemIds] = useState<string[]>([]);
  /** 介紹表專用欄位（獨立於產品資料；留空＝沿用產品資料對應欄位） */
  const [sheetHeroImageUrl, setSheetHeroImageUrl] = useState<string | null>(null);
  const [sheetDesignConcept, setSheetDesignConcept] = useState("");
  const [sheetCustomizationRules, setSheetCustomizationRules] = useState("");

  useEffect(() => {
    if (open && row) {
      setName(row.name ?? "");
      setNameEn(row.name_en ?? "");
      setDesignConceptEn(row.design_concept_en ?? "");
      setCustomizationRulesEn(row.customization_rules_en ?? "");
      setCategory(row.category ?? "");
      setNotes(row.notes ?? "");
      setProductionTime(row.production_time ?? "");
      setCodeRule(row.code_rule ?? "");

      const next: Record<string, string> = {};
      for (const { key } of CONTENT_FIELDS) {
        const v = row[key];
        next[key] = typeof v === "string" ? v : "";
      }
      setContentValues(next);

      setImageUrl(typeof row.image_url === "string" && row.image_url ? row.image_url : null);
      setHoverImageUrl(
        typeof row.hover_image_url === "string" && row.hover_image_url ? row.hover_image_url : null
      );
      setSizeChartUrls(Array.isArray(row.size_chart_urls) ? row.size_chart_urls.filter(Boolean) : []);
      setDetailImageUrls(Array.isArray(row.detail_image_urls) ? row.detail_image_urls.filter(Boolean) : []);
      setImageMeta(
        row.image_meta && typeof row.image_meta === "object" ? { ...row.image_meta } : {}
      );
      setActiveTab("basic");
      setError(null);
      setShowPriceOnSheet(row.show_price_on_sheet === true);
      setSheetSwatchIds([]);
      setSheetItemIds([]);
      setSheetHeroImageUrl(
        typeof row.sheet_hero_image_url === "string" && row.sheet_hero_image_url
          ? row.sheet_hero_image_url
          : null
      );
      setSheetDesignConcept(row.sheet_design_concept ?? "");
      setSheetCustomizationRules(row.sheet_customization_rules ?? "");
      // 介紹表色樣：載入此系列已勾選的色樣（依 sort_order）
      (async () => {
        const { data, error: swErr } = await supabase
          .from(TABLE_SERIES_SWATCHES)
          .select("swatch_id, sort_order")
          .eq("series_id", row.id)
          .order("sort_order", { ascending: true });
        if (!swErr && data) {
          setSheetSwatchIds((data as { swatch_id: string }[]).map((r) => String(r.swatch_id)));
        }
      })();
      // 介紹表品項：載入已勾選 show_on_sheet 的規格（依 sheet_sort_order，未排序者按代碼殿後）
      (async () => {
        const { data, error: viErr } = await supabase
          .from(TABLE_PRODUCT_VARIANTS)
          .select("id, sheet_sort_order")
          .eq("series_id", row.id)
          .eq("show_on_sheet", true)
          .is("deleted_at", null)
          .order("sheet_sort_order", { ascending: true, nullsFirst: false })
          .order("product_code", { ascending: true });
        if (!viErr && data) {
          setSheetItemIds((data as { id: string }[]).map((r) => String(r.id)));
        }
      })();
    }
  }, [open, row]);

  useEffect(() => {
    if (!open) return;
    if (activeTab === "basic" && firstRef.current) {
      setTimeout(() => firstRef.current?.focus(), 0);
    } else if (activeTab !== "basic" && firstContentRef.current) {
      setTimeout(() => firstContentRef.current?.focus(), 0);
    }
  }, [open, activeTab]);

  function setField(key: string, value: string) {
    setContentValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!name.trim()) {
      setError("請輸入系列名稱");
      return;
    }
    setSaving(true);

    // 寫入所有基本欄位 + 文案欄位（以 series_name 為主鍵名稱）
    const payload: Record<string, unknown> = {
      series_name: name.trim(),
      series_name_en: nameEn.trim() || null,
      design_concept_en: designConceptEn.trim() || null,
      customization_rules_en: customizationRulesEn.trim() || null,
      category: category.trim() || null,
      notes: notes.trim() || null,
      production_time: productionTime.trim() || null,
      code_rule: codeRule.trim() || null,
    };

    for (const col of SERIES_CONTENT_COLUMNS) {
      const v = contentValues[col]?.trim();
      payload[col] = v || null;
    }
    payload.image_url = imageUrl?.trim() || null;
    payload.hover_image_url = hoverImageUrl?.trim() || null;
    payload.size_chart_urls = sizeChartUrls;
    payload.detail_image_urls = detailImageUrls;

    // 圖片中繼資料只保留目前仍存在的圖片，且捨棄完全沒填的空項目
    const currentUrls = new Set(
      [imageUrl?.trim(), hoverImageUrl?.trim(), ...detailImageUrls].filter(Boolean) as string[]
    );
    const prunedMeta: Record<string, SeriesImageMeta> = {};
    for (const [url, m] of Object.entries(imageMeta)) {
      if (!currentUrls.has(url)) continue;
      const titleZh = m.title_zh?.trim() || null;
      const titleEn = m.title_en?.trim() || null;
      const objectPosition = m.object_position?.trim() || null;
      if (!titleZh && !titleEn && !objectPosition) continue;
      prunedMeta[url] = { title_zh: titleZh, title_en: titleEn, object_position: objectPosition };
    }
    payload.image_meta = prunedMeta;
    payload.show_price_on_sheet = showPriceOnSheet;
    // 介紹表專用欄位：留空存 null＝沿用產品資料
    payload.sheet_hero_image_url = sheetHeroImageUrl?.trim() || null;
    payload.sheet_design_concept = sheetDesignConcept.trim() || null;
    payload.sheet_customization_rules = sheetCustomizationRules.trim() || null;

    const { error: err } = await supabase.from(TABLE_PRODUCT_SERIES).update(payload).eq("id", row.id);

    if (err) {
      setSaving(false);
      toast.error(err.message || "更新系列失敗");
      setError(err.message || "更新系列失敗");
      return;
    }

    // 介紹表品項：先全部重設再依勾選順序寫回（show_on_sheet＋sheet_sort_order）
    const { error: resetErr } = await supabase
      .from(TABLE_PRODUCT_VARIANTS)
      .update({ show_on_sheet: false, sheet_sort_order: null })
      .eq("series_id", row.id)
      .is("deleted_at", null);
    if (resetErr) {
      setSaving(false);
      toast.error(resetErr.message || "介紹表品項儲存失敗");
      setError(resetErr.message || "介紹表品項儲存失敗");
      return;
    }
    for (let i = 0; i < sheetItemIds.length; i++) {
      const { error: itemErr } = await supabase
        .from(TABLE_PRODUCT_VARIANTS)
        .update({ show_on_sheet: true, sheet_sort_order: i })
        .eq("id", sheetItemIds[i]);
      if (itemErr) {
        setSaving(false);
        toast.error(itemErr.message || "介紹表品項儲存失敗");
        setError(itemErr.message || "介紹表品項儲存失敗");
        return;
      }
    }

    // 介紹表色樣：整組重寫（先刪後插，sort_order 依勾選順序）
    const { error: delErr } = await supabase
      .from(TABLE_SERIES_SWATCHES)
      .delete()
      .eq("series_id", row.id);
    if (!delErr && sheetSwatchIds.length > 0) {
      const { error: insErr } = await supabase.from(TABLE_SERIES_SWATCHES).insert(
        sheetSwatchIds.map((swatchId, i) => ({
          series_id: row.id,
          swatch_id: swatchId,
          sort_order: i,
        }))
      );
      if (insErr) {
        setSaving(false);
        toast.error(insErr.message || "介紹表色樣儲存失敗");
        setError(insErr.message || "介紹表色樣儲存失敗");
        return;
      }
    } else if (delErr) {
      setSaving(false);
      toast.error(delErr.message || "介紹表色樣儲存失敗");
      setError(delErr.message || "介紹表色樣儲存失敗");
      return;
    }

    setSaving(false);
    toast.success("已更新系列");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  const contentTab1 = CONTENT_FIELDS.filter((f) => TAB_1_KEYS.includes(f.key));
  const contentTab2 = CONTENT_FIELDS.filter((f) => TAB_2_KEYS.includes(f.key));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-series-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯系列</Dialog.Title>
              <p id="edit-series-desc" className="mt-1 text-sm text-muted-foreground">
                修改系列基本資料與文案
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
            <button
              type="button"
              onClick={() => setActiveTab("basic")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "basic"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              基本資料
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("images")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "images"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Images className="h-4 w-4" />
              圖片
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("sheet")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "sheet"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Palette className="h-4 w-4" />
              介紹表
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("marketing")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "marketing"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-4 w-4" />
              設計與行銷
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("support")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "support"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageCircle className="h-4 w-4" />
              客服與保養
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {activeTab === "basic" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-name" className="text-xs text-muted-foreground">
                      系列名稱 *
                    </label>
                    <input
                      ref={firstRef}
                      id="edit-series-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-name-en" className="text-xs text-muted-foreground">
                      系列名稱（英）
                    </label>
                    <input
                      id="edit-series-name-en"
                      type="text"
                      value={nameEn}
                      onChange={(e) => setNameEn(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="介紹表／價目表英文版用，留空則顯示中文"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-category" className="text-xs text-muted-foreground">
                      類別
                    </label>
                    <input
                      id="edit-series-category"
                      list="edit-series-category-list"
                      type="text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <datalist id="edit-series-category-list">
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-production-time" className="text-xs text-muted-foreground">
                      交期（週）
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="edit-series-production-time"
                        type="number"
                        min={0}
                        step="any"
                        value={productionTime}
                        onChange={(e) => setProductionTime(e.target.value)}
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="例如：3"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">週</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      以週為單位輸入交期，僅做文字紀錄。
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-notes" className="text-xs text-muted-foreground">
                      產品備註
                    </label>
                    <input
                      id="edit-series-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-series-code-rule" className="text-xs text-muted-foreground">
                      編碼原則
                    </label>
                    <textarea
                      id="edit-series-code-rule"
                      value={codeRule}
                      onChange={(e) => setCodeRule(e.target.value)}
                      rows={2}
                      className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：系列縮寫 + 材質 + 尺寸，如：CHA-OAK-120"
                    />
                  </div>
                </>
              )}

              {activeTab === "images" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">主視覺圖</span>
                    <ProductImageDropzone value={imageUrl} onChange={setImageUrl} disabled={saving} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      第二張主視覺圖（官網作品牆滑鼠移過時顯示；未上傳則維持原本微放大效果）
                    </span>
                    <ProductImageDropzone
                      value={hoverImageUrl}
                      onChange={setHoverImageUrl}
                      disabled={saving}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      細節圖（官網產品頁的其他圖片，主視覺圖為首張、細節圖依序接續）
                    </span>
                    <ProductImagesDropzone
                      value={detailImageUrls}
                      onChange={setDetailImageUrls}
                      disabled={saving}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      尺寸圖（張數不限，將依序顯示於官網與產品介紹表）
                    </span>
                    <ProductImagesDropzone
                      value={sizeChartUrls}
                      onChange={setSizeChartUrls}
                      disabled={saving}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <span className="text-xs font-medium text-foreground">
                      官網圖片標題與裁切焦點
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      官網作品頁以 4:5 比例裁切顯示；點圖片設定焦點可避免重點被裁掉，標題會顯示為圖說（尺寸圖不裁切，不需設定）。
                    </span>
                    <SeriesImageMetaEditor
                      images={[
                        ...(imageUrl ? [{ url: imageUrl, label: "主視覺圖" }] : []),
                        ...(hoverImageUrl ? [{ url: hoverImageUrl, label: "第二張主視覺圖" }] : []),
                        ...detailImageUrls.map((url, i) => ({ url, label: `細節圖 ${i + 1}` })),
                      ]}
                      meta={imageMeta}
                      onChange={setImageMeta}
                      disabled={saving}
                    />
                  </div>
                </>
              )}

              {activeTab === "sheet" && (
                <div className="flex flex-col gap-4">
                  {/* 介紹表專用欄位與產品資料獨立：留空＝沿用產品資料對應欄位 */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">主視覺圖（介紹表第一頁）</span>
                    <span className="text-[11px] text-muted-foreground">
                      介紹表專用，與「圖片」分頁的產品主視覺圖各自獨立；未上傳時沿用產品主視覺圖。
                    </span>
                    <ProductImageDropzone
                      value={sheetHeroImageUrl}
                      onChange={setSheetHeroImageUrl}
                      disabled={saving}
                      fallbackPreview={imageUrl}
                    />
                    {!sheetHeroImageUrl && imageUrl && (
                      <span className="text-[11px] text-muted-foreground">目前沿用產品主視覺</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="sheet-design-concept" className="text-xs font-medium text-foreground">
                      設計理念（介紹表第一頁右欄）
                    </label>
                    <textarea
                      id="sheet-design-concept"
                      value={sheetDesignConcept}
                      onChange={(e) => setSheetDesignConcept(e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                      placeholder={
                        contentValues.design_concept?.trim()
                          ? `留空＝沿用「設計與行銷」的設計理念：\n${contentValues.design_concept}`
                          : "介紹表專用；留空＝沿用「設計與行銷」的設計理念"
                      }
                    />
                    <label htmlFor="sheet-design-concept-en" className="mt-1 text-xs text-muted-foreground">
                      設計理念（英）— 英文版用，留空則顯示中文
                    </label>
                    <textarea
                      id="sheet-design-concept-en"
                      value={designConceptEn}
                      onChange={(e) => setDesignConceptEn(e.target.value)}
                      rows={3}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[60px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="sheet-customization-rules" className="text-xs font-medium text-foreground">
                      客製與保養提示（介紹表第二頁色樣區上方小字）
                    </label>
                    <textarea
                      id="sheet-customization-rules"
                      value={sheetCustomizationRules}
                      onChange={(e) => setSheetCustomizationRules(e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                      placeholder={
                        contentValues.customization_rules?.trim()
                          ? `留空＝沿用「客服與保養」的客製與保養：\n${contentValues.customization_rules}`
                          : "介紹表專用；留空＝沿用「客服與保養」的客製與保養"
                      }
                    />
                    <label htmlFor="sheet-customization-rules-en" className="mt-1 text-xs text-muted-foreground">
                      客製與保養（英）— 英文版用，留空則顯示中文
                    </label>
                    <textarea
                      id="sheet-customization-rules-en"
                      value={customizationRulesEn}
                      onChange={(e) => setCustomizationRulesEn(e.target.value)}
                      rows={3}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[60px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">介紹表品項與順序</span>
                    <span className="text-[11px] text-muted-foreground">
                      勾選＝顯示於介紹表（與規格編輯的勾選同步）；用箭頭調整線圖格的顯示順序。
                    </span>
                    <SeriesSheetItemsSelector
                      seriesId={row.id}
                      value={sheetItemIds}
                      onChange={setSheetItemIds}
                      disabled={saving}
                    />
                  </div>
                  <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPriceOnSheet}
                      onChange={(e) => setShowPriceOnSheet(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                      disabled={saving}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-foreground">介紹表顯示報價</span>
                      <span className="text-[11px] text-muted-foreground">
                        預設關閉：介紹表為無價格的品牌文件，價格由獨立價目表承載；開啟後第二頁右欄會列出報價表。
                      </span>
                    </span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">介紹表色樣</span>
                    <span className="text-[11px] text-muted-foreground">
                      勾選要顯示在介紹表第二頁底部的材種／門片／座墊／布樣色樣。
                    </span>
                    <SeriesSwatchesSelector
                      value={sheetSwatchIds}
                      onChange={setSheetSwatchIds}
                      disabled={saving}
                    />
                  </div>
                </div>
              )}

              {activeTab === "marketing" && (
                <>
                  {contentTab1.map(({ key, label }, idx) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <label htmlFor={`edit-series-content-${key}`} className="text-xs text-muted-foreground">
                        {label}
                      </label>
                      <textarea
                        ref={idx === 0 ? firstContentRef : undefined}
                        id={`edit-series-content-${key}`}
                        value={contentValues[key] ?? ""}
                        onChange={(e) => setField(key, e.target.value)}
                        rows={4}
                        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <label htmlFor="edit-series-design-concept-en" className="text-xs text-muted-foreground">
                      設計理念（英）— 介紹表英文版用，留空則顯示中文
                    </label>
                    <textarea
                      id="edit-series-design-concept-en"
                      value={designConceptEn}
                      onChange={(e) => setDesignConceptEn(e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                    />
                  </div>
                </>
              )}

              {activeTab === "support" && (
                <>
                  {contentTab2.map(({ key, label }, idx) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <label htmlFor={`edit-series-content-${key}`} className="text-xs text-muted-foreground">
                        {label}
                      </label>
                      <textarea
                        ref={idx === 0 ? firstContentRef : undefined}
                        id={`edit-series-content-${key}`}
                        value={contentValues[key] ?? ""}
                        onChange={(e) => setField(key, e.target.value)}
                        rows={4}
                        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <label htmlFor="edit-series-customization-rules-en" className="text-xs text-muted-foreground">
                      客製與保養（英）— 介紹表英文版用，留空則顯示中文
                    </label>
                    <textarea
                      id="edit-series-customization-rules-en"
                      value={customizationRulesEn}
                      onChange={(e) => setCustomizationRulesEn(e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
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
                {saving ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
