"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Loader2 } from "lucide-react";
import { missingPunchRemark } from "@/lib/payslip-attendance-remarks";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { weekdayLabelFromIso } from "@/lib/attendance-war-room";
import { isSupabaseConfigured, supabase, SUPABASE_CONFIG_HELP } from "@/lib/supabase";

function currentYmLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeIso(ym: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  const last = new Date(y, mo, 0).getDate();
  return {
    start: `${m[1]}-${m[2]}-01`,
    end: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`,
  };
}

function formatDisplayDate(isoDate: string): string {
  const s = String(isoDate).slice(0, 10);
  const p = s.split("-");
  if (p.length !== 3) return s;
  return `${Number(p[0])}/${Number(p[1])}/${Number(p[2])}`;
}

function formatClockDb(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const t = String(value).trim();
  if (t.length >= 5 && t[2] === ":") return t.slice(0, 5);
  return t;
}

function hasClock(value: string | null | undefined): boolean {
  return value != null && String(value).trim() !== "";
}

/** 與列表／月曆共用：有標籤則用標籤；無標籤時依打卡欄位補缺上／缺下／無紀錄 */
function statusLineForHistoryRow(r: AttendanceHistoryRow): string {
  const tags = r.status_tags?.filter(Boolean) ?? [];
  const tagText = tags.join(" ");
  if (tags.length) return tags.join("、");
  return (
    missingPunchRemark(
      hasClock(r.clock_in),
      hasClock(r.clock_out),
      tagText.includes("缺卡"),
    ) ?? ""
  );
}

function buildCalendarCellDates(ym: string): { dateIso: string | null }[] {
  const r = monthRangeIso(ym);
  if (!r) return [];
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const lastDay = new Date(y, mo, 0).getDate();
  const startPad = first.getDay();
  const cells: { dateIso: string | null }[] = [];
  for (let i = 0; i < startPad; i++) {
    cells.push({ dateIso: null });
  }
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ dateIso: iso });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ dateIso: null });
  }
  return cells;
}

const WEEKDAY_HEADERS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function isWeekendIso(iso: string): boolean {
  const [y, mo, d] = iso.split("-").map(Number);
  const w = new Date(y, mo - 1, d).getDay();
  return w === 0 || w === 6;
}

type EmpOption = { id: string; name: string };

type AttendanceHistoryRow = {
  id: string;
  employee_id: string;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  is_abnormal: boolean;
  status_tags: string[] | null;
  employees: { name: string | null } | null;
};

function normalizeHistoryRow(raw: Record<string, unknown>): AttendanceHistoryRow {
  let employees: { name: string | null } | null = null;
  const emp = raw.employees;
  if (Array.isArray(emp) && emp[0] && typeof emp[0] === "object") {
    employees = { name: (emp[0] as { name?: string | null }).name ?? null };
  } else if (emp && typeof emp === "object" && !Array.isArray(emp)) {
    employees = { name: (emp as { name?: string | null }).name ?? null };
  }
  return {
    id: String(raw.id ?? ""),
    employee_id: String(raw.employee_id ?? ""),
    attendance_date: String(raw.attendance_date ?? ""),
    clock_in: raw.clock_in != null && raw.clock_in !== "" ? String(raw.clock_in) : null,
    clock_out: raw.clock_out != null && raw.clock_out !== "" ? String(raw.clock_out) : null,
    total_hours:
      raw.total_hours != null && raw.total_hours !== ""
        ? Number(raw.total_hours)
        : null,
    is_abnormal: Boolean(raw.is_abnormal),
    status_tags: Array.isArray(raw.status_tags) ? (raw.status_tags as string[]) : null,
    employees,
  };
}

const selectClass =
  "h-10 w-full max-w-xs rounded-lg border border-stone-200/90 bg-white px-3 text-sm text-stone-800 shadow-sm focus:border-amber-600/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-border dark:bg-background dark:text-foreground";

export function AttendanceHistoryPanel() {
  const [monthYm, setMonthYm] = useState(currentYmLocal);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [rows, setRows] = useState<AttendanceHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      setEmpLoading(true);
      try {
        const { data, error: empErr } = await supabase
          .from("employees")
          .select("id, name")
          .is("deleted_at", null)
          .order("name", { ascending: true });
        if (cancelled) return;
        if (empErr) throw empErr;
        const list: EmpOption[] = (data ?? []).map((r) => ({
          id: String((r as { id: string }).id),
          name: String((r as { name?: string }).name ?? "—"),
        }));
        setEmployees(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setEmpLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const range = monthRangeIso(monthYm);
    if (!range) {
      setError("月份格式不正確。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from("daily_attendance")
        .select(
          "id, employee_id, attendance_date, clock_in, clock_out, total_hours, is_abnormal, status_tags, employees ( name )",
        )
        .gte("attendance_date", range.start)
        .lte("attendance_date", range.end)
        .order("attendance_date", { ascending: true });
      if (employeeId) q = q.eq("employee_id", employeeId);
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows((data ?? []).map((r) => normalizeHistoryRow(r as Record<string, unknown>)));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [monthYm, employeeId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const monthLabel = useMemo(() => {
    const r = monthRangeIso(monthYm);
    if (!r) return monthYm;
    const [y, mo] = monthYm.split("-").map(Number);
    return `${y} 年 ${mo} 月`;
  }, [monthYm]);

  const rowsByDate = useMemo(() => {
    const m = new Map<string, AttendanceHistoryRow[]>();
    for (const r of rows) {
      const iso = String(r.attendance_date).slice(0, 10);
      const arr = m.get(iso) ?? [];
      arr.push(r);
      m.set(iso, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (a.employees?.name ?? "").localeCompare(b.employees?.name ?? "", "zh-Hant"),
      );
    }
    return m;
  }, [rows]);

  const calendarCells = useMemo(() => buildCalendarCellDates(monthYm), [monthYm]);

  if (!isSupabaseConfigured) {
    return (
      <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-stone-200/80 bg-gradient-to-br from-stone-50/90 to-amber-50/30 p-4 shadow-sm dark:border-border dark:from-card dark:to-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="hist-month" className="text-xs font-medium text-stone-700 dark:text-foreground">
              月份
            </label>
            <input
              id="hist-month"
              type="month"
              value={monthYm}
              onChange={(e) => setMonthYm(e.target.value)}
              className={cn(selectClass, "font-mono tabular-nums")}
            />
          </div>
          <div className="flex min-w-[12rem] flex-col gap-1 sm:min-w-[14rem]">
            <label htmlFor="hist-emp" className="text-xs font-medium text-stone-700 dark:text-foreground">
              員工
            </label>
            <select
              id="hist-emp"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={empLoading}
              className={selectClass}
            >
              <option value="">全部員工</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          {empLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              載入員工…
            </span>
          )}
          <div
            className="inline-flex rounded-lg border border-stone-200/80 bg-white p-0.5 shadow-sm dark:border-border dark:bg-background"
            role="group"
            aria-label="查詢結果顯示方式"
          >
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                viewMode === "list"
                  ? "bg-amber-600/15 text-stone-900 shadow-sm dark:bg-primary/15 dark:text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              列表
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                viewMode === "calendar"
                  ? "bg-amber-600/15 text-stone-900 shadow-sm dark:bg-primary/15 dark:text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              月曆
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-border dark:bg-card">
        <div className="border-b border-stone-100 bg-stone-50/80 px-4 py-3 dark:border-border dark:bg-muted/30">
          <p className="text-sm font-medium text-stone-800 dark:text-foreground">
            查詢結果
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">· {monthLabel}</span>
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            載入紀錄中…
          </div>
        ) : viewMode === "calendar" ? (
          <div className="p-3 sm:p-4">
            {rows.length === 0 && (
              <p className="mb-3 text-center text-xs text-muted-foreground">
                該月份尚無出勤紀錄，請先由匯入中心寫入。
              </p>
            )}
            <div className="mb-2 grid grid-cols-7 gap-px text-center text-[11px] font-medium text-muted-foreground">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w} className="py-1.5">
                  週{w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px rounded-lg border border-stone-200/90 bg-stone-200/90 dark:border-border dark:bg-border">
              {calendarCells.map((cell, idx) => {
                if (!cell.dateIso) {
                  return (
                    <div
                      key={`pad-${idx}`}
                      className="min-h-[6rem] bg-stone-50/40 sm:min-h-[6.5rem] dark:bg-muted/30"
                      aria-hidden
                    />
                  );
                }
                const dayRows = rowsByDate.get(cell.dateIso) ?? [];
                const dayNum = Number(cell.dateIso.slice(8, 10));
                const abnormal = dayRows.some((r) => r.is_abnormal);
                const weekend = isWeekendIso(cell.dateIso);
                return (
                  <div
                    key={cell.dateIso}
                    className={cn(
                      "flex min-h-[6rem] flex-col bg-white p-1.5 sm:min-h-[6.5rem] dark:bg-card",
                      weekend && !abnormal && "bg-stone-50/50 dark:bg-muted/15",
                      abnormal && "bg-red-50/90 dark:bg-red-950/25",
                    )}
                  >
                    <div className="flex shrink-0 justify-end">
                      <span className="text-[11px] font-semibold tabular-nums text-stone-600 dark:text-muted-foreground">
                        {dayNum}
                      </span>
                    </div>
                    <div className="mt-0.5 max-h-36 min-h-0 space-y-1 overflow-y-auto sm:max-h-40">
                      {dayRows.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/70">—</span>
                      ) : (
                        dayRows.map((r, ri) => {
                          const statusText = statusLineForHistoryRow(r);
                          const rowKey =
                            r.id || `${r.employee_id}:${cell.dateIso}:${ri}`;
                          return (
                            <div
                              key={rowKey}
                              className="rounded-md border border-stone-100/90 bg-white/60 px-1 py-0.5 text-[10px] leading-snug dark:border-border dark:bg-background/40"
                            >
                              {!employeeId && (
                                <div className="truncate font-medium text-stone-800 dark:text-foreground">
                                  {r.employees?.name?.trim() || "—"}
                                </div>
                              )}
                              <div className="tabular-nums text-muted-foreground">
                                {formatClockDb(r.clock_in)} – {formatClockDb(r.clock_out)}
                              </div>
                              {statusText ? (
                                <div className="truncate text-amber-900/90 dark:text-amber-200/90">
                                  {statusText}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            📭 該月份尚無出勤紀錄，請先由匯入中心寫入。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow className="border-stone-200/90 bg-stone-100/60 hover:bg-stone-100/60 dark:border-border dark:bg-muted/40 dark:hover:bg-muted/40">
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    日期
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    星期
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    員工姓名
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    上班
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    下班
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold text-stone-700 dark:text-foreground">
                    總工時
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-stone-700 dark:text-foreground">
                    狀態／標籤
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, rowIndex) => {
                  const iso = String(r.attendance_date).slice(0, 10);
                  const name = r.employees?.name?.trim() || "—";
                  const statusText = statusLineForHistoryRow(r);
                  const rowKey =
                    r.id ||
                    [r.employee_id || "unknown", iso, String(rowIndex)].join(":");
                  return (
                    <TableRow
                      key={rowKey}
                      className={cn(
                        "border-stone-100 dark:border-border",
                        r.is_abnormal &&
                          "bg-red-50/85 dark:bg-red-950/20 dark:hover:bg-red-950/25",
                        !r.is_abnormal && "hover:bg-stone-50/80 dark:hover:bg-muted/25",
                      )}
                    >
                      <TableCell className="whitespace-nowrap tabular-nums text-sm text-stone-800 dark:text-foreground">
                        {formatDisplayDate(iso)}
                      </TableCell>
                      <TableCell className="text-sm text-stone-600 dark:text-muted-foreground">
                        {weekdayLabelFromIso(iso)}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-stone-800 dark:text-foreground">
                        {name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-sm text-stone-700 dark:text-foreground">
                        {formatClockDb(r.clock_in)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-sm text-stone-700 dark:text-foreground">
                        {formatClockDb(r.clock_out)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-sm text-stone-700 dark:text-foreground">
                        {r.total_hours != null ? `${r.total_hours} 小時` : "—"}
                      </TableCell>
                      <TableCell className="min-w-[10rem] text-sm text-stone-700 dark:text-foreground">
                        {statusText ? (
                          <span className="leading-relaxed">{statusText}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
