"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { epSection } from "@/lib/employee-portal-section-styles";
import { cn } from "@/lib/utils";
import { buildCalendarMonthGrid, formatDateKey, getDaysInMonth } from "@/lib/calendar-month";
import {
  fetchCalendarApprovedLeavesOverlapping,
  fetchCalendarPublicHolidaysBetween,
  formatTotalDaysLabel,
  groupApprovedLeavesByDateKey,
  groupPublicHolidaysByDateKey,
} from "@/lib/company-calendar-extra";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { fetchMeetingAssignmentsForEmployee, type MeetingAssignmentForEmployeeRow } from "@/lib/meeting-minutes";
import {
  fetchCompanyEventAssignmentsForEmployee,
  type CompanyEventAssigneeRow,
} from "@/lib/company-events";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type DemoKind = "company" | "production" | "memo";
type DataKind = "holiday" | "workday" | "leave" | "leave_other" | "assignment" | "calendar_event" | "work_order" | DemoKind;

interface CalendarEventItem {
  id: string;
  title: string;
  kind: DataKind;
  sub?: string;
}

/** 未連線時示意用 */
function mockEventsForMonth(year: number, month: number): Record<string, CalendarEventItem[]> {
  const k = (day: number) => formatDateKey(year, month, day);
  return {
    [k(3)]: [
      { id: "m1", title: "部門週會（10:00）", kind: "company" },
      { id: "m2", title: "新人報到說明", kind: "memo" },
    ],
    [k(7)]: [{ id: "m3", title: "客戶驗廠準備日", kind: "production" }],
    [k(14)]: [
      { id: "m4", title: "工坊設備保養（週五）", kind: "production" },
      { id: "m5", title: "安全衛生宣導", kind: "company" },
    ],
    [k(18)]: [{ id: "m6", title: "教育訓練 · 品管流程", kind: "memo" }],
    [k(25)]: [{ id: "m7", title: "月底盤點預告", kind: "company" }],
    [k(28)]: [{ id: "m8", title: "特休申請截止提醒", kind: "memo" }],
  };
}

const KIND_DOT: Record<DataKind, string> = {
  holiday: "bg-orange-500",
  workday: "bg-slate-500",
  leave: "bg-violet-500",
  leave_other: "bg-teal-500",
  assignment: "bg-rose-500",
  calendar_event: "bg-sky-500",
  work_order: "bg-blue-500",
  company: "bg-emerald-500",
  production: "bg-accent-warn",
  memo: "bg-sky-500",
};

const KIND_LABEL: Record<DataKind, string> = {
  holiday: "國定假日",
  workday: "補班日",
  leave: "我的休假",
  leave_other: "同仁休假",
  assignment: "開會交辦",
  calendar_event: "行事曆交辦",
  work_order: "生產交辦",
  company: "公司",
  production: "生產",
  memo: "備忘",
};

