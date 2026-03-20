"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COMPANY_EVENT_CATEGORY_OPTIONS,
  type CompanyEventCategory,
  insertCompanyEvent,
} from "@/lib/company-events";
import { isSupabaseConfigured } from "@/lib/supabase";

export function CompanyCalendarAddEventDialog({
  open,
  onOpenChange,
  defaultDate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(defaultDate);
  const [category, setCategory] = useState<CompanyEventCategory>("company");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEventDate(defaultDate);
    }
  }, [open, defaultDate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast.error("Supabase 未設定，無法寫入 company_event");
      return;
    }
    const t = title.trim();
    if (!t) {
      toast.error("請填寫標題");
      return;
    }
    if (!eventDate) {
      toast.error("請選擇日期");
      return;
    }
    setSubmitting(true);
    try {
      await insertCompanyEvent({
        title: t,
        event_date: eventDate,
        category,
        description: description.trim() || null,
      });
      toast.success("已新增事件");
      setTitle("");
      setDescription("");
      setCategory("company");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "新增失敗";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,36rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground">新增事件</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                寫入資料表 <span className="font-mono text-xs">company_event</span>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="ce-title" className="mb-1.5 block text-sm font-medium text-foreground">
                標題
              </label>
              <input
                id="ce-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：塗裝線停機保養"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="ce-date" className="mb-1.5 block text-sm font-medium text-foreground">
                日期
              </label>
              <input
                id="ce-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="ce-cat" className="mb-1.5 block text-sm font-medium text-foreground">
                類別
              </label>
              <select
                id="ce-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as CompanyEventCategory)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {COMPANY_EVENT_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ce-desc" className="mb-1.5 block text-sm font-medium text-foreground">
                描述
              </label>
              <textarea
                id="ce-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="補充說明（選填）"
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={submitting}>
                {submitting ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
