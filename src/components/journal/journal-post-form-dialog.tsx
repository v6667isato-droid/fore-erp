"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  TABLE_JOURNAL_POSTS,
  JOURNAL_TAG_LABEL,
  JOURNAL_TAG_OPTIONS,
  type JournalBlock,
  type JournalPostRow,
  type JournalTag,
} from "@/lib/journal-db";
import { Button } from "@/components/ui/button";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import { JournalBlockEditor, JOURNAL_IMAGES_BUCKET } from "@/components/journal/journal-block-editor";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Image as ImageIcon, Languages, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface JournalPostFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null 為新增；有值為編輯 */
  row: JournalPostRow | null;
  onSuccess: () => void;
}

type FormTab = "basic" | "content_zh" | "content_en";

/** 移除內容為空的區塊（沒字的文字區塊、沒圖的圖片區塊），存檔前整理 */
function pruneBlocks(blocks: JournalBlock[]): JournalBlock[] {
  return blocks.filter((b) => (b.type === "image" ? b.url.trim() !== "" : b.text.trim() !== ""));
}

/** 日誌文章的新增與編輯表單：基本資料＋中英文內文區塊編輯器 */
export function JournalPostFormDialog({ open, onOpenChange, row, onSuccess }: JournalPostFormDialogProps) {
  const isEdit = row != null;
  const firstRef = useRef<HTMLInputElement>(null);

  const [postCode, setPostCode] = useState("");
  const [tag, setTag] = useState<JournalTag>("work");
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [excerptZh, setExcerptZh] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [postDate, setPostDate] = useState("");
  const [contentZh, setContentZh] = useState<JournalBlock[]>([]);
  const [contentEn, setContentEn] = useState<JournalBlock[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [objectPosition, setObjectPosition] = useState("");
  const [published, setPublished] = useState(false);
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPostCode(row?.post_code ?? "");
    setTag(row?.tag ?? "work");
    setTitleZh(row?.title_zh ?? "");
    setTitleEn(row?.title_en ?? "");
    setExcerptZh(row?.excerpt_zh ?? "");
    setExcerptEn(row?.excerpt_en ?? "");
    setPostDate(row?.post_date ?? new Date().toISOString().slice(0, 10));
    setContentZh(row?.content_zh ?? []);
    setContentEn(row?.content_en ?? []);
    setImageUrl(row?.image_url ?? null);
    setObjectPosition(row?.object_position ?? "");
    setPublished(row?.published ?? false);
    setNotes(row?.notes ?? "");
    setActiveTab("basic");
    setError(null);
    setTimeout(() => firstRef.current?.focus(), 0);
  }, [open, row]);

  /** AI 中翻英：標題、摘要、內文區塊一次翻好填入英文欄位（圖片沿用、圖說翻譯） */
  async function translateFromZh() {
    const zhBlocks = pruneBlocks(contentZh);
    if (!titleZh.trim() && !excerptZh.trim() && zhBlocks.length === 0) {
      toast.error("請先填寫中文標題或內文再翻譯");
      return;
    }
    setTranslating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("登入已失效，請重新登入");
        return;
      }

      // 依序：標題、摘要、每個區塊的文字（圖片區塊取圖說），回傳等長陣列後照順序填回
      const segments: string[] = [
        titleZh.trim(),
        excerptZh.trim(),
        ...zhBlocks.map((b) => (b.type === "image" ? (b.caption ?? "") : b.text)),
      ];

      const res = await fetch("/api/journal/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ segments }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.translations)) {
        toast.error(data?.error || "翻譯失敗，請稍後再試");
        return;
      }

      const translations: string[] = data.translations;
      setTitleEn(translations[0] ?? "");
      setExcerptEn(translations[1] ?? "");
      setContentEn(
        zhBlocks.map((b, i) => {
          const t = translations[i + 2] ?? "";
          if (b.type === "image") {
            return t.trim() ? { type: "image", url: b.url, caption: t.trim() } : { type: "image", url: b.url };
          }
          return { type: b.type, text: t };
        })
      );
      setActiveTab("content_en");
      toast.success("已翻譯完成，請檢查英文內容後儲存");
    } catch (err) {
      console.error("journal translate error:", err);
      toast.error("翻譯失敗，請稍後再試");
    } finally {
      setTranslating(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!postCode.trim()) {
      setError("請輸入文章編號（官網網址會用到，例：JN04）");
      setActiveTab("basic");
      return;
    }
    if (!titleZh.trim()) {
      setError("請輸入標題（中文）");
      setActiveTab("basic");
      return;
    }
    if (!postDate) {
      setError("請選擇文章日期");
      setActiveTab("basic");
      return;
    }
    setSaving(true);

    const payload = {
      post_code: postCode.trim(),
      tag,
      title_zh: titleZh.trim(),
      title_en: titleEn.trim() || null,
      excerpt_zh: excerptZh.trim() || null,
      excerpt_en: excerptEn.trim() || null,
      post_date: postDate,
      content_zh: pruneBlocks(contentZh),
      content_en: pruneBlocks(contentEn),
      image_url: imageUrl?.trim() || null,
      object_position: objectPosition.trim() || null,
      published,
      notes: notes.trim() || null,
    };

    const { error: err } = isEdit
      ? await supabase.from(TABLE_JOURNAL_POSTS).update(payload).eq("id", row.id)
      : await supabase.from(TABLE_JOURNAL_POSTS).insert(payload);

    setSaving(false);
    if (err) {
      const msg = err.message?.includes("journal_posts_post_code_key")
        ? `文章編號「${postCode.trim()}」已存在，請改用其他編號`
        : err.message || `${isEdit ? "更新" : "新增"}失敗`;
      toast.error(msg);
      setError(msg);
      return;
    }
    toast.success(isEdit ? "已更新日誌文章" : "已新增日誌文章");
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

  const inputClass =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="journal-post-form-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? "編輯日誌文章" : "新增日誌文章"}
              </Dialog.Title>
              <p id="journal-post-form-desc" className="mt-1 text-sm text-muted-foreground">
                內文在「內文」分頁以區塊排版（段落、小標、引言、圖片），發佈後顯示於官網 Journal。
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
              <ImageIcon className="h-4 w-4" />
              基本資料與主圖
            </button>
            <button type="button" onClick={() => setActiveTab("content_zh")} className={tabClass("content_zh")}>
              <Languages className="h-4 w-4" />
              內文（中文）
            </button>
            <button type="button" onClick={() => setActiveTab("content_en")} className={tabClass("content_en")}>
              <Languages className="h-4 w-4" />
              內文（英文）
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {activeTab === "basic" && (
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
                        勾選後此文章會顯示在官網 Journal 頁面
                      </span>
                    </span>
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="journal-form-code" className="text-xs text-muted-foreground">
                        文章編號 *
                      </label>
                      <input
                        ref={firstRef}
                        id="journal-form-code"
                        type="text"
                        value={postCode}
                        onChange={(e) => setPostCode(e.target.value)}
                        className={inputClass}
                        placeholder="例：JN04"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="journal-form-tag" className="text-xs text-muted-foreground">
                        分類
                      </label>
                      <select
                        id="journal-form-tag"
                        value={tag}
                        onChange={(e) => setTag(e.target.value as JournalTag)}
                        className={inputClass}
                      >
                        {JOURNAL_TAG_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {JOURNAL_TAG_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="journal-form-date" className="text-xs text-muted-foreground">
                        文章日期 *
                      </label>
                      <input
                        id="journal-form-date"
                        type="date"
                        value={postDate}
                        onChange={(e) => setPostDate(e.target.value)}
                        className={inputClass}
                        required
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-title-zh" className="text-xs text-muted-foreground">
                      標題（中文）*
                    </label>
                    <input
                      id="journal-form-title-zh"
                      type="text"
                      value={titleZh}
                      onChange={(e) => setTitleZh(e.target.value)}
                      className={inputClass}
                      placeholder="例：關於木節"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-title-en" className="text-xs text-muted-foreground">
                      標題（英文）
                    </label>
                    <input
                      id="journal-form-title-en"
                      type="text"
                      value={titleEn}
                      onChange={(e) => setTitleEn(e.target.value)}
                      className={inputClass}
                      placeholder="例：On Knots"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-excerpt-zh" className="text-xs text-muted-foreground">
                      摘要（中文）— 顯示於官網文章列表
                    </label>
                    <textarea
                      id="journal-form-excerpt-zh"
                      value={excerptZh}
                      onChange={(e) => setExcerptZh(e.target.value)}
                      rows={2}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[48px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-excerpt-en" className="text-xs text-muted-foreground">
                      摘要（英文）
                    </label>
                    <textarea
                      id="journal-form-excerpt-en"
                      value={excerptEn}
                      onChange={(e) => setExcerptEn(e.target.value)}
                      rows={2}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[48px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">列表主圖</span>
                    <ProductImageDropzone
                      bucket={JOURNAL_IMAGES_BUCKET}
                      value={imageUrl}
                      onChange={setImageUrl}
                      disabled={saving}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-object-position" className="text-xs text-muted-foreground">
                      主圖裁切焦點（object-position）
                    </label>
                    <input
                      id="journal-form-object-position"
                      type="text"
                      value={objectPosition}
                      onChange={(e) => setObjectPosition(e.target.value)}
                      className={inputClass}
                      placeholder='例："50% 30%"，留空為置中'
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="journal-form-notes" className="text-xs text-muted-foreground">
                      內部備註
                    </label>
                    <textarea
                      id="journal-form-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[48px]"
                      placeholder="僅內部可見，不會出現在官網"
                    />
                  </div>
                </>
              )}

              {activeTab === "content_zh" && (
                <JournalBlockEditor
                  idPrefix="中文內文"
                  value={contentZh}
                  onChange={setContentZh}
                  disabled={saving}
                />
              )}

              {activeTab === "content_en" && (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      可用 AI 依「內文（中文）」與中文標題、摘要自動翻譯，會覆蓋現有英文內容，翻完可再修改。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 shrink-0 gap-1.5 px-3 text-xs"
                      disabled={saving || translating}
                      onClick={() => void translateFromZh()}
                    >
                      {translating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {translating ? "翻譯中…" : "AI 從中文翻譯"}
                    </Button>
                  </div>
                  <JournalBlockEditor
                    idPrefix="英文內文"
                    value={contentEn}
                    onChange={setContentEn}
                    disabled={saving || translating}
                  />
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
                {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增文章"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
