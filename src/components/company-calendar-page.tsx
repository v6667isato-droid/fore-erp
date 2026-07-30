"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { epSection } from "@/lib/employee-portal-section-styles";
import {
  buildCalendarMonthGrid,
  formatDateKey,
  type MonthDayCell,
} from "@/lib/calendar-month";
import {
  companyEventBadgePrefix,
  companyEventCategoryLabel,
  deleteCompanyEvent,
  fetchAssigneeNamesForEvents,
  fetchCompanyAnnouncementsFromEvents,
  fetchCompanyEventsBetween,
  type CompanyEventCategory,
  type CompanyEventRow,
} from "@/lib/company-events";
import {
  fetchCalendarApprovedLeavesOverlapping,
  fetchCalendarPublicHolidaysBetween,
  formatTotalDaysLabel,
  groupApprovedLeavesByDateKey,
  groupPublicHolidaysByDateKey,
  type CalendarApprovedLeaveRow,
} from "@/lib/company-calendar-extra";
import {
  fetchOrdersExpectedDeliveryBetween,
  formatCalendarOrderDueSummaryTitle,
  formatCalendarOrderDueTitle,
  mockOrderDuesBetween,
  type CalendarOrderDueItem,
} from "@/lib/company-calendar-orders";
import type { PublicHolidayEntry } from "@/lib/attendance-war-room";
import { isSupabaseConfigured } from "@/lib/supabase";
import { CompanyAnnouncementsBlock } from "@/components/company-announcements-block";
import { CompanyCalendarAddEventDialog } from "@/components/company-calendar-add-event-dialog";
import { CompanyCalendarEventDetailModal } from "@/components/company-calendar-event-detail-modal";
import { OrderOverviewDialog } from "@/components/order-overview-dialog";

interface CalendarEventItem {
  id: string;
  category: CompanyEventCategory;
  title: string;
}

type CalendarCellItem =
  | { kind: "company"; id: string; category: CompanyEventCategory; title: string }
  | {
      kind: "holiday";
      id: string;
      title: string;
      isWorkday: boolean;
      tooltip: string;
    }
  | { kind: "leave"; id: string; title: string; tooltip: string }
  | {
      kind: "orderDue";
      id: string;
      title: string;
      tooltip: string;
      detail: CalendarOrderDueItem;
    };

const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

const EVENT_STYLES: Record<
  CompanyEventCategory,
  { badge: string; hover: string }
> = {
  delivery: {
    badge: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/35 dark:text-yellow-200",
    hover: "hover:bg-yellow-100/90 dark:hover:bg-yellow-900/30",
  },
  visit: {
    badge: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    hover: "hover:bg-sky-100/90 dark:hover:bg-sky-900/35",
  },
  task: {
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-200",
    hover: "hover:bg-rose-100/90 dark:hover:bg-rose-900/30",
  },
  company: {
    badge: "bg-green-50 text-green-700 dark:bg-green-950/35 dark:text-green-200",
    hover: "hover:bg-green-100/90 dark:hover:bg-green-900/30",
  },
  other: {
    badge: "bg-stone-100 text-stone-700 dark:bg-stone-900/50 dark:text-stone-200",
    hover: "hover:bg-stone-200/80 dark:hover:bg-stone-800/50",
  },
};

const HOLIDAY_REST_STYLES = {
  badge:
    "bg-gradient-to-r from-orange-600 to-red-600 text-white shadow-sm dark:from-orange-700 dark:to-red-700",
  hover: "hover:opacity-95",
};

const HOLIDAY_WORK_STYLES = {
  badge:
    "border border-amber-600/45 bg-amber-100 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/45 dark:text-amber-50",
  hover: "hover:bg-amber-200/90 dark:hover:bg-amber-900/40",
};

const APPROVED_LEAVE_STYLES = {
  badge:
    "border border-violet-500/35 bg-violet-100 text-violet-950 dark:border-violet-600/40 dark:bg-violet-950/45 dark:text-violet-100",
  hover: "hover:bg-violet-200/85 dark:hover:bg-violet-900/35",
};

