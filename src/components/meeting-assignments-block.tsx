"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchMeetingAssignmentsForEmployee,
  upsertMeetingAssignmentAssigneeStatus,
  type MeetingAssignmentForEmployeeRow,
} from "@/lib/meeting-minutes";
import {
  fetchCompanyEventAssignmentsForEmployee,
  upsertCompanyEventAssigneeCompleted,
  type CompanyEventAssigneeRow,
} from "@/lib/company-events";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

function formatMd(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, day] = d.split("-").map(Number);
  return `${y}/${m}/${day}`;
}

type UnifiedSource = "meeting" | "calendar";

interface UnifiedItem {
  id: string;
  source: UnifiedSource;
  label: string;
  content: string;
  description: string | null;
  date: string;
  completed: boolean;
  completedAt: string | null;
}

function toUnified(
  meetings: MeetingAssignmentForEmployeeRow[],
  calendar: CompanyEventAssigneeRow[],
): UnifiedItem[] {
  const items: UnifiedItem[] = [];
  for (const m of meetings) {
    items.push({
      id: `m-${m.assignment_id}`,
      source: "meeting",
      label: "開會交辦",
      content: m.content,
      description: null,
      date: m.meeting_date,
      completed: m.completed,
      completedAt: m.status_updated_at,
    });
  }
  for (const c of calendar) {
    items.push({
      id: `c-${c.id}`,
      source: "calendar",
      label: "行事曆交辦",
      content: c.event_title,
      description: c.event_description,
      date: c.event_date,
      completed: c.completed,
      completedAt: c.completed ? c.updated_at : null,
    });
  }
  items.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return b.date.localeCompare(a.date);
  });
  return items;
}

interface MeetingAssignmentsBlockProps {
  employeeId: string;
  meetingDataTick: number;
  onStatusChanged?: () => void;
}

export function MeetingAssignmentsBlock({
  employeeId,
  meetingDataTick,
  onStatusChanged,
}: MeetingAssignmentsBlockProps) {
  const [meetingRows, setMeetingRows] = useState<MeetingAssignmentForEmployeeRow[]>([]);
  const [calendarRows, setCalendarRows] = useState<CompanyEventAssigneeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !employeeId) {
      setMeetingRows([]);
      setCalendarRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [mRes, cRes] = await Promise.all([
        fetchMeetingAssignmentsForEmployee(employeeId),
        fetchCompanyEventAssignmentsForEmployee(employeeId),
      ]);
      if (!mRes.ok) {
        setError(mRes.message);
        setMeetingRows([]);
      } else {
        setMeetingRows(mRes.rows);
      }
      if (!cRes.ok) {
        setError((prev) => (prev ? `${prev}；${cRes.message}` : cRes.message));
        setCalendarRows([]);
      } else {
        setCalendarRows(cRes.rows);
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load, meetingDataTick]);

  const unified = toUnified(meetingRows, calendarRows);

  async function toggleCompleted(item: UnifiedItem, completed: boolean) {
    if (!isSupabaseConfigured) {
      toast.success("（Mock）僅示意，連線後會寫入資料庫。");
      return;
    }
    setPendingId(item.id);
    try {
      if (item.source === "meeting") {
        const rawId = item.id.slice(2);
        const r = await upsertMeetingAssignmentAssigneeStatus({
          assignmentId: rawId,
          employeeId,
          completed,
        });
        if (!r.ok) { toast.error(r.message); return; }
        setMeetingRows((prev) =>
          prev.map((x) =>
            x.assignment_id === rawId
              ? { ...x, completed, status_updated_at: new Date().toISOString() }
              : x,
          ),
        );
      } else {
        const rawId = item.id.slice(2);
        const r = await upsertCompanyEventAssigneeCompleted({
          assigneeRowId: rawId,
          completed,
        });
        if (!r.ok) { toast.error(r.message); return; }
        setCalendarRows((prev) =>
          prev.map((x) =>
            x.id === rawId
              ? { ...x, completed, updated_at: new Date().toISOString() }
              : x,
          ),
        );
      }
      onStatusChanged?.();
    } finally {
      setPendingId(null);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        連線 Supabase 後可在此勾選交辦事項之完成狀態。
      </p>
    );
  }

  if (loading && unified.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        載入交辦事項…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        無法載入交辦事項：{error}
      </p>
    );
  }

  if (unified.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">目前沒有指派給您的交辦事項。</p>
    );
  }

  const openItems = unified.filter((x) => !x.completed);
  const doneItems = unified.filter((x) => x.completed);
  const visible = tab === "open" ? openItems : doneItems;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab("open")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "open"
              ? "bg-secondary text-secondary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          待辦
          {openItems.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums">
              {openItems.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab("done")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "done"
              ? "bg-secondary text-secondary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          已完成
          {doneItems.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums">
              {doneItems.length}
            </span>
          ) : null}
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          {tab === "open" ? "沒有待辦的交辦事項。" : "尚無已完成的交辦事項。"}
        </p>
      ) : (
    <ul className="space-y-2 pr-2">
      {visible.map((item) => {
        const busy = pendingId === item.id;
        const hasDetail = item.source === "calendar" && item.description;
        const isExpanded = expandedId === item.id;

        return (
          <li
            key={item.id}
            className={cn(
              "rounded-xl border border-border/60 px-3 py-3 sm:px-4",
              "bg-muted/15 transition-colors hover:bg-muted/25",
            )}
          >
            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={busy}
                  onChange={(e) => void toggleCompleted(item, e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-input text-primary focus:ring-ring"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
                        item.source === "meeting"
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                      )}
                    >
                      {item.label}
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
                    {item.completed && item.completedAt ? (
                      <span className="whitespace-nowrap text-xs text-emerald-700 dark:text-emerald-300 tabular-nums">
                        完成 {formatMd(item.completedAt)}
                      </span>
                    ) : null}
                    {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
                  </span>
                </span>
              </label>
              {hasDetail && (
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
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
              <div className="ml-7 mt-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {item.description}
              </div>
            )}
          </li>
        );
      })}
    </ul>
      )}
    </div>
  );
}