async function loadRemoteEvents(
  employeeId: string,
  year: number,
  month: number,
): Promise<Record<string, CalendarEventItem[]>> {
  const dim = getDaysInMonth(year, month);
  const start = formatDateKey(year, month, 1);
  const end = formatDateKey(year, month, dim);

  const [holidays, leaves, assignmentsResult, calendarAssignResult, woResult] = await Promise.all([
    fetchCalendarPublicHolidaysBetween(start, end),
    fetchCalendarApprovedLeavesOverlapping(start, end),
    fetchMeetingAssignmentsForEmployee(employeeId),
    fetchCompanyEventAssignmentsForEmployee(employeeId),
    supabase
      .from("work_orders")
      .select(`
        id, stage, planned_end_date,
        order_items!inner(
          orders!inner(order_number, deleted_at, customers(name))
        )
      `)
      .eq("assignee_id", employeeId)
      .gte("planned_end_date", start)
      .lte("planned_end_date", end),
  ]);
  const selfId = String(employeeId ?? "").trim();

  const calendarAssignments: CompanyEventAssigneeRow[] =
    calendarAssignResult.ok ? calendarAssignResult.rows : [];

  const byHoliday = groupPublicHolidaysByDateKey(holidays);
  const byLeave = groupApprovedLeavesByDateKey(leaves, start, end);

  const keys = new Set<string>();
  for (const k of byHoliday.keys()) keys.add(k);
  for (const k of byLeave.keys()) keys.add(k);

  const assignments: MeetingAssignmentForEmployeeRow[] =
    assignmentsResult.ok ? assignmentsResult.rows : [];
  for (const a of assignments) {
    const d = a.meeting_date?.slice(0, 10);
    if (d && d >= start && d <= end) keys.add(d);
  }

  for (const ca of calendarAssignments) {
    const d = ca.event_date?.slice(0, 10);
    if (d && d >= start && d <= end) keys.add(d);
  }

  // 排除所屬訂單已被軟刪除者
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workOrders = ((woResult.data ?? []) as any[]).filter((wo) => {
    const oi = Array.isArray(wo.order_items) ? wo.order_items[0] : wo.order_items;
    const ord = Array.isArray(oi?.orders) ? oi.orders[0] : oi?.orders;
    return !ord?.deleted_at;
  });
  for (const wo of workOrders) {
    const d = wo.planned_end_date?.slice(0, 10);
    if (d) keys.add(d);
  }

  const merged: Record<string, CalendarEventItem[]> = {};

  for (const dateKey of keys) {
    const items: CalendarEventItem[] = [];
    for (const h of byHoliday.get(dateKey) ?? []) {
      const isWork = h.is_workday === true;
      items.push({
        id: `h-${dateKey}-${h.name}-${isWork ? "w" : "r"}`,
        title: isWork ? `${h.name}（補班日）` : h.name,
        kind: isWork ? "workday" : "holiday",
        sub: isWork ? "補班" : h.is_paid === false ? "放假（不支薪）" : "放假",
      });
    }
    for (const L of byLeave.get(dateKey) ?? []) {
      const isMine = Boolean(selfId && String(L.employee_id ?? "").trim() === selfId);
      items.push({
        id: `l-${L.id}-${dateKey}`,
        title: isMine ? L.leaveType : `${L.leaveType} · ${L.employeeName}`,
        kind: isMine ? "leave" : "leave_other",
        sub: isMine
          ? `已核准 · 單筆合計 ${formatTotalDaysLabel(L.totalDays)} 天`
          : `同仁 · 已核准 · 單筆合計 ${formatTotalDaysLabel(L.totalDays)} 天`,
      });
    }
    for (const a of assignments) {
      const d = a.meeting_date?.slice(0, 10);
      if (d !== dateKey) continue;
      items.push({
        id: `asg-${a.assignment_id}`,
        title: a.content,
        kind: "assignment",
        sub: a.completed ? "已完成" : "待辦",
      });
    }
    for (const ca of calendarAssignments) {
      const d = ca.event_date?.slice(0, 10);
      if (d !== dateKey) continue;
      items.push({
        id: `cea-${ca.id}`,
        title: ca.event_title,
        kind: "calendar_event",
        sub: ca.completed ? "已完成" : "待辦",
      });
    }
    for (const wo of workOrders) {
      const d = wo.planned_end_date?.slice(0, 10);
      if (d !== dateKey) continue;
      const oi = Array.isArray(wo.order_items) ? wo.order_items[0] : wo.order_items;
      const ord = oi?.orders;
      const orderObj = Array.isArray(ord) ? ord[0] : ord;
      const custRel = orderObj?.customers;
      const cust = Array.isArray(custRel) ? custRel[0] : custRel;
      const orderNum = orderObj?.order_number
        ? String(orderObj.order_number).replace(/^ORD-/i, "")
        : "";
      const custName = cust?.name ? String(cust.name) : "";
      items.push({
        id: `wo-${wo.id}`,
        title: `${custName} #${orderNum}`,
        kind: "work_order",
        sub: wo.stage ?? "待排程",
      });
    }
    merged[dateKey] = items;
  }

  return merged;
}

interface TodaySummaryItem {
  id: string;
  kind: DataKind;
  title: string;
  sub?: string;
}

