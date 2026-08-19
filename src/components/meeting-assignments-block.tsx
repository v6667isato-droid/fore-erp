"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchMeetingAssignmentsForEmployee,
  upsertMeetingAssignmentAssigneeStatus,
  type MeetingAssignmentForEmployeeRow,
} from "@/lib/meeting-minutes";
import {
  fetchCompanyEventAssignmentsForEmployee,
  splitAssignmentImage,
  upsertCompanyEventAssigneeCompleted,
  type CompanyEventAssigneeRow,
} from "@/lib/company-events";
import {
  fetchStocktakeTasksForEmployee,
  setStocktakeTaskCompleted,
  type StocktakeTaskRow,
} from "@/lib/stocktake-tasks";
import { StocktakeDialog } from "@/components/inventory/stocktake-dialog";
import {
  fetchPartMakeTasksForEmployee,
  setPartMakeTaskCompleted,
  type PartMakeTaskRow,
} from "@/lib/part-make-tasks";
import { CompleteMakeTaskDialog } from "@/components/inventory/complete-make-task-dialog";
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

type UnifiedSource = "meeting" | "calendar" | "stocktake" | "make";

interface UnifiedItem {
  id: string;
  source: UnifiedSource;
  label: string;
  content: string;
  description: string | null;
  imageUrl: string | null;
  date: string;
  completed: boolean;
  completedAt: string | null;
  /** 盤點交辦：限定分類（null＝全部零件） */
  stocktakeCategory?: string | null;
  /** 盤點交辦：自選零件清單（非空時優先於分類） */
  stocktakePartIds?: string[] | null;
  /** 製作交辦：完整任務列（完成回報視窗用） */
  makeTask?: PartMakeTaskRow;
}

