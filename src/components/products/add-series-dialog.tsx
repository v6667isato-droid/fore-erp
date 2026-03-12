"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_SERIES, SERIES_CONTENT_COLUMNS, SERIES_WEBSITE_COLUMN } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { Plus, X, FileText, MessageCircle, Globe } from "lucide-react";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface AddSeriesDialogProps {
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = ["桌", "椅", "櫃", "層架", "其他"];

/** 文案欄位設定，key 必須與 product_series 表欄位名稱一致 */
const CONTENT_FIELDS: { key: (typeof SERIES_CONTENT_COLUMNS)[number]; label: string }[] = [
  { key: "design_concept", label: "設計理念" },
  { key: "social_media_copy", label: "社群文案" },
  { key: "website_article", label: "網站文章" },
  { key: "faq_scripts", label: "客服問答" },
  { key: "customization_rules", label: "客製與保養" },
];

const TAB_1_KEYS = ["design_concept", "social_media_copy", "website_article"];
const TAB_2_KEYS = ["faq_scripts", "customization_rules"];

type AddSeriesTab = "basic" | "marketing" | "support" | "website";

export function AddSeriesDialog({ onSuccess }: AddSeriesDialogProps) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const firstContentRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [productionTime, setProductionTime] = useState("");
  const [codeRule, setCodeRule] = useState("");
  const [contentValues, setContentValues] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AddSeriesTab>("basic");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCategory("");
      setNotes("");
      setProductionTime("");
      setCodeRule("");
      setContentValues({});
      setWebsite("");
      setImageUrl(null);
      setActiveTab("basic");
      setError(null);
    }
  }, [open]);

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
    setError(null);
    if (!name.trim()) {
      setError("請輸入系列名稱");
      return;
    }
    setAdding(true);

    // 寫入所有基本欄位 + 文案欄位（以 series_name 為主鍵名稱）
    const payload: Record<string, unknown> = {
      series_name: name.trim(),
      category: category.trim() || null,
      notes: notes.trim() || null,
      production_time: productionTime.trim() || null,
      code_rule: codeRule.trim() || null,
    };

    for (const col of SERIES_CONTENT_COLUMNS) {
      const v = contentValues[col]?.trim();
      payload[col] = v || null;
    }
    const websiteUrl = website.trim();
    payload[SERIES_WEBSITE_COLUMN] = websiteUrl || null;
    payload.image_url = imageUrl?.trim() || null;

    let { error: err } = await supabase.from(TABLE_PRODUCT_SERIES).insert(payload);

    setAdding(false);
    if (err) {
      toast.error(err.message || "新增系列失敗");
      setError(err.message || "新增系列失敗");
      return;
    }
    toast.success("已新增系列");
    setOpen(false);
    onSuccess();
  }

  const contentTab1 = CONTENT_FIELDS.filter((f) => TAB_1_KEYS.includes(f.key));
  const contentTab2 = CONTENT_FIELDS.filter((f) => TAB_2_KEYS.includes(f.key));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          新增系列
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-series-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增系列</Dialog.Title>
              <p id="add-series-desc" className="mt-1 text-sm text-muted-foreground">
                建立產品系列後，可在此管理文案與規格。
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
            <button
              type="button"
              onClick={() => setActiveTab("website")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "website"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Globe className="h-4 w-4" />
              網站
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {activeTab === "basic" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-series-name" className="text-xs text-muted-foreground">
                      系列名稱 *
                    </label>
                    <input
                      ref={firstRef}
                      id="add-series-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="系列名稱"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-series-category" className="text-xs text-muted-foreground">
                      類別
                    </label>
                    <input
                      id="add-series-category"
                      list="add-series-category-list"
                      type="text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：桌、椅"
                    />
                    <datalist id="add-series-category-list">
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-series-production-time" className="text-xs text-muted-foreground">
                      交期（週）
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="add-series-production-time"
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
                    <label htmlFor="add-series-notes" className="text-xs text-muted-foreground">
                      產品備註
                    </label>
                    <input
                      id="add-series-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="顯示在系列名稱旁"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-series-code-rule" className="text-xs text-muted-foreground">
                      編碼原則
                    </label>
                    <textarea
                      id="add-series-code-rule"
                      value={codeRule}
                      onChange={(e) => setCodeRule(e.target.value)}
                      rows={2}
                      className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="例：系列縮寫 + 材質 + 尺寸，如：CHA-OAK-120"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">主視覺圖</span>
                    <ProductImageDropzone value={imageUrl} onChange={setImageUrl} disabled={adding} />
                  </div>
                </>
              )}

              {activeTab === "marketing" &&
                contentTab1.map(({ key, label }, idx) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label htmlFor={`add-series-content-${key}`} className="text-xs text-muted-foreground">
                      {label}
                    </label>
                    <textarea
                      ref={idx === 0 ? firstContentRef : undefined}
                      id={`add-series-content-${key}`}
                      value={contentValues[key] ?? ""}
                      onChange={(e) => setField(key, e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                    />
                  </div>
                ))}

              {activeTab === "support" &&
                contentTab2.map(({ key, label }, idx) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label htmlFor={`add-series-content-${key}`} className="text-xs text-muted-foreground">
                      {label}
                    </label>
                    <textarea
                      ref={idx === 0 ? firstContentRef : undefined}
                      id={`add-series-content-${key}`}
                      value={contentValues[key] ?? ""}
                      onChange={(e) => setField(key, e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                    />
                  </div>
                ))}

              {activeTab === "website" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-series-website" className="text-xs text-muted-foreground">
                      網站連結
                    </label>
                    <input
                      id="add-series-website"
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://..."
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full"
                    />
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={adding}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={adding}>
                {adding ? "新增中…" : "新增系列"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