function addDaysKey(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function diffDays(fromKey: string, toKey: string): number {
  const toDate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  return Math.round((toDate(toKey).getTime() - toDate(fromKey).getTime()) / 86_400_000);
}

/** 今日摘要：當日假日／休假／交辦＋生產交辦（工單交貨日在今日前後 7 天內） */
async function loadTodaySummary(employeeId: string): Promise<TodaySummaryItem[]> {
  const now = new Date();
  const todayKey = formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const woStart = addDaysKey(now, -7);
  const woEnd = addDaysKey(now, 7);

  const [holidays, leaves, assignmentsResult, calendarAssignResult, woResult] = await Promise.all([
    fetchCalendarPublicHolidaysBetween(todayKey, todayKey),
    fetchCalendarApprovedLeavesOverlapping(todayKey, todayKey),
    fetchMeetingAssignmentsForEmployee(employeeId),
    fetchCompanyEventAssignmentsForEmployee(employeeId),
    supabase
      .from("work_orders")
      .select(`
        id, stage, planned_end_date,
        order_items!inner(
          custom_name, quantity,
          orders!inner(deleted_at, customers(name, alias)),
          product_variants(product_code)
        )
      `)
      .eq("assignee_id", employeeId)
      .neq("stage", "已出貨")
      .gte("planned_end_date", woStart)
      .lte("planned_end_date", woEnd),
  ]);
  const selfId = String(employeeId ?? "").trim();

  const items: TodaySummaryItem[] = [];

  // 生產交辦：客戶，品項 ×數量，離交貨還有 N 天／已到期 N 天
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workOrders = ((woResult.data ?? []) as any[])
    .filter((wo) => {
      const oi = Array.isArray(wo.order_items) ? wo.order_items[0] : wo.order_items;
      const ord = Array.isArray(oi?.orders) ? oi.orders[0] : oi?.orders;
      return !ord?.deleted_at;
    })
    .sort((a, b) =>
      String(a.planned_end_date ?? "").localeCompare(String(b.planned_end_date ?? "")),
    );
  for (const wo of workOrders) {
    const dKey = String(wo.planned_end_date ?? "").slice(0, 10);
    if (!dKey) continue;
    const oi = Array.isArray(wo.order_items) ? wo.order_items[0] : wo.order_items;
    const ord = Array.isArray(oi?.orders) ? oi.orders[0] : oi?.orders;
    const custRel = ord?.customers;
    const cust = Array.isArray(custRel) ? custRel[0] : custRel;
    const custName =
      (typeof cust?.alias === "string" && cust.alias.trim()) ||
      (typeof cust?.name === "string" && cust.name.trim()) ||
      "—";
    const pv = Array.isArray(oi?.product_variants) ? oi.product_variants[0] : oi?.product_variants;
    const itemName =
      (typeof oi?.custom_name === "string" && oi.custom_name.trim()) ||
      (typeof pv?.product_code === "string" && pv.product_code.trim()) ||
      "品項";
    const qty = Number(oi?.quantity ?? 0) || 0;
    const diff = diffDays(todayKey, dKey);
    const dueLabel =
      diff > 0 ? `離交貨還有 ${diff} 天` : diff === 0 ? "今日交貨" : `已到期 ${-diff} 天`;
    items.push({
      id: `wo-${wo.id}`,
      kind: "work_order",
      title: `${custName}，${itemName} ×${qty}，${dueLabel}`,
      sub: `生產交辦 · ${wo.stage ?? "待排程"}`,
    });
  }

  for (const h of holidays) {
    const isWork = h.is_workday === true;
    items.push({
      id: `h-${todayKey}-${h.name}-${isWork ? "w" : "r"}`,
      kind: isWork ? "workday" : "holiday",
      title: isWork ? `${h.name}（補班日）` : h.name,
      sub: isWork ? "補班" : "放假",
    });
  }

  const byLeave = groupApprovedLeavesByDateKey(leaves, todayKey, todayKey);
  for (const L of byLeave.get(todayKey) ?? []) {
    const isMine = Boolean(selfId && String(L.employee_id ?? "").trim() === selfId);
    items.push({
      id: `l-${L.id}`,
      kind: isMine ? "leave" : "leave_other",
      title: isMine ? L.leaveType : `${L.leaveType} · ${L.employeeName}`,
      sub: isMine ? "我的休假 · 已核准" : "同仁休假 · 已核准",
    });
  }

  if (assignmentsResult.ok) {
    for (const a of assignmentsResult.rows) {
      if (a.meeting_date?.slice(0, 10) !== todayKey) continue;
      items.push({
        id: `asg-${a.assignment_id}`,
        kind: "assignment",
        title: a.content,
        sub: `開會交辦 · ${a.completed ? "已完成" : "待辦"}`,
      });
    }
  }

  if (calendarAssignResult.ok) {
    for (const ca of calendarAssignResult.rows) {
      if (ca.event_date?.slice(0, 10) !== todayKey) continue;
      items.push({
        id: `cea-${ca.id}`,
        kind: "calendar_event",
        title: ca.event_title,
        sub: `行事曆交辦 · ${ca.completed ? "已完成" : "待辦"}`,
      });
    }
  }

  return items;
}

export function EmployeePortalMiniCalendar({
  employeeId,
  showSubtitleHints = true,
}: {
  employeeId: string;
  /** false：不顯示行事曆資料來源說明（給非 admin 儀表板） */
  showSubtitleHints?: boolean;
}) {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    formatDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate()),
  );

  const useDb = isSupabaseConfigured && Boolean(String(employeeId ?? "").trim());

  const [remoteByDate, setRemoteByDate] = useState<Record<string, CalendarEventItem[]>>({});
  const [remoteLoading, setRemoteLoading] = useState(false);

  /** 展開前顯示的今日摘要（僅本人可見範圍） */
  const [todayItems, setTodayItems] = useState<TodaySummaryItem[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  useEffect(() => {
    if (!useDb) {
      setTodayItems([]);
      return;
    }
    let cancelled = false;
    setTodayLoading(true);
    (async () => {
      try {
        const items = await loadTodaySummary(String(employeeId).trim());
        if (!cancelled) setTodayItems(items);
      } catch (e) {
        console.warn("[EmployeePortalMiniCalendar] today summary", e);
        if (!cancelled) setTodayItems([]);
      } finally {
        if (!cancelled) setTodayLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useDb, employeeId]);

  const reloadRemote = useCallback(async () => {
    if (!useDb) {
      setRemoteByDate({});
      return;
    }
    const id = String(employeeId).trim();
    setRemoteLoading(true);
    try {
      const merged = await loadRemoteEvents(id, year, month);
      setRemoteByDate(merged);
    } catch (e) {
      console.warn("[EmployeePortalMiniCalendar]", e);
      setRemoteByDate({});
    } finally {
      setRemoteLoading(false);
    }
  }, [useDb, employeeId, year, month]);

  useEffect(() => {
    void reloadRemote();
  }, [reloadRemote]);

  const grid = useMemo(() => buildCalendarMonthGrid(year, month), [year, month]);

  const eventsByDate = useMemo(() => {
    if (useDb) return remoteByDate;
    return mockEventsForMonth(year, month);
  }, [useDb, remoteByDate, year, month]);

  const title = `${year} 年 ${month} 月`;

  function goPrev() {
    setMonth((m) => {
      if (m <= 1) {
        setYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }

  function goNext() {
    setMonth((m) => {
      if (m >= 12) {
        setYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }

  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedKey(formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }

  const selectedEvents = selectedKey ? eventsByDate[selectedKey] ?? [] : [];
  const todayKey = formatDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

  return (
    <section className={epSection.cardRing}>
      <details className="group peer">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-start gap-2 rounded-lg outline-none",
            "marker:content-none [&::-webkit-details-marker]:hidden",
            "hover:bg-muted/30",
          )}
        >
          <div className={epSection.iconBoxPrimary}>
            <CalendarDays className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={epSection.title}>本月行事曆</h3>
            <p className={cn("mt-0.5", epSection.subtitle)}>
              {showSubtitleHints ? (
                <>
                  {useDb
                    ? "國定假日、補班與已核准休假（含同仁）"
                    : "未連線 · 示意事件"}
                </>
              ) : null}
              <span
                className={cn(
                  "block text-xs text-primary/80",
                  showSubtitleHints ? "mt-0.5" : null,
                )}
              >
                點此列展開月曆
              </span>
            </p>
          </div>
          <ChevronDown
            className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-[1.25rem]">
              {useDb && remoteLoading ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  同步中…
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={goPrev}
                  aria-label="上個月"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[7.5rem] text-center text-sm font-medium tabular-nums">{title}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={goNext}
                  aria-label="下個月"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button type="button" variant="outline" className="h-8 px-3 text-xs" onClick={goToday}>
                今天
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] lg:items-start lg:gap-6">
        <div className="min-w-0 overflow-x-auto">
          <div className="inline-block min-w-[min(100%,22rem)] w-full sm:min-w-0">
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted-foreground sm:text-xs">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="py-1.5">
                  週{w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {grid.map((cell) => {
                const key = formatDateKey(cell.year, cell.month, cell.day);
                const dayEvents = eventsByDate[key] ?? [];
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                return (
                  <button
                    key={`${cell.year}-${cell.month}-${cell.day}`}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={cn(
                      "relative flex min-h-[2.35rem] flex-col items-center justify-start rounded-lg border py-1 text-xs transition-colors sm:min-h-[2.75rem] sm:py-1.5",
                      cell.isCurrentMonth
                        ? "border-transparent bg-muted/25 hover:bg-muted/45"
                        : "border-transparent bg-muted/5 text-muted-foreground/70 hover:bg-muted/20",
                      isToday && "ring-1 ring-primary/40",
                      isSelected && "border-primary/50 bg-primary/8 ring-1 ring-primary/30",
                    )}
                  >
                    <span
                      className={cn(
                        "tabular-nums",
                        cell.isCurrentMonth ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {cell.day}
                    </span>
                    {dayEvents.length > 0 ? (
                      <span className="mt-0.5 flex h-3.5 items-center justify-center gap-0.5">
                        {dayEvents.slice(0, 4).map((ev) => (
                          <span
                            key={ev.id}
                            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND_DOT[ev.kind])}
                            title={ev.title}
                          />
                        ))}
                        {dayEvents.length > 4 ? (
                          <span className="text-[8px] leading-none text-muted-foreground">+</span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            {useDb ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  國定假日
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  補班
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  我的休假
                </span>
                <span className="inline-flex items-center gap-1.5 text-teal-800 dark:text-teal-200">
                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                  同仁休假
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  開會交辦
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  行事曆交辦
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  生產交辦
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  公司
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent-warn" />
                  生產
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  備忘
                </span>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/15 p-3 sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            選取日期
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {selectedKey
              ? selectedKey.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1 / $2 / $3")
              : "—"}
          </p>
          {selectedEvents.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {useDb ? "這天沒有國定假日／補班／您的休假紀錄。" : "這天沒有示意事件。"}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {selectedEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/80 px-2.5 py-2 text-sm"
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[ev.kind])} />
                  <div className="min-w-0">
                    <p className="font-medium leading-snug text-foreground">{ev.title}</p>
                    <p
                      className={cn(
                        "text-[10px]",
                        ev.kind === "leave_other"
                          ? "text-teal-800/90 dark:text-teal-200/90"
                          : "text-muted-foreground",
                      )}
                    >
                      {ev.sub ?? KIND_LABEL[ev.kind]}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
          </div>
        </div>
      </details>

      {useDb ? (
        <div className="mt-3 border-t border-border/60 pt-3 peer-open:hidden">
          <p className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
            今日摘要
            <span className="tabular-nums">{todayKey}</span>
            {todayLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : null}
          </p>
          {todayItems.length === 0 ? (
            todayLoading ? null : (
              <p className="mt-2 text-sm text-muted-foreground">今日無安排事項</p>
            )
          ) : (
            <ul className="mt-2 space-y-1.5">
              {todayItems.map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[ev.kind])}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 leading-snug",
                      ev.title.includes("已到期") ? "text-accent-warn" : "text-foreground",
                    )}
                  >
                    {ev.title}
                  </span>
                  {ev.sub ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{ev.sub}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
