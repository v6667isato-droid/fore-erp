"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  COMPANY_EVENT_CATEGORY_OPTIONS,
  deleteCompanyEvent,
  updateCompanyEvent,
  type CompanyEventCategory,
  type CompanyEventRow,
} from "@/lib/company-events";
import { isSupabaseConfigured } from "@/lib/supabase";

/** 米白／奶油色字與邊框（Føre 溫潤調） */
const cream = {
  text: "text-[#faf7f2]",
  textMuted: "text-[#ede5d8]",
  textSoft: "text-[#ede5d8]/75",
  border: "border-[#5c4033]/80",
  inputBg: "bg-[#3d2e1e]/90",
  ring: "focus:ring-[#c4a882]",
};

const inputClass = cn(
  "h-10 w-full rounded-lg border px-3 text-sm transition-shadow",
  cream.inputBg,
  cream.border,
  cream.text,
  "placeholder:text-[#ede5d8]/45",
  "focus:outline-none focus:ring-2 focus:border-transparent",
  cream.ring
);

const labelClass = "mb-1.5 block text-xs font-medium text-[#ede5d8]";

export function CompanyCalendarEventDetailModal({
  event,
  onClose,
  onSaved,
}: {
  event: CompanyEventRow | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [category, setCategory] = useState<CompanyEventCategory>("company");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setEventDate(event.event_date);
    setCategory(event.category);
    setDescription(event.description ?? "");
    setDeleteConfirmOpen(false);
  }, [event]);

  if (!event) return null;

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    if (!isSupabaseConfigured) {
      toast.error("Supabase 未設定，無法儲存");
      return;
    }
    const t = title.trim();
    if (!t) {
      toast.error("請填寫事件名稱");
      return;
    }
    if (!eventDate) {
      toast.error("請選擇日期");
      return;
    }
    setSubmitting(true);
    try {
      await updateCompanyEvent({
        id: event.id,
        title: t,
        event_date: eventDate,
        category,
        description: description.trim() || null,
      });
      toast.success("已更新行程");
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "更新失敗";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function executeDelete() {
    if (!event) return;
    if (!isSupabaseConfigured) {
      toast.error("Supabase 未設定，無法刪除");
      return;
    }
    setDeleting(true);
    try {
      await deleteCompanyEvent(event.id);
      toast.success("已刪除行程");
      setDeleteConfirmOpen(false);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "刪除失敗";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-detail-title"
        className={cn(
          "relative max-h-[min(90vh,36rem)] w-full max-w-md overflow-y-auto rounded-xl p-6 shadow-2xl",
          "bg-[#2c2418] ring-1 ring-[#5c4033]/40"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-4 top-4 rounded-lg p-1.5 text-[#ede5d8] transition-colors",
            "hover:bg-white/10 hover:text-[#faf7f2]"
          )}
          aria-label="關閉"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <p className={cn("text-[11px] font-semibold uppercase tracking-wider", cream.textSoft)}>
          編輯行程
        </p>
        <h2
          id="calendar-event-detail-title"
          className={cn("mt-1 pr-10 font-serif text-xl font-semibold tracking-tight", cream.text)}
        >
          {title || "（無標題）"}
        </h2>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="ev-edit-title" className={labelClass}>
              事件名稱
            </label>
            <input
              id="ev-edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={deleting}
              className={cn(inputClass, deleting && "opacity-50")}
              required
            />
          </div>

          <div>
            <label htmlFor="ev-edit-date" className={labelClass}>
              日期
            </label>
            <input
              id="ev-edit-date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              disabled={deleting}
              className={cn(inputClass, deleting && "opacity-50")}
              required
            />
          </div>

          <div>
            <label htmlFor="ev-edit-cat" className={labelClass}>
              類別
            </label>
            <select
              id="ev-edit-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as CompanyEventCategory)}
              disabled={deleting}
              className={cn(inputClass, "cursor-pointer", deleting && "opacity-50")}
            >
              {COMPANY_EVENT_CATEGORY_OPTIONS.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  className="bg-[#2c2418] text-[#faf7f2]"
                >
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ev-edit-desc" className={labelClass}>
              備註說明
            </label>
            <textarea
              id="ev-edit-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={deleting}
              className={cn(inputClass, "min-h-[5.5rem] resize-none py-2", deleting && "opacity-50")}
            />
          </div>

          {deleteConfirmOpen && (
            <div
              className="rounded-lg border border-red-500/35 bg-red-950/25 px-3 py-3 text-sm text-[#ede5d8]"
              role="alert"
            >
              <p className="font-medium text-[#faf7f2]">確定刪除整筆行程？</p>
              <p className="mt-1 text-xs text-[#ede5d8]/85">
                「{title || event.title}」將從行事曆與資料庫移除，無法復原。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteConfirmOpen(false)}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-medium",
                    cream.border,
                    cream.textMuted,
                    "hover:bg-white/5"
                  )}
                >
                  先不要
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void executeDelete()}
                  className="h-9 rounded-lg bg-red-900/80 px-3 text-sm font-medium text-[#faf7f2] hover:bg-red-800/90 disabled:opacity-50"
                >
                  {deleting ? "刪除中…" : "確定刪除"}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={submitting || deleting || deleteConfirmOpen}
              className={cn(
                "order-2 h-10 w-full rounded-lg border border-red-500/40 px-4 text-sm font-medium sm:order-1 sm:w-auto",
                "text-[#f5c4c4] transition-colors hover:bg-red-950/35 hover:text-[#ffe4e4]",
                "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:ring-offset-2 focus:ring-offset-[#2c2418]",
                "disabled:opacity-40"
              )}
            >
              刪除整筆
            </button>
            <div className="order-1 flex w-full flex-col-reverse gap-2 sm:order-2 sm:w-auto sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || deleting}
                className={cn(
                  "h-10 rounded-lg border px-4 text-sm font-medium transition-colors",
                  cream.border,
                  cream.textMuted,
                  "hover:bg-white/5 hover:text-[#faf7f2]",
                  "focus:outline-none focus:ring-2 focus:ring-[#c4a882] focus:ring-offset-2 focus:ring-offset-[#2c2418]",
                  "disabled:opacity-50"
                )}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting || deleting}
                className={cn(
                  "h-10 rounded-lg bg-[#c4a882] px-4 text-sm font-medium text-[#2c2418]",
                  "transition-colors hover:bg-[#b89a72] focus:outline-none focus:ring-2 focus:ring-[#ede5d8] focus:ring-offset-2 focus:ring-offset-[#2c2418]",
                  "disabled:opacity-60"
                )}
              >
                {submitting ? "儲存中…" : "儲存變更"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
