"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COMPANY_EVENT_CATEGORY_OPTIONS,
  type CompanyEventCategory,
  insertCompanyEvent,
  insertCompanyEventAssignees,
} from "@/lib/company-events";
import {
  fetchActiveEmployeesForMeeting,
  type ActiveEmployeeOption,
} from "@/lib/meeting-minutes";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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
  const [category, setCategory] = useState<CompanyEventCategory>("delivery");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [staff, setStaff] = useState<ActiveEmployeeOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [assigneePanelOpen, setAssigneePanelOpen] = useState(false);
  const [staffFilter, setStaffFilter] = useState("");

  useEffect(() => {
    if (open) {
      setEventDate(defaultDate);
    }
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open || !isSupabaseConfigured) return;
    let cancelled = false;
    setStaffLoading(true);
    (async () => {
      const res = await fetchActiveEmployeesForMeeting();
      if (!cancelled && res.ok) setStaff(res.rows);
      if (!cancelled) setStaffLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

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
      const eventId = await insertCompanyEvent({
        title: t,
        event_date: eventDate,
        category,
        description: description.trim() || null,
      });

      if (selectedEmployees.size > 0) {
        await insertCompanyEventAssignees(eventId, Array.from(selectedEmployees));
      }

      const msg =
        selectedEmployees.size > 0
          ? `已新增事件，並指派 ${selectedEmployees.size} 位員工`
          : "已新增事件";
      toast.success(msg);
      setTitle("");
      setDescription("");
      setCategory("delivery");
      setSelectedEmployees(new Set());
      setAssigneePanelOpen(false);
      setStaffFilter("");
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,44rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none">
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                {COMPANY_EVENT_CATEGORY_OPTIONS.find((o) => o.value === category)?.description}
              </p>
            </div>
            <div>
              <label htmlFor="ce-desc" className="mb-1.5 block text-sm font-medium text-foreground">
                描述
              </label>
              <textarea
                id="ce-desc"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="補充說明（選填）"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* ─── 指派員工 ─── */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors rounded-lg"
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
