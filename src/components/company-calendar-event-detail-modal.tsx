"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COMPANY_EVENT_CATEGORY_OPTIONS,
  deleteCompanyEvent,
  fetchCompanyEventAssigneeIds,
  syncCompanyEventAssignees,
  updateCompanyEvent,
  type CompanyEventCategory,
  type CompanyEventRow,
} from "@/lib/company-events";
import {
  fetchActiveEmployeesForMeeting,
  type ActiveEmployeeOption,
} from "@/lib/meeting-minutes";
import { isSupabaseConfigured } from "@/lib/supabase";

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

  const [staff, setStaff] = useState<ActiveEmployeeOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [assigneePanelOpen, setAssigneePanelOpen] = useState(false);
  const [staffFilter, setStaffFilter] = useState("");

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setEventDate(event.event_date);
    setCategory(event.category);
    setDescription(event.description ?? "");
    setDeleteConfirmOpen(false);
    setAssigneePanelOpen(false);
    setStaffFilter("");

    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setStaffLoading(true);

    (async () => {
      const [staffRes, ids] = await Promise.all([
        fetchActiveEmployeesForMeeting(),
        fetchCompanyEventAssigneeIds(event.id),
      ]);
      if (cancelled) return;
      if (staffRes.ok) setStaff(staffRes.rows);
      setSelectedEmployees(new Set(ids));
      setStaffLoading(false);
    })();

    return () => { cancelled = true; };
  }, [event]);

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedEmployees.size === staff.length) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(staff.map((s) => s.id)));
    }
  }

  const filteredStaff = staffFilter.trim()
    ? staff.filter((s) => s.name.includes(staffFilter.trim()))
    : staff;

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

      await syncCompanyEventAssignees(event.id, Array.from(selectedEmployees));

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
    <Dialog.Root open={event != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,44rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground">編輯事件</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                修改資料表 <span className="font-mono text-xs">company_event</span>
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="ev-edit-title" className="mb-1.5 block text-sm font-medium text-foreground">
                標題
              </label>
              <input
                id="ev-edit-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={deleting}
                className={cn(
                  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  deleting && "opacity-50",
                )}
                required
              />
            </div>

            <div>
              <label htmlFor="ev-edit-date" className="mb-1.5 block text-sm font-medium text-foreground">
                日期
              </label>
              <input
                id="ev-edit-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                disabled={deleting}
                className={cn(
                  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  deleting && "opacity-50",
                )}
                required
              />
            </div>

            <div>
              <label htmlFor="ev-edit-cat" className="mb-1.5 block text-sm font-medium text-foreground">
                類別
              </label>
              <select
                id="ev-edit-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as CompanyEventCategory)}
                disabled={deleting}
                className={cn(
                  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  deleting && "opacity-50",
                )}
              >
                {COMPANY_EVENT_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ev-edit-desc" className="mb-1.5 block text-sm font-medium text-foreground">
                描述
              </label>
              <textarea
                id="ev-edit-desc"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={deleting}
                placeholder="補充說明（選填）"
                className={cn(
                  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  deleting && "opacity-50",
                )}
              />
            </div>

            {/* ─── 指派員工 ─── */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                disabled={deleting}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors rounded-lg",
                  deleting && "opacity-50",
                )}
                onClick={() => setAssigneePanelOpen((v) => !v)}
              >
                <span>
                  指派員工
                  {selectedEmployees.size > 0 && (
                    <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      {selectedEmployees.size}
                    </span>
                  )}
                </span>
                {assigneePanelOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {assigneePanelOpen && (
                <div className="border-t border-border px-3 py-3 space-y-2.5">
                  {staffLoading ? (
                    <p className="text-sm text-muted-foreground">載入員工清單…</p>
                  ) : staff.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isSupabaseConfigured ? "目前沒有在職員工" : "請連線 Supabase 以載入員工"}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={staffFilter}
                          onChange={(e) => setStaffFilter(e.target.value)}
                          placeholder="搜尋員工…"
                          className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={toggleAll}
                          className="shrink-0 rounded-md border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          {selectedEmployees.size === staff.length ? "取消全選" : "全選"}
                        </button>
                      </div>
                      <ul className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3">
                        {filteredStaff.map((s) => {
                          const checked = selectedEmployees.has(s.id);
                          return (
                            <li key={s.id}>
                              <label
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                  checked
                                    ? "bg-primary/10 text-foreground"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleEmployee(s.id)}
                                  className="size-3.5 shrink-0 rounded border-input text-primary focus:ring-ring"
                                />
                                <span className="min-w-0 truncate">{s.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {selectedEmployees.size > 0 && (
                        <p className="text-xs text-muted-foreground">
                          已選 {selectedEmployees.size} 位，儲存後將同步至員工儀表板交辦事項
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ─── 刪除確認 ─── */}
            {deleteConfirmOpen && (
              <div
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900 dark:border-red-500/35 dark:bg-red-950/25 dark:text-red-200"
                role="alert"
              >
                <p className="font-medium">確定刪除整筆行程？</p>
                <p className="mt-1 text-xs text-red-700 dark:text-red-300/85">
                  「{title || event?.title}」將從行事曆與資料庫移除，無法復原。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleting}
                    onClick={() => setDeleteConfirmOpen(false)}
                    className="h-9"
                  >
                    先不要
                  </Button>
                  <Button
                    type="button"
                    disabled={deleting}
                    onClick={(e) => {
                      e.preventDefault();
                      void executeDelete();
                    }}
                    className="h-9 bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
                  >
                    {deleting ? "刪除中…" : "確定刪除"}
                  </Button>
                </div>
              </div>
            )}

            {/* ─── 按鈕列 ─── */}
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || deleting}
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteConfirmOpen((v) => !v);
                }}
                className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-500/40 dark:hover:bg-red-950/30"
              >
                {deleteConfirmOpen ? "取消刪除" : "刪除整筆"}
              </Button>
              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={submitting || deleting}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={submitting || deleting}>
                  {submitting ? "儲存中…" : "儲存變更"}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