function toUnified(
  meetings: MeetingAssignmentForEmployeeRow[],
  calendar: CompanyEventAssigneeRow[],
  stocktakes: StocktakeTaskRow[],
  makes: PartMakeTaskRow[],
): UnifiedItem[] {
  const items: UnifiedItem[] = [];
  for (const m of meetings) {
    items.push({
      id: `m-${m.assignment_id}`,
      source: "meeting",
      label: "開會交辦",
      content: m.content,
      description: null,
      imageUrl: null,
      date: m.meeting_date,
      completed: m.completed,
      completedAt: m.status_updated_at,
    });
  }
  for (const c of calendar) {
    const { text, imageUrl } = splitAssignmentImage(c.event_description, c.event_image_url);
    items.push({
      id: `c-${c.id}`,
      source: "calendar",
      label: "行事曆交辦",
      content: c.event_title,
      description: text,
      imageUrl,
      date: c.event_date,
      completed: c.completed,
      completedAt: c.completed ? c.updated_at : null,
    });
  }
  for (const s of stocktakes) {
    items.push({
      id: `s-${s.id}`,
      source: "stocktake",
      label: "盤點交辦",
      content:
        s.part_ids && s.part_ids.length > 0
          ? `盤點零件：指定 ${s.part_ids.length} 顆`
          : s.category
            ? `盤點零件：${s.category}`
            : "盤點零件：全部",
      description: s.instructions,
      imageUrl: null,
      date: s.due_date ?? (s.created_at ?? "").slice(0, 10),
      completed: s.completed,
      completedAt: s.completed_at,
      stocktakeCategory: s.category,
      stocktakePartIds: s.part_ids,
    });
  }
  for (const mk of makes) {
    const lines = mk.items.map((it) => `${it.part_no}｜${it.name} 預計 ${it.quantity}${it.unit}`);
    items.push({
      id: `k-${mk.id}`,
      source: "make",
      label: "製作交辦",
      content:
        mk.items.length === 1
          ? `製作零件：${mk.items[0].name} 預計 ${mk.items[0].quantity}`
          : `製作零件：${mk.items.length} 項`,
      description: [lines.join("\n"), mk.instructions].filter(Boolean).join("\n\n") || null,
      imageUrl: null,
      date: mk.due_date ?? (mk.created_at ?? "").slice(0, 10),
      completed: mk.completed,
      completedAt: mk.completed_at,
      makeTask: mk,
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
  const [stocktakeRows, setStocktakeRows] = useState<StocktakeTaskRow[]>([]);
  const [makeRows, setMakeRows] = useState<PartMakeTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  /** 點「開始盤點」後開啟的盤點視窗（任務 id＋分類範圍） */
  const [activeStocktake, setActiveStocktake] = useState<{
    taskId: string;
    category: string | null;
    partIds: string[] | null;
  } | null>(null);
  /** 點「完成回報」後開啟的製作回報視窗 */
  const [activeMakeTask, setActiveMakeTask] = useState<PartMakeTaskRow | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !employeeId) {
      setMeetingRows([]);
      setCalendarRows([]);
      setStocktakeRows([]);
      setMakeRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [mRes, cRes, sRes, kRes] = await Promise.all([
        fetchMeetingAssignmentsForEmployee(employeeId),
        fetchCompanyEventAssignmentsForEmployee(employeeId),
        fetchStocktakeTasksForEmployee(employeeId),
        fetchPartMakeTasksForEmployee(employeeId),
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
      if (!sRes.ok) {
        setError((prev) => (prev ? `${prev}；${sRes.message}` : sRes.message));
        setStocktakeRows([]);
      } else {
        setStocktakeRows(sRes.rows);
      }
      if (!kRes.ok) {
        setError((prev) => (prev ? `${prev}；${kRes.message}` : kRes.message));
        setMakeRows([]);
      } else {
        setMakeRows(kRes.rows);
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load, meetingDataTick]);

  const unified = toUnified(meetingRows, calendarRows, stocktakeRows, makeRows);

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
      } else if (item.source === "calendar") {
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
      } else if (item.source === "stocktake") {
        const rawId = item.id.slice(2);
        const r = await setStocktakeTaskCompleted({ taskId: rawId, completed });
        if (!r.ok) { toast.error(r.message); return; }
        setStocktakeRows((prev) =>
          prev.map((x) =>
            x.id === rawId
              ? { ...x, completed, completed_at: completed ? new Date().toISOString() : null }
              : x,
          ),
        );
      } else {
        const rawId = item.id.slice(2);
        const r = await setPartMakeTaskCompleted({ taskId: rawId, completed });
        if (!r.ok) { toast.error(r.message); return; }
        setMakeRows((prev) =>
          prev.map((x) =>
            x.id === rawId
              ? { ...x, completed, completed_at: completed ? new Date().toISOString() : null }
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
        const hasDetail =
          item.source !== "meeting" && (item.description || item.imageUrl);
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
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={busy}
                  onChange={(e) => void toggleCompleted(item, e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input text-primary focus:ring-ring"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
                        item.source === "meeting"
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          : item.source === "calendar"
                            ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                            : item.source === "stocktake"
                              ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
                              : "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
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
              </div>
              {item.source === "stocktake" && !item.completed && (
                <button
                  type="button"
                  onClick={() =>
                    setActiveStocktake({
                      taskId: item.id.slice(2),
                      category: item.stocktakeCategory ?? null,
                      partIds: item.stocktakePartIds ?? null,
                    })
                  }
                  className="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60"
                >
                  開始盤點
                </button>
              )}
              {item.source === "make" && !item.completed && item.makeTask && (
                <button
                  type="button"
                  onClick={() => setActiveMakeTask(item.makeTask ?? null)}
                  className="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200 dark:hover:bg-orange-950/60"
                >
                  完成回報
                </button>
              )}
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
              <div className="ml-7 mt-2 space-y-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                {item.description && (
                  <p className="whitespace-pre-wrap">{item.description}</p>
                )}
                {item.imageUrl && (
                  <a
                    href={item.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-fit"
                    title="點擊開啟原圖"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
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

      <StocktakeDialog
        open={activeStocktake != null}
        onOpenChange={(o) => !o && setActiveStocktake(null)}
        categoryFilter={activeStocktake?.category ?? null}
        partIds={activeStocktake?.partIds ?? null}
        presetEmployeeId={employeeId}
        taskId={activeStocktake?.taskId}
        onSaved={() => {
          void load();
          onStatusChanged?.();
        }}
      />

      <CompleteMakeTaskDialog
        open={activeMakeTask != null}
        onOpenChange={(o) => !o && setActiveMakeTask(null)}
        task={activeMakeTask}
        employeeId={employeeId}
        onSaved={() => {
          void load();
          onStatusChanged?.();
        }}
      />
    </div>
  );
}
