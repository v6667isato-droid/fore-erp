"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAllCompanyAssignments,
  type AdminCompanyAssignmentItem,
} from "@/lib/company-assignments-admin";
import { isSupabaseConfigured, SUPABASE_CONFIG_HELP } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, Inbox, Loader2, Pencil, RefreshCw } from "lucide-react";
import { CompanyCalendarEventDetailModal } from "@/components/company-calendar-event-detail-modal";
import type { CompanyEventRow } from "@/lib/company-events";

function formatMd(iso: string): string {
  const d = (iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso || "—";
  const [y, m, day] = d.split("-").map(Number);
  return `${y}/${m}/${day}`;
}

type StatusFilter = "all" | "open" | "done";

/**
 * 管理端「公司交辦」：彙整所有員工的開會交辦與行事曆交辦（不含生產交辦），
 * 可依員工與完成狀態篩選。放在「員工管理」頁的分頁。
 */
export function CompanyAssignmentsAdmin() {
  const [items, setItems] = useState<AdminCompanyAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CompanyEventRow | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError(SUPABASE_CONFIG_HELP);
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setWarning(null);
    const res = await fetchAllCompanyAssignments();
    if (!res.ok) {
      setError(res.message);
      setItems([]);
    } else {
      setItems(res.items);
      setWarning(res.warning ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      if (!map.has(it.employee_id)) map.set(it.employee_id, it.employee_name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (employeeFilter !== "all" && it.employee_id !== employeeFilter) return false;
      if (statusFilter === "open" && it.completed) return false;
      if (statusFilter === "done" && !it.completed) return false;
      return true;
    });
  }, [items, employeeFilter, statusFilter]);

  const openCount = useMemo(
    () => items.filter((it) => !it.completed).length,
    [items],
  );

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="assignment-employee"
            className="text-xs font-medium text-muted-foreground"
          >
            員工
          </label>
          <select
            id="assignment-employee"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="h-9 min-w-[9rem] rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="all">全部員工</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="inline-flex rounded-xl border border-border bg-muted/30 p-1">
          {(
            [
              { key: "open", label: "待辦" },
              { key: "done", label: "已完成" },
              { key: "all", label: "全部" },
            ] as { key: StatusFilter; label: string }[]
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatusFilter(opt.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                statusFilter === opt.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
              {opt.key === "open" && openCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {openCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          className="ml-auto h-9 shrink-0 gap-2 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          重新整理
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {warning && !error && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-50/80 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {warning}
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          載入交辦事項…
        </p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-14 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "open"
              ? "目前沒有待辦的交辦事項。"
              : statusFilter === "done"
                ? "尚無已完成的交辦事項。"
                : "沒有符合條件的交辦事項。"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => {
            const hasDetail =
              item.source === "calendar" && !!(item.description || item.image_url);
            const isExpanded = expandedKey === item.key;
            return (
              <li
                key={item.key}
                className="rounded-xl border border-border/60 bg-muted/15 px-3 py-3 transition-colors hover:bg-muted/25 sm:px-4"
              >
                <div className="flex gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="shrink-0 rounded-md bg-foreground/8 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                        {item.employee_name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
                          item.source === "meeting"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                        )}
                      >
                        {item.source === "meeting" ? "開會交辦" : "行事曆交辦"}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 truncate font-medium text-foreground",
                          item.completed && "text-muted-foreground line-through decoration-border",
                        )}
                      >
                        {item.content}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium",
                          item.completed
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
                        )}
                      >
                        {item.completed ? "已完成" : "待辦"}
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {formatMd(item.date)}
                      </span>
                      {item.completed && item.completed_at ? (
                        <span className="whitespace-nowrap text-xs text-emerald-700 dark:text-emerald-300 tabular-nums">
                          完成 {formatMd(item.completed_at)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {item.calendar_event && (
                    <button
                      type="button"
                      onClick={() => setEditingEvent(item.calendar_event)}
                      className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      aria-label="編輯交辦事件"
                      title="編輯"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => setExpandedKey(isExpanded ? null : item.key)}
                      className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      aria-label={isExpanded ? "收合細項" : "展開細項"}
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform duration-150",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>
                  )}
                </div>
                {hasDetail && isExpanded && (
                  <div className="mt-2 space-y-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    {item.description && (
                      <p className="whitespace-pre-wrap">{item.description}</p>
                    )}
                    {item.image_url && (
                      <a
                        href={item.image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-fit"
                        title="點擊開啟原圖"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.image_url}
                          alt="交辦附圖"
                          loading="lazy"
                          className="max-h-48 max-w-full rounded-md border border-border/40 object-contain"
                        />
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CompanyCalendarEventDetailModal
        event={editingEvent}
        onClose={() => setEditingEvent(null)}
        onSaved={() => void load()}
      />
    </div>
  );
}
