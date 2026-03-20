"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildCalendarMonthGrid,
  formatDateKey,
  type MonthDayCell,
} from "@/lib/calendar-month";
import {
  companyEventBadgePrefix,
  fetchCompanyAnnouncementsFromEvents,
  fetchCompanyEventsBetween,
  type CompanyEventCategory,
  type CompanyEventRow,
} from "@/lib/company-events";
import { isSupabaseConfigured } from "@/lib/supabase";
import { CompanyAnnouncementsBlock } from "@/components/company-announcements-block";
import { CompanyCalendarAddEventDialog } from "@/components/company-calendar-add-event-dialog";
import { CompanyCalendarEventDetailModal } from "@/components/company-calendar-event-detail-modal";

interface CalendarEventItem {
  id: string;
  category: CompanyEventCategory;
  title: string;
}

const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

const EVENT_STYLES: Record<
  CompanyEventCategory,
  { badge: string; hover: string }
> = {
  company: {
    badge: "bg-green-50 text-green-700 dark:bg-green-950/35 dark:text-green-200",
    hover: "hover:bg-green-100/90 dark:hover:bg-green-900/30",
  },
  production: {
    badge: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/35 dark:text-yellow-200",
    hover: "hover:bg-yellow-100/90 dark:hover:bg-yellow-900/30",
  },
  event: {
    badge: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    hover: "hover:bg-sky-100/90 dark:hover:bg-sky-900/35",
  },
  memo: {
    badge: "bg-stone-100 text-stone-700 dark:bg-stone-900/50 dark:text-stone-200",
    hover: "hover:bg-stone-200/80 dark:hover:bg-stone-800/50",
  },
};

