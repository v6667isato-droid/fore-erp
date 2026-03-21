"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-border dark:bg-card">
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
        ) : rows.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            📭 該月份尚無出勤紀錄，請先由匯入中心寫入。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
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
                  const tags = r.status_tags?.filter(Boolean) ?? [];
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
                        {tags.length ? (
                          <span className="leading-relaxed">{tags.join("、")}</span>
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
