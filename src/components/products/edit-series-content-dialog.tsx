"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_SERIES, SERIES_CONTENT_COLUMNS, SERIES_WEBSITE_COLUMN } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { X, FileText, MessageCircle, Globe } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SeriesRow } from "@/types/products";

export interface EditSeriesContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SeriesRow | null;
  onSuccess: () => void;
}

/** 文案欄位：key 必須與 product_series 表欄位名稱一致（由 products-db 統一） */
const FIELDS: { key: (typeof SERIES_CONTENT_COLUMNS)[number]; label: string }[] = [
  { key: "design_concept", label: "設計理念" },
  { key: "social_media_copy", label: "社群文案" },
  { key: "website_article", label: "網站文章" },
  { key: "faq_scripts", label: "客服問答" },
  { key: "customization_rules", label: "客製與保養" },
];

/** 依 Tabs 分組：頁籤一 = 設計與行銷，頁籤二 = 客服與保養，頁籤三 = 網站 */
const TAB_1_KEYS = ["design_concept", "social_media_copy", "website_article"];
const TAB_2_KEYS = ["faq_scripts", "customization_rules"];

type ContentTab = "marketing" | "support" | "website";

export function EditSeriesContentDialog({ open, onOpenChange, row, onSuccess }: EditSeriesContentDialogProps) {
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentTab>("marketing");

  useEffect(() => {
    if (open && row) {
      const next: Record<string, string> = {};
      for (const { key } of FIELDS) {
        const v = row[key];
        next[key] = typeof v === "string" ? v : "";
      }
      next[SERIES_WEBSITE_COLUMN] = typeof row.website === "string" ? row.website : "";
      setValues(next);
      setError(null);
      setActiveTab("marketing");
    }
  }, [open, row]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const col of SERIES_CONTENT_COLUMNS) {
      const v = values[col]?.trim();
      payload[col] = v || null;
    }
    const websiteUrl = values[SERIES_WEBSITE_COLUMN]?.trim();
    payload[SERIES_WEBSITE_COLUMN] = websiteUrl || null;
    const { error: err } = await supabase.from(TABLE_PRODUCT_SERIES).update(payload).eq("id", row.id);
    setSaving(false);
    if (err) {
      toast.error(err.message || "更新文案失敗");
      setError(err.message || "更新文案失敗");
      return;
    }
    toast.success("已更新文案");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  const fieldsTab1 = FIELDS.filter((f) => TAB_1_KEYS.includes(f.key));
  const fieldsTab2 = FIELDS.filter((f) => TAB_2_KEYS.includes(f.key));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden flex flex-col rounded-xl border border-border bg-card shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-content-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-0">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯文案</Dialog.Title>
              <p id="edit-content-desc" className="mt-1 text-sm text-muted-foreground">系列：{row.name}</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex border-b border-border bg-muted/20 px-5">
            <button
              type="button"
              onClick={() => setActiveTab("marketing")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "marketing" ? "border-b-2 border-primary bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
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
                activeTab === "support" ? "border-b-2 border-primary bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
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
                activeTab === "website" ? "border-b-2 border-primary bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Globe className="h-4 w-4" />
              網站
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {activeTab === "marketing" &&
                fieldsTab1.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label htmlFor={`edit-content-${key}`} className="text-xs text-muted-foreground">{label}</label>
                    <textarea
                      ref={key === fieldsTab1[0].key ? firstRef : undefined}
                      id={`edit-content-${key}`}
                      value={values[key] ?? ""}
                      onChange={(e) => setField(key, e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                    />
                  </div>
                ))}
              {activeTab === "support" &&
                fieldsTab2.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label htmlFor={`edit-content-${key}`} className="text-xs text-muted-foreground">{label}</label>
                    <textarea
                      ref={key === fieldsTab2[0].key ? firstRef : undefined}
                      id={`edit-content-${key}`}
                      value={values[key] ?? ""}
                      onChange={(e) => setField(key, e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[80px]"
                    />
                  </div>
                ))}
              {activeTab === "website" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-content-website" className="text-xs text-muted-foreground">網站連結</label>
                    <input
                      id="edit-content-website"
                      type="url"
                      value={values[SERIES_WEBSITE_COLUMN] ?? ""}
                      onChange={(e) => setField(SERIES_WEBSITE_COLUMN, e.target.value)}
                      placeholder="https://..."
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full"
                    />
                  </div>
                  {(values[SERIES_WEBSITE_COLUMN] ?? "").trim() && (
                    <a
                      href={(values[SERIES_WEBSITE_COLUMN] ?? "").trim().startsWith("http") ? (values[SERIES_WEBSITE_COLUMN] ?? "").trim() : `https://${(values[SERIES_WEBSITE_COLUMN] ?? "").trim()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Globe className="h-4 w-4" />
                      開啟連結
                    </a>
                  )}
                </div>
              )}
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-5 pt-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