function groupEventsByDay(rows: CompanyEventRow[]): Map<string, CalendarEventItem[]> {
  const map = new Map<string, CalendarEventItem[]>();
  for (const r of rows) {
    const key = r.event_date;
    const item: CalendarEventItem = {
      id: r.id,
      category: r.category,
      title: `${companyEventBadgePrefix(r.category)} ${r.title}`,
    };
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function isTodayCell(cell: MonthDayCell): boolean {
  const t = new Date();
  return (
    cell.year === t.getFullYear() &&
    cell.month === t.getMonth() + 1 &&
    cell.day === t.getDate()
  );
}

function todayIsoDate(): string {
  const t = new Date();
  return formatDateKey(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export function CompanyCalendarPage() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<CompanyEventRow[]>([]);
  const [announcements, setAnnouncements] = useState<
    { id: string; title: string; body: string; published_at: string }[]
  >([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [addOpen, setAddOpen] = useState(false);
  /** 新增事件預設日期 YYYY-MM-DD（點當月格子或「新增事件」時寫入） */
  const [selectedDate, setSelectedDate] = useState("");
  const [viewingEvent, setViewingEvent] = useState<CompanyEventRow | null>(null);
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const grid = useMemo(
    () => buildCalendarMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const range = useMemo(() => {
    const g = grid;
    const first = g[0];
    const last = g[g.length - 1];
    return {
      start: formatDateKey(first.year, first.month, first.day),
      end: formatDateKey(last.year, last.month, last.day),
    };
  }, [grid]);

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setRows([]);
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    (async () => {
      try {
        const data = await fetchCompanyEventsBetween(range.start, range.end);
        if (!cancelled) {
          setRows(data);
          setLoadState("idle");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setRows([]);
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, version]);

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setAnnouncements([]);
      return;
    }
    (async () => {
      try {
        const list = await fetchCompanyAnnouncementsFromEvents();
        if (!cancelled) setAnnouncements(list);
      } catch (e) {
        console.error(e);
        if (!cancelled) setAnnouncements([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const eventsByDay = useMemo(() => groupEventsByDay(rows), [rows]);

  const eventById = useMemo(() => {
    const m = new Map<string, CompanyEventRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const titleLabel = `${viewYear}年 ${viewMonth}月`;

  function goPrevMonth() {
    const next = new Date(viewYear, viewMonth - 2, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth() + 1);
  }

  function goNextMonth() {
    const next = new Date(viewYear, viewMonth, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth() + 1);
  }

  return (
    <div className="space-y-6">
      <CompanyAnnouncementsBlock
        items={announcements}
        subtitle="company_event · 類別為「公司」"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center rounded-xl border border-border bg-card/80 p-1 shadow-sm backdrop-blur-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-foreground hover:bg-secondary"
              onClick={goPrevMonth}
              aria-label="上個月"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-[8.5rem] text-center font-serif text-lg font-semibold tracking-tight text-foreground sm:min-w-[10rem] sm:text-xl">
              {titleLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-foreground hover:bg-secondary"
              onClick={goNextMonth}
              aria-label="下個月"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground sm:text-sm">
              公司綜合行事曆 · 資料來源 company_event
            </p>
            {loadState === "loading" && (
              <span className="text-[11px] text-muted-foreground">同步行程中…</span>
            )}
            {loadState === "error" && (
              <span className="text-[11px] text-amber-800 dark:text-amber-200">
                無法載入事件（請確認已執行 migration 且具備讀取權限）
              </span>
            )}
          </div>
        </div>
        <Button
          type="button"
          className="w-full shrink-0 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
          onClick={() => {
            setSelectedDate(todayIsoDate());
            setAddOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          新增事件
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-secondary/30 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-border/80 border-border/80 bg-card/50 dark:bg-card/30">
          {grid.map((cell) => {
            const key = formatDateKey(cell.year, cell.month, cell.day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const today = isTodayCell(cell);

            return (
              <div
                key={`${key}-${cell.isCurrentMonth}`}
                role={cell.isCurrentMonth ? "button" : undefined}
                tabIndex={cell.isCurrentMonth ? 0 : undefined}
                onClick={
                  cell.isCurrentMonth
                    ? () => {
                        setSelectedDate(key);
                        setAddOpen(true);
                      }
                    : undefined
                }
                onKeyDown={
                  cell.isCurrentMonth
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedDate(key);
                          setAddOpen(true);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex min-h-[120px] flex-col gap-1 p-1.5 sm:p-2 transition-colors",
                  !cell.isCurrentMonth && "bg-muted/25 text-muted-foreground/70",
                  cell.isCurrentMonth &&
                    "cursor-pointer bg-card/60 hover:bg-[#F5F2E9] dark:bg-card/20 dark:hover:bg-muted/35"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg text-xs font-semibold tabular-nums",
                      today &&
                        cell.isCurrentMonth &&
                        "bg-primary text-primary-foreground shadow-sm",
                      !today && cell.isCurrentMonth && "text-foreground/90",
                      !cell.isCurrentMonth && "text-muted-foreground"
                    )}
                  >
                    {cell.day}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {dayEvents.map((ev) => {
                    const styles = EVENT_STYLES[ev.category];
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        title={`${ev.title}（點擊查閱）`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const full = eventById.get(ev.id);
                          if (full) setViewingEvent(full);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const full = eventById.get(ev.id);
                            if (full) setViewingEvent(full);
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer text-left text-xs leading-snug transition-colors",
                          "rounded px-1 py-0.5 truncate",
                          styles.badge,
                          styles.hover,
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        )}
                      >
                        {ev.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border/80 bg-secondary/20 px-4 py-3 text-[11px] text-muted-foreground sm:text-xs">
        <span className="font-medium text-foreground/80">圖例</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          公司
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          生產
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          事件
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-stone-400" />
          備忘
        </span>
      </div>

      <CompanyCalendarAddEventDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={selectedDate || todayIsoDate()}
        onCreated={bump}
      />

      <CompanyCalendarEventDetailModal
        event={viewingEvent}
        onClose={() => setViewingEvent(null)}
        onSaved={bump}
      />
    </div>
  );
}