/** 訂單預計完成日（orders.expected_delivery_date） */
const ORDER_DUE_STYLES = {
  badge:
    "border border-teal-600/35 bg-teal-50 text-teal-900 dark:border-teal-600/40 dark:bg-teal-950/40 dark:text-teal-100",
  hover: "hover:bg-teal-100/90 dark:hover:bg-teal-900/35",
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

function addDaysIso(days: number): string {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + days);
  return formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function CompanyCalendarPage() {
  const router = useRouter();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<CompanyEventRow[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHolidayEntry[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<CalendarApprovedLeaveRow[]>([]);
  const [announcements, setAnnouncements] = useState<
    { id: string; title: string; body: string; published_at: string }[]
  >([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [addOpen, setAddOpen] = useState(false);
  /** 新增事件預設日期 YYYY-MM-DD（點當月格子或「新增事件」時寫入） */
  const [selectedDate, setSelectedDate] = useState("");
  const [viewingEvent, setViewingEvent] = useState<CompanyEventRow | null>(null);
  /** 與訂單管理「訂單總覽」相同之 OrderOverviewDialog */
  const [overviewOrderId, setOverviewOrderId] = useState<string | null>(null);
  /** Supabase：orders 預計交貨日；未連線時由 useMemo 改為假資料 */
  const [orderDuesFromDb, setOrderDuesFromDb] = useState<CalendarOrderDueItem[]>([]);
  const [version, setVersion] = useState(0);
  const [deletingListId, setDeletingListId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      setPublicHolidays([]);
      setApprovedLeaves([]);
      setOrderDuesFromDb([]);
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    (async () => {
      let evErr = false;
      let nextRows: CompanyEventRow[] = [];
      try {
        nextRows = await fetchCompanyEventsBetween(range.start, range.end);
      } catch (e) {
        console.error("[company-calendar] company_event", e);
        evErr = true;
      }
      let nextHol: PublicHolidayEntry[] = [];
      try {
        nextHol = await fetchCalendarPublicHolidaysBetween(range.start, range.end);
      } catch (e) {
        console.error("[company-calendar] public_holidays", e);
      }
      let nextLeave: CalendarApprovedLeaveRow[] = [];
      try {
        nextLeave = await fetchCalendarApprovedLeavesOverlapping(range.start, range.end);
      } catch (e) {
        console.error("[company-calendar] leave_requests", e);
      }
      let nextOrderDues: CalendarOrderDueItem[] = [];
      try {
        nextOrderDues = await fetchOrdersExpectedDeliveryBetween(range.start, range.end);
      } catch (e) {
        console.error("[company-calendar] orders.expected_delivery_date", e);
      }
      if (!cancelled) {
        setRows(nextRows);
        setPublicHolidays(nextHol);
        setApprovedLeaves(nextLeave);
        setOrderDuesFromDb(nextOrderDues);
        setLoadState(evErr ? "error" : "idle");
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

  const companyEventsByDay = useMemo(() => groupEventsByDay(rows), [rows]);
  const holidaysByDay = useMemo(
    () => groupPublicHolidaysByDateKey(publicHolidays),
    [publicHolidays],
  );
  const leavesByDay = useMemo(
    () => groupApprovedLeavesByDateKey(approvedLeaves, range.start, range.end),
    [approvedLeaves, range.start, range.end],
  );

  const orderDueRowsForGrid = useMemo((): CalendarOrderDueItem[] => {
    if (!isSupabaseConfigured) {
      return mockOrderDuesBetween(range.start, range.end);
    }
    return orderDuesFromDb;
  }, [isSupabaseConfigured, range.start, range.end, orderDuesFromDb]);

  const orderDuesByDay = useMemo(() => {
    const map = new Map<string, CalendarOrderDueItem[]>();
    for (const r of orderDueRowsForGrid) {
      const list = map.get(r.expected_date) ?? [];
      list.push(r);
      map.set(r.expected_date, list);
    }
    return map;
  }, [orderDueRowsForGrid]);

  const cellItemsByDay = useMemo(() => {
    const map = new Map<string, CalendarCellItem[]>();
    const add = (dateKey: string, item: CalendarCellItem) => {
      const list = map.get(dateKey) ?? [];
      list.push(item);
      map.set(dateKey, list);
    };
    for (const [dateKey, hols] of holidaysByDay) {
      for (const h of hols) {
        add(dateKey, {
          kind: "holiday",
          id: `ph-${dateKey}-${h.name}-${h.is_workday ? "w" : "r"}`,
          title: h.is_workday ? `📌 ${h.name}` : `🧨 ${h.name}`,
          isWorkday: h.is_workday,
          tooltip: h.is_workday ? `補班日：${h.name}` : `國定／特殊假日：${h.name}`,
        });
      }
    }
    for (const [dateKey, list] of leavesByDay) {
      for (const L of list) {
        const td = formatTotalDaysLabel(L.totalDays);
        add(dateKey, {
          kind: "leave",
          id: `lr-${L.id}-${dateKey}`,
          title: `${L.employeeName} · ${L.leaveType} · 共 ${td} 天`,
          tooltip: `已核准：${L.employeeName}／${L.leaveType}／單筆申請 total_days ${td}・${L.startDate}～${L.endDate}`,
        });
      }
    }
    for (const [dateKey, orderList] of orderDuesByDay) {
      for (const od of orderList) {
        add(dateKey, {
          kind: "orderDue",
          id: od.id,
          title: formatCalendarOrderDueTitle(od),
          tooltip: isSupabaseConfigured
            ? `${od.status ?? "—"} · 預計交貨 ${od.expected_date}（點擊開啟訂單總覽）`
            : "試用預覽（點擊查閱）",
          detail: od,
        });
      }
    }
    for (const [dateKey, evs] of companyEventsByDay) {
      for (const ev of evs) {
        add(dateKey, {
          kind: "company",
          id: ev.id,
          category: ev.category,
          title: ev.title,
        });
      }
    }
    return map;
  }, [holidaysByDay, leavesByDay, orderDuesByDay, companyEventsByDay, isSupabaseConfigured]);

  const eventById = useMemo(() => {
    const m = new Map<string, CompanyEventRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  /** 今日摘要：當日假日、請假、公司事件（交期另以 ±7 天視窗顯示）；瀏覽其他月份時保留最後結果 */
  const [todayCells, setTodayCells] = useState<CalendarCellItem[]>([]);
  useEffect(() => {
    const todayKey = todayIsoDate();
    if (todayKey >= range.start && todayKey <= range.end) {
      setTodayCells(
        (cellItemsByDay.get(todayKey) ?? []).filter((c) => c.kind !== "orderDue"),
      );
    }
  }, [cellItemsByDay, range.start, range.end]);

  /** 今日摘要「交期」：今日前後 7 天內的生產訂單（不受瀏覽月份影響） */
  const [todayWindowOrderDues, setTodayWindowOrderDues] = useState<CalendarOrderDueItem[]>([]);
  useEffect(() => {
    const start = addDaysIso(-7);
    const end = addDaysIso(7);
    if (!isSupabaseConfigured) {
      setTodayWindowOrderDues(mockOrderDuesBetween(start, end));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchOrdersExpectedDeliveryBetween(start, end);
        if (!cancelled) setTodayWindowOrderDues(list);
      } catch (e) {
        console.error("[company-calendar] today order dues", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  /** 今日摘要清單：±7 天交期在前（依交貨日排序），其後接當日其他分類 */
  const todaySummaryItems = useMemo((): CalendarCellItem[] => {
    const todayKey = todayIsoDate();
    const dues: CalendarCellItem[] = [...todayWindowOrderDues]
      .sort((a, b) => a.expected_date.localeCompare(b.expected_date))
      .map((od) => ({
        kind: "orderDue",
        id: od.id,
        title: formatCalendarOrderDueSummaryTitle(od, todayKey),
        tooltip: isSupabaseConfigured
          ? `${od.status ?? "—"} · 預計交貨 ${od.expected_date}（點擊開啟訂單總覽）`
          : "試用預覽（點擊查閱）",
        detail: od,
      }));
    return [...dues, ...todayCells];
  }, [todayWindowOrderDues, todayCells]);

  /** 今日公司事件的負責人員姓名，key = company_event_id */
  const [todayAssignees, setTodayAssignees] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const ids = todayCells.filter((c) => c.kind === "company").map((c) => c.id);
    if (ids.length === 0) {
      setTodayAssignees(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchAssigneeNamesForEvents(ids);
        if (!cancelled) setTodayAssignees(m);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todayCells]);

  function openTodayItem(item: CalendarCellItem) {
    if (item.kind === "company") {
      const full = eventById.get(item.id);
      if (full) {
        setOverviewOrderId(null);
        setViewingEvent(full);
      }
      return;
    }
    if (item.kind === "orderDue") {
      if (item.detail.id.startsWith("demo-")) {
        toast.info("試用假資料無訂單總覽，請連線資料庫後再試");
        return;
      }
      setViewingEvent(null);
      setOverviewOrderId(item.detail.id);
    }
  }

  const sortedCurrentMonthEvents = useMemo(() => {
    const monthStart = formatDateKey(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth, 0).getDate();
    const monthEnd = formatDateKey(viewYear, viewMonth, lastDay);
    return rows
      .filter((r) => r.event_date >= monthStart && r.event_date <= monthEnd)
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title));
  }, [rows, viewYear, viewMonth]);

  async function handleListDelete(id: string) {
    if (!isSupabaseConfigured) {
      toast.error("Supabase 未設定，無法刪除");
      return;
    }
    setDeletingListId(id);
    try {
      await deleteCompanyEvent(id);
      toast.success("已刪除行程");
      setConfirmDeleteId(null);
      bump();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "刪除失敗";
      toast.error(msg);
    } finally {
      setDeletingListId(null);
    }
  }

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
      <section className={epSection.card}>
        <div className={cn(epSection.headerRow, "mb-3")}>
          <div className={epSection.iconBoxPrimary}>
            <CalendarCheck className="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className={epSection.title}>今日摘要</h3>
            <span className="text-xs tabular-nums text-muted-foreground">{todayIsoDate()}</span>
          </div>
        </div>
        {todaySummaryItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">今日無安排事項</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {todaySummaryItems.map((item) => {
              const assignees =
                item.kind === "company" ? (todayAssignees.get(item.id) ?? []) : [];
              const orderMeta =
                item.kind === "orderDue"
                  ? [
                      item.detail.assignee_names?.length
                        ? `負責：${item.detail.assignee_names.join("、")}`
                        : null,
                      item.detail.stages?.length
                        ? `工序：${item.detail.stages.join("、")}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "";
              const clickable = item.kind === "company" || item.kind === "orderDue";
              const inner = (
                <>
                  <span className="text-[15px] font-medium text-foreground">{item.title}</span>
                  {assignees.length > 0 ? (
                    <span className="shrink-0 text-sm text-muted-foreground">
                      負責：{assignees.join("、")}
                    </span>
                  ) : orderMeta ? (
                    <span className="shrink-0 text-sm text-muted-foreground">{orderMeta}</span>
                  ) : null}
                </>
              );
              return (
                <li key={`${item.kind}-${item.id}`}>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => openTodayItem(item)}
                      className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 py-2"
                      title={"tooltip" in item ? item.tooltip : undefined}
                    >
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CompanyAnnouncementsBlock items={announcements} />

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
              公司綜合行事曆 · company_event、public_holidays、已核准假單（leave_requests）
              {isSupabaseConfigured
                ? "；訂單交期僅顯示狀態為排程中～已完工，條目為「聯絡人」訂單（orders）"
                : "；訂單預計完成日為本機試用假資料"}
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
            const dayItems = cellItemsByDay.get(key) ?? [];
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
                  {dayItems.map((item) => {
                    if (item.kind === "holiday") {
                      const styles = item.isWorkday ? HOLIDAY_WORK_STYLES : HOLIDAY_REST_STYLES;
                      return (
                        <div
                          key={item.id}
                          title={item.tooltip}
                          className={cn(
                            "w-full text-left text-[11px] font-semibold leading-snug",
                            "rounded px-1 py-0.5 truncate",
                            styles.badge,
                          )}
                        >
                          {item.title}
                        </div>
                      );
                    }
                    if (item.kind === "leave") {
                      return (
                        <div
                          key={item.id}
                          title={item.tooltip}
                          className={cn(
                            "w-full text-left text-[11px] font-medium leading-snug",
                            "rounded px-1 py-0.5 truncate",
                            APPROVED_LEAVE_STYLES.badge,
                          )}
                        >
                          {item.title}
                        </div>
                      );
                    }
                    if (item.kind === "orderDue") {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={item.tooltip}
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingEvent(null);
                            if (item.detail.id.startsWith("demo-")) {
                              toast.info("試用假資料無訂單總覽，請連線資料庫後再試");
                              return;
                            }
                            setOverviewOrderId(item.detail.id);
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setViewingEvent(null);
                              if (item.detail.id.startsWith("demo-")) {
                                toast.info("試用假資料無訂單總覽，請連線資料庫後再試");
                                return;
                              }
                              setOverviewOrderId(item.detail.id);
                            }
                          }}
                          className={cn(
                            "w-full cursor-pointer text-left text-[11px] font-medium leading-snug",
                            "rounded px-1 py-0.5 truncate",
                            ORDER_DUE_STYLES.badge,
                            ORDER_DUE_STYLES.hover,
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                          )}
                        >
                          {item.title}
                        </button>
                      );
                    }
                    const styles = EVENT_STYLES[item.category];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={`${item.title}（點擊查閱）`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const full = eventById.get(item.id);
                          if (full) {
                            setOverviewOrderId(null);
                            setViewingEvent(full);
                          }
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const full = eventById.get(item.id);
                            if (full) {
                              setOverviewOrderId(null);
                              setViewingEvent(full);
                            }
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer text-left text-xs leading-snug transition-colors",
                          "rounded px-1 py-0.5 truncate",
                          styles.badge,
                          styles.hover,
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        )}
                      >
                        {item.title}
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500" />
          國定／放假
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          補班
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-violet-400" />
          已核准休假
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-500" />
          {isSupabaseConfigured ? "訂單預計完成日（orders）" : "訂單預計完成日（試用假資料）"}
        </span>
      </div>

      {/* ─── 事件清單 ─── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
          <h3 className="font-serif text-base font-semibold tracking-tight text-foreground sm:text-lg">
            {viewYear}年{viewMonth}月 事件清單
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            共 {sortedCurrentMonthEvents.length} 筆
          </span>
        </div>

        {sortedCurrentMonthEvents.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            本月尚無事件
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {sortedCurrentMonthEvents.map((ev) => {
              const catStyle = EVENT_STYLES[ev.category];
              const isConfirming = confirmDeleteId === ev.id;
              const isDeleting = deletingListId === ev.id;

              return (
                <div
                  key={ev.id}
                  className="group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-secondary/30 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                    <span className="mt-0.5 shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground sm:mt-0 sm:text-sm">
                      {ev.event_date.slice(5).replace("-", "/")}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
                        catStyle.badge,
                      )}
                    >
                      {companyEventCategoryLabel[ev.category]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{ev.title}</p>
                      {ev.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {ev.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                    {isConfirming ? (
                      <>
                        <span className="mr-1 text-xs text-red-600 dark:text-red-400">確定刪除？</span>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          disabled={isDeleting}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          disabled={isDeleting}
                          onClick={() => void handleListDelete(ev.id)}
                        >
                          {isDeleting ? "刪除中…" : "確定"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setOverviewOrderId(null);
                            setViewingEvent(ev);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">編輯</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          onClick={() => setConfirmDeleteId(ev.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">刪除</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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

      <OrderOverviewDialog
        open={overviewOrderId != null}
        onOpenChange={(open) => {
          if (!open) setOverviewOrderId(null);
        }}
        orderId={overviewOrderId}
        onEditOrder={(id) => {
          setOverviewOrderId(null);
          router.replace(
            `/?page=orders&openOrder=${encodeURIComponent(id)}`,
            { scroll: false },
          );
        }}
      />
    </div>
  );
}
