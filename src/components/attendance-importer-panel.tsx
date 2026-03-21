"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { toast } from "sonner";
import { Upload, Loader2, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { parseAttendanceCsvText, type AttendanceDayRow } from "@/lib/attendance-csv";
import {
  appendAbsentEmployeeWarnings,
  appendLeaveOnlyRowsWithoutPunch,
  buildCalendarAnomalyEntriesByDay,
  buildCalendarApprovedLeavesByDay,
  buildWarRoomRows,
  listPublicHolidaysInYm,
  normalizeYmMonthPrefix,
  isApprovedLeaveStatus,
  isOvertimeCompApprovable,
  normalizePublicHolidayRows,
  overtimeApprovalButtonLabel,
  pickDominantMonth,
  dateStrToIso,
  type LeaveSpan,
  type PublicHolidayEntry,
  type WarRoomRow,
} from "@/lib/attendance-war-room";
import { WeekendOvertimeApprovalDialog } from "@/components/weekend-overtime-approval-dialog";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { bulkUpsertDailyAttendanceFromWarRows } from "@/lib/daily-attendance";

function monthEndIso(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

function overtimeLookupKey(employeeId: string, dateIso: string): string {
  return `${employeeId}\t${dateIso.slice(0, 10)}`;
}

/** 與員工表 boolean 在職一致；NULL 視為在職（舊資料相容） */
function isEmployedInDb(v: unknown): boolean {
  if (v === false) return false;
  if (v === true) return true;
  if (v == null) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "離職" || s === "false" || s === "0") return false;
    return s === "true" || s === "在職" || s === "1";
  }
  return Boolean(v);
}

function holidayKindLabel(h: PublicHolidayEntry): string {
  if (h.is_workday) return "補班日";
  if (!h.is_paid) return "不支薪放假";
  return "支薪放假";
}

/** 月曆格／摘要列用：補班 📌、無薪假 🌪️、支薪放假 🎉 */
function holidayEmoji(h: PublicHolidayEntry): string {
  if (h.is_workday) return "📌";
  if (!h.is_paid) return "🌪️";
  return "🎉";
}

/** 與 overtime_records／核准轉補休合併顯示於同一列的異常類型（避免另起一行） */
const TAG_IDS_MERGE_COMP_OFF_INLINE = new Set([
  "weekend",
  "holiday_work",
  "holiday_work_unpaid",
]);

/** 月曆格內姓名比對（避免全形空白等導致合併失敗） */
function normCalendarName(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

const WAR_WEEK_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function WarCalendar({
  ym,
  leavesByDay,
  anomalyEntriesByDay,
  anomalyEntriesByDayAllEmployees,
  monthPublicHolidays,
  yearPublicHolidayCount,
  compOffByDay,
  csvPunchDaySet,
}: {
  ym: string;
  /** 圖層二：核准假單（與 CSV 是否有列無關） */
  leavesByDay: Map<
    number,
    { employeeName: string; leaveType: string; totalDaysSnippet: string | null }[]
  >;
  /** 圖層三：打卡衍生的異常（不含 leave 標籤，避免與假單圖層重複） */
  anomalyEntriesByDay: Map<
    number,
    { employeeName: string; shortLabel: string; tagId: string }[]
  >;
  /** 未篩選員工：用於判斷「全員無異常」之藍底提示 */
  anomalyEntriesByDayAllEmployees: Map<
    number,
    { employeeName: string; shortLabel: string; tagId: string }[]
  >;
  /** 與戰情主力月相同的 public_holidays */
  monthPublicHolidays: PublicHolidayEntry[];
  /** 主力年（YYYY）內 public_holidays 總筆數（用於空狀態判讀） */
  yearPublicHolidayCount: number;
  /** 圖層三：已核准轉補休（overtime_records） */
  compOffByDay: Map<number, { employeeName: string }[]>;
  /** 該曆日 CSV 主力列是否至少有一筆打卡列（避免無資料之週末誤判為全員正常） */
  csvPunchDaySet: ReadonlySet<number>;
}) {
  const holidaysByDay = useMemo(() => {
    const map = new Map<number, PublicHolidayEntry[]>();
    const prefix = normalizeYmMonthPrefix(ym);
    if (!prefix) return map;
    for (const h of monthPublicHolidays) {
      const d = h.holiday_date.slice(0, 10);
      if (!d.startsWith(prefix)) continue;
      const dayNum = Number(d.slice(8, 10));
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue;
      const list = map.get(dayNum) ?? [];
      list.push(h);
      map.set(dayNum, list);
    }
    return map;
  }, [ym, monthPublicHolidays]);

  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;

  const first = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = first.getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: pad }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-3 font-serif text-base font-semibold text-foreground">
        {y} 年 {m} 月 · 出勤戰情月曆
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          （放假日：本日為休假日；該日有 CSV 且全體在職戰情無異常列時：藍底「此日打卡狀況正常」）
        </span>
      </p>

      {monthPublicHolidays.length === 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-50/90 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/35 dark:text-amber-50">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {y} 年 {m} 月（CSV 主力月）在 public_holidays 尚無任何列
          </p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
            月曆格內綠底假日列僅來自資料表{" "}
            <code className="rounded bg-background/60 px-1 py-px font-mono text-[11px] dark:bg-black/25">
              public_holidays
            </code>
            的 <code className="rounded bg-background/60 px-1 font-mono text-[11px] dark:bg-black/25">holiday_date</code>
            。若遠端表為空、RLS 未開放讀取，或<strong className="font-semibold">年度與 CSV 不一致</strong>
            （例如表內只有 2026 年、CSV 主力月為 2025 年），此處會空白。
            {yearPublicHolidayCount > 0 ? (
              <>
                {" "}
                目前資料庫已有 <strong className="font-semibold">{y} 年</strong> 共 {yearPublicHolidayCount}{" "}
                筆假日，但不含本月日期——請補上該月放假日／補班或檢查日期是否誤植。
              </>
            ) : (
              <>
                {" "}
                目前 <strong className="font-semibold">{y} 年</strong> 亦無任何假日列。請用上方「手動設定特殊假日」新增，或對 Supabase 執行專案內{" "}
                <code className="rounded bg-background/60 px-1 font-mono text-[11px] dark:bg-black/25">
                  seed_public_holidays_tw_2026
                </code>{" "}
                migration（僅種入 2026；其他年度請自行匯入）。
              </>
            )}
          </p>
        </div>
      )}

      {monthPublicHolidays.length > 0 && (
        <div className="mb-3 rounded-lg border border-emerald-700/25 bg-gradient-to-b from-emerald-50/90 to-muted/30 px-3 py-2.5 dark:border-emerald-900/40 dark:from-emerald-950/40 dark:to-muted/20">
          <p className="text-xs font-semibold tracking-wide text-emerald-900 dark:text-emerald-100">
            📅 本月 public_holidays（資料庫）
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
            {monthPublicHolidays.map((h) => {
              const d = h.holiday_date.slice(0, 10);
              const [, mm, dd] = d.split("-");
              const dateShort = `${Number(mm)}/${Number(dd)}`;
              const kind = holidayKindLabel(h);
              return (
                <li
                  key={`${d}-${h.name}-${kind}`}
                  className={cn(
                    "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 text-[11px] font-medium",
                    h.is_workday
                      ? "border-slate-400/50 bg-slate-100/90 text-slate-900 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
                      : !h.is_paid
                        ? "border-fuchsia-500/45 bg-fuchsia-100/80 text-fuchsia-950 dark:border-fuchsia-700/40 dark:bg-fuchsia-950/50 dark:text-fuchsia-50"
                        : "border-emerald-600/35 bg-emerald-100/80 text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/45 dark:text-emerald-50",
                  )}
                >
                  <span className="tabular-nums text-foreground/90">{dateShort}</span>
                  <span className="text-foreground" title={h.name}>
                    <span className="mr-0.5" aria-hidden>
                      {holidayEmoji(h)}
                    </span>
                    {h.name}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      h.is_workday
                        ? "bg-slate-200/90 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                        : !h.is_paid
                          ? "bg-fuchsia-200/90 text-fuchsia-900 dark:bg-fuchsia-900/70 dark:text-fuchsia-100"
                          : "bg-emerald-200/90 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100",
                    )}
                  >
                    {kind}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-secondary/30 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WAR_WEEK_LABELS.map((label) => (
            <div
              key={label}
              className="px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-border/80 border-border/80 bg-card/50 dark:bg-card/30">
        {cells.map((day, idx) => {
          const hols = day != null ? holidaysByDay.get(day) ?? [] : [];
          const leaveRows = day != null ? leavesByDay.get(day) ?? [] : [];
          const entries = day != null ? anomalyEntriesByDay.get(day) ?? [] : [];
          const entriesAll =
            day != null ? anomalyEntriesByDayAllEmployees.get(day) ?? [] : [];
          const compOffLines = day != null ? compOffByDay.get(day) ?? [] : [];
          const compOffNameSet = new Set(
            compOffLines.map((c) => normCalendarName(c.employeeName)).filter(Boolean),
          );
          const restHols = hols.filter((h) => !h.is_workday);
          const makeupHols = hols.filter((h) => h.is_workday);
          const hasAnomaly = entries.length > 0 || compOffLines.length > 0;
          const hasLeaves = leaveRows.length > 0;
          const hasRestHoliday = restHols.length > 0;
          const hasMakeupOnly = makeupHols.length > 0 && restHols.length === 0;
          /** 當日有任何 public_holiday、異常列、核准假單列 */
          const hasCalendarContent = hasAnomaly || hols.length > 0 || hasLeaves;
          const showAllPunchNormal =
            day != null &&
            !hasRestHoliday &&
            csvPunchDaySet.has(day) &&
            entriesAll.length === 0;
          const showRestDayStrip = hasRestHoliday;
          const cellTint =
            day == null
              ? null
              : entries.length > 0 || compOffLines.length > 0
                ? "bg-amber-50/55 dark:bg-amber-950/20"
                : hasRestHoliday
                  ? "bg-slate-100/80 dark:bg-slate-900/45"
                  : showAllPunchNormal
                    ? "bg-blue-50/90 dark:bg-blue-950/40"
                    : hasLeaves
                      ? "bg-emerald-50/35 dark:bg-emerald-950/20"
                      : hasMakeupOnly
                        ? "bg-slate-100/55 dark:bg-slate-950/30"
                        : !hasCalendarContent
                          ? "bg-card/60 dark:bg-card/20"
                          : null;
          return (
            <div
              key={idx}
              className={cn(
                "flex min-h-[120px] max-h-[min(30vh,280px)] flex-col gap-1 overflow-hidden p-1.5 text-left align-top transition-colors sm:p-2 sm:max-h-[min(32vh,300px)]",
                day == null && "min-h-[4.5rem] max-h-none bg-muted/20",
                cellTint,
              )}
            >
              {day != null && (
                <>
                  <div className="shrink-0 border-b border-border/40 pb-0.5 pt-0.5">
                    <span className="tabular-nums text-xs font-bold text-foreground">{day}</span>
                  </div>

                  {showRestDayStrip && (
                    <div className="shrink-0 rounded-md border border-slate-400/35 bg-slate-200/70 px-1.5 py-1 text-center text-[9px] font-semibold text-slate-900 dark:border-slate-600/50 dark:bg-slate-800/70 dark:text-slate-100">
                      本日為休假日
                    </div>
                  )}

                  {/* 圖層一～三：國定／補班、假單、異常、補休 — 共用捲動區（國定與特休同綠底 chip） */}
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain py-0.5">
                    {hols.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {hols.map((h, hi) => (
                          <div
                            key={`ph-${h.holiday_date}-${h.name}-${hi}`}
                            className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-center text-[9px] font-semibold leading-snug text-white shadow-sm dark:bg-emerald-700"
                            title={`${holidayKindLabel(h)}：${h.name}`}
                          >
                            {h.name}
                            <span aria-hidden> {h.is_workday ? "💼" : "🧨"}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {leaveRows.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {leaveRows.map((L, li) => (
                          <div
                            key={`leave-${L.employeeName}-${L.leaveType}-${li}`}
                            className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-center text-[9px] font-semibold leading-snug text-white shadow-sm dark:bg-emerald-700"
                          >
                            <span aria-hidden>🌴</span> {L.employeeName}（{L.leaveType}
                            {L.totalDaysSnippet ? `·${L.totalDaysSnippet}` : ""}）
                          </div>
                        ))}
                      </div>
                    )}

                    {(entries.length > 0 || compOffLines.length > 0) && (
                      <ul className="space-y-0.5 text-[10px] leading-tight text-muted-foreground">
                        {entries.map((e, i) => {
                          const mergeCompOff =
                            TAG_IDS_MERGE_COMP_OFF_INLINE.has(e.tagId) &&
                            compOffNameSet.has(normCalendarName(e.employeeName));
                          return (
                            <li key={`${e.tagId}-${e.employeeName}-${i}`} className="break-words">
                              <span className="font-medium text-foreground">{e.employeeName}</span>
                              <span
                                className={cn(
                                  e.tagId === "holiday_rest"
                                    ? "font-medium text-emerald-700 dark:text-emerald-400"
                                    : e.tagId === "holiday_rest_unpaid"
                                      ? "font-medium text-fuchsia-800 dark:text-fuchsia-300"
                                      : e.tagId === "holiday_work"
                                        ? "font-medium text-amber-800 dark:text-amber-300"
                                        : e.tagId === "holiday_work_unpaid"
                                          ? "font-medium text-orange-800 dark:text-orange-300"
                                          : e.tagId === "hours_invalid"
                                            ? "font-medium text-rose-700 dark:text-rose-300"
                                            : "text-muted-foreground",
                                )}
                              >
                                （{e.shortLabel}
                                {mergeCompOff ? (
                                  <span className="text-emerald-700 dark:text-emerald-300">
                                    {" "}
                                    · <span aria-hidden>💰</span>已轉補休
                                  </span>
                                ) : null}
                                ）
                              </span>
                            </li>
                          );
                        })}
                        {compOffLines
                          .filter((c) => {
                            const n = normCalendarName(c.employeeName);
                            if (!n) return true;
                            return !entries.some(
                              (e) =>
                                TAG_IDS_MERGE_COMP_OFF_INLINE.has(e.tagId) &&
                                normCalendarName(e.employeeName) === n,
                            );
                          })
                          .map((c, ci) => (
                            <li
                              key={`comp-${c.employeeName}-${ci}`}
                              className="break-words font-medium text-foreground"
                            >
                              {c.employeeName}{" "}
                              <span className="text-emerald-700 dark:text-emerald-300">
                                <span aria-hidden>💰</span> 已轉補休
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}

                    {showAllPunchNormal && (
                      <p className="rounded-md border border-blue-500/35 bg-blue-100/90 px-1.5 py-1 text-center text-[9px] font-semibold leading-snug text-blue-950 dark:border-blue-700/45 dark:bg-blue-950/55 dark:text-blue-50">
                        此日打卡狀況正常
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function TagBadge({ tag }: { tag: WarRoomRow["tags"][number] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold shadow-sm",
        tag.className,
      )}
    >
      {tag.label}
    </span>
  );
}

export function AttendanceImporterPanel({
  holidayRefreshTick = 0,
}: {
  /** 由「手動設定特殊假日」等操作遞增，用以重新載入 public_holidays */
  holidayRefreshTick?: number;
} = {}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<AttendanceDayRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [empClockMap, setEmpClockMap] = useState<Map<string, { id: string; name: string }>>(
    () => new Map(),
  );
  const [activeEmployees, setActiveEmployees] = useState<{ id: string; name: string }[]>([]);
  const [leaves, setLeaves] = useState<LeaveSpan[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHolidayEntry[]>([]);
  const [filterEmployeeKey, setFilterEmployeeKey] = useState<string>("");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [overtimeKeys, setOvertimeKeys] = useState<Set<string>>(() => new Set());
  const [overtimeKeysLoading, setOvertimeKeysLoading] = useState(false);
  const [approvalRow, setApprovalRow] = useState<WarRoomRow | null>(null);

  /** 主力月永遠依完整 CSV 推算，避免 empClockMap 尚未載入時 ym 為空而無法查 employees */
  const { ym, filtered: dominantMonthRows } = useMemo(
    () => pickDominantMonth(csvRows),
    [csvRows],
  );

  /** DB 載入完成後，主力月內僅保留對應到在職 timeclock_uid 之列；載入中暫顯示該月全部列（避免閃空） */
  const filtered = useMemo(() => {
    if (!isSupabaseConfigured) return dominantMonthRows;
    if (dbLoading) return dominantMonthRows;
    return dominantMonthRows.filter((r) => {
      const uid = r.uid.trim();
      return uid !== "" && empClockMap.has(uid);
    });
  }, [isSupabaseConfigured, dbLoading, empClockMap, dominantMonthRows]);

  useEffect(() => {
    setFilterEmployeeKey("");
  }, [ym]);

  useEffect(() => {
    if (!ym || !isSupabaseConfigured) {
      setEmpClockMap(new Map());
      setActiveEmployees([]);
      setLeaves([]);
      setPublicHolidays([]);
      setDbError(null);
      setDbLoading(false);
      return;
    }

    let cancelled = false;
    const monthStart = `${ym}-01`;
    const monthEnd = monthEndIso(ym);
    const yearStr = ym.slice(0, 4);
    const yearStart = `${yearStr}-01-01`;
    const yearEnd = `${yearStr}-12-31`;

    (async () => {
      setDbLoading(true);
      setDbError(null);
      try {
        const [empRes, leaveRes, holRes] = await Promise.all([
          supabase
            .from("employees")
            .select("id, name, timeclock_uid, employment_status")
            .is("deleted_at", null)
            .or("employment_status.is.null,employment_status.eq.true"),
          supabase
            .from("leave_requests")
            .select("employee_id, leave_type, start_date, end_date, status")
            // 與主力月份曆日有交疊（跨月起迄亦會撈到）
            .lte("start_date", monthEnd)
            .gte("end_date", monthStart),
          supabase
            .from("public_holidays")
            .select("*")
            // 依 CSV 主力「年」一次載入，避免僅月區間邊界或遠端型別差異導致漏列；畫面上仍只顯示主力月
            .gte("holiday_date", yearStart)
            .lte("holiday_date", yearEnd),
        ]);

        if (cancelled) return;
        if (empRes.error) throw empRes.error;
        if (leaveRes.error) throw leaveRes.error;
        if (holRes.error) throw holRes.error;

        const m = new Map<string, { id: string; name: string }>();
        const active: { id: string; name: string }[] = [];
        for (const e of empRes.data ?? []) {
          const rec = e as {
            id: string;
            name?: string;
            timeclock_uid?: string | null;
            employment_status?: unknown;
          };
          if (!isEmployedInDb(rec.employment_status)) continue;
          active.push({ id: String(rec.id), name: String(rec.name ?? "—") });
          const uid = rec.timeclock_uid != null ? String(rec.timeclock_uid).trim() : "";
          if (!uid) continue;
          m.set(uid, { id: String(rec.id), name: String(rec.name ?? "—") });
        }
        setEmpClockMap(m);
        setActiveEmployees(active);
        const rawLeaves = (leaveRes.data ?? []) as LeaveSpan[];
        setLeaves(rawLeaves.filter((L) => isApprovedLeaveStatus(L.status)));
        setPublicHolidays(normalizePublicHolidayRows((holRes.data ?? []) as Record<string, unknown>[]));
      } catch (e) {
        if (!cancelled)
          setDbError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ym, holidayRefreshTick]);

  const nameByUid = useMemo(() => {
    const map = new Map<string, { employeeId: string | null; name: string }>();
    for (const r of filtered) {
      const k = r.uid.trim();
      if (map.has(k)) continue;
      const hit = empClockMap.get(k);
      map.set(
        k,
        hit
          ? { employeeId: hit.id, name: hit.name }
          : { employeeId: null, name: r.displayName || "—" },
      );
    }
    return map;
  }, [filtered, empClockMap]);

  const warRows = useMemo(
    () => buildWarRoomRows(filtered, nameByUid, leaves, publicHolidays),
    [filtered, nameByUid, leaves, publicHolidays],
  );

  const warRowsWithLeaveOnly = useMemo(() => {
    if (!ym) return warRows;
    return appendLeaveOnlyRowsWithoutPunch(warRows, ym, activeEmployees, leaves);
  }, [warRows, ym, activeEmployees, leaves]);

  const displayWarRows = useMemo(() => {
    if (!ym) return warRowsWithLeaveOnly;
    return appendAbsentEmployeeWarnings(
      warRowsWithLeaveOnly,
      ym,
      activeEmployees,
      leaves,
      publicHolidays,
    );
  }, [warRowsWithLeaveOnly, ym, activeEmployees, leaves, publicHolidays]);

  const activeEmployeeIdSet = useMemo(
    () => new Set(activeEmployees.map((e) => e.id)),
    [activeEmployees],
  );

  /** 排除 employee_id 不在在職名單之列（雙重保險） */
  const panelVisibleWarRows = useMemo(() => {
    return displayWarRows.filter((r) => {
      if (r.employeeId != null && !activeEmployeeIdSet.has(r.employeeId)) return false;
      return true;
    });
  }, [displayWarRows, activeEmployeeIdSet]);

  const employeeFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of panelVisibleWarRows) {
      const key = r.employeeId ?? `row:${r.uid}`;
      if (!m.has(key)) m.set(key, r.employeeName);
    }
    return [...m.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "zh-Hant"),
    );
  }, [panelVisibleWarRows]);

  const filteredDisplayWarRows = useMemo(() => {
    if (!filterEmployeeKey) return panelVisibleWarRows;
    return panelVisibleWarRows.filter((r) => {
      const key = r.employeeId ?? `row:${r.uid}`;
      return key === filterEmployeeKey;
    });
  }, [panelVisibleWarRows, filterEmployeeKey]);

  /** 月曆假單圖層：未篩選＝全部在職；有篩選＝該員（無 employee_id 時為空 Set） */
  const leaveCalendarScope = useMemo((): Set<string> | null => {
    if (!filterEmployeeKey) return null;
    const row = panelVisibleWarRows.find(
      (r) => (r.employeeId ?? `row:${r.uid}`) === filterEmployeeKey,
    );
    if (!row?.employeeId) return new Set<string>();
    return new Set([row.employeeId]);
  }, [filterEmployeeKey, panelVisibleWarRows]);

  const approvedLeavesByDay = useMemo(
    () =>
      buildCalendarApprovedLeavesByDay(ym, leaves, activeEmployees, leaveCalendarScope),
    [ym, leaves, activeEmployees, leaveCalendarScope],
  );

  const scopeEmpIdsForCalendar = useMemo(() => {
    if (!filterEmployeeKey) {
      return new Set(
        panelVisibleWarRows.map((r) => r.employeeId).filter(Boolean) as string[],
      );
    }
    const row = panelVisibleWarRows.find(
      (r) => (r.employeeId ?? `row:${r.uid}`) === filterEmployeeKey,
    );
    if (!row?.employeeId) return new Set<string>();
    return new Set([row.employeeId]);
  }, [filterEmployeeKey, panelVisibleWarRows]);

  const compOffLinesByDay = useMemo(() => {
    const map = new Map<number, { employeeName: string }[]>();
    if (!ym) return map;
    const prefix = `${ym}-`;
    const idToName = new Map(activeEmployees.map((e) => [e.id, e.name]));
    for (const key of overtimeKeys) {
      const tab = key.indexOf("\t");
      if (tab < 0) continue;
      const empId = key.slice(0, tab);
      const dateIso = key.slice(tab + 1);
      if (!scopeEmpIdsForCalendar.has(empId)) continue;
      if (!dateIso.startsWith(prefix)) continue;
      const day = Number(dateIso.slice(8, 10));
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const name = idToName.get(empId) ?? "—";
      const arr = map.get(day) ?? [];
      if (!arr.some((x) => x.employeeName === name)) arr.push({ employeeName: name });
      map.set(day, arr);
    }
    return map;
  }, [ym, overtimeKeys, activeEmployees, scopeEmpIdsForCalendar]);

  const anomalyCalendarMap = useMemo(
    () => buildCalendarAnomalyEntriesByDay(filteredDisplayWarRows),
    [filteredDisplayWarRows],
  );

  /** 全體在職戰情列（未依員工篩選），供月曆「此日打卡狀況正常」判斷 */
  const anomalyCalendarMapAll = useMemo(
    () => buildCalendarAnomalyEntriesByDay(panelVisibleWarRows),
    [panelVisibleWarRows],
  );

  /** 該曆日至少有一筆 CSV 主力列，避免無打卡列之日被誤判為全員正常 */
  const calendarCsvPunchDays = useMemo(() => {
    const set = new Set<number>();
    if (!ym) return set;
    const prefix = normalizeYmMonthPrefix(ym);
    if (!prefix) return set;
    for (const r of filtered) {
      const iso = dateStrToIso(r.date);
      if (!iso || !iso.startsWith(prefix)) continue;
      const d = Number(iso.slice(8, 10));
      if (Number.isFinite(d) && d >= 1 && d <= 31) set.add(d);
    }
    return set;
  }, [ym, filtered]);

  const monthPublicHolidaysSorted = useMemo(
    () => (ym ? listPublicHolidaysInYm(ym, publicHolidays) : []),
    [ym, publicHolidays],
  );

  const yearPublicHolidayCount = useMemo(() => {
    if (!ym) return 0;
    const prefix = `${ym.slice(0, 4)}-`;
    if (prefix.length < 5) return 0;
    return publicHolidays.filter((h) => h.holiday_date.slice(0, 10).startsWith(prefix)).length;
  }, [ym, publicHolidays]);

  const refreshOvertimeKeys = useCallback(async () => {
    if (!ym || !isSupabaseConfigured) {
      setOvertimeKeys(new Set());
      return;
    }
    const empIds = [...new Set(panelVisibleWarRows.map((r) => r.employeeId).filter(Boolean))] as string[];
    if (empIds.length === 0) {
      setOvertimeKeys(new Set());
      return;
    }
    setOvertimeKeysLoading(true);
    try {
      const monthStart = `${ym}-01`;
      const monthEnd = monthEndIso(ym);
      const { data, error } = await supabase
        .from("overtime_records")
        .select("employee_id, overtime_date")
        .in("employee_id", empIds)
        .gte("overtime_date", monthStart)
        .lte("overtime_date", monthEnd);
      if (error) throw error;
      const next = new Set<string>();
      for (const raw of data ?? []) {
        const rec = raw as { employee_id: string; overtime_date: string };
        const d = String(rec.overtime_date).slice(0, 10);
        next.add(`${rec.employee_id}\t${d}`);
      }
      setOvertimeKeys(next);
    } catch (e) {
      console.error("[attendance] overtime_records:", e);
      setOvertimeKeys(new Set());
    } finally {
      setOvertimeKeysLoading(false);
    }
  }, [ym, panelVisibleWarRows]);

  useEffect(() => {
    void refreshOvertimeKeys();
  }, [refreshOvertimeKeys]);

  const persistMonthToDatabase = useCallback(async () => {
    if (!isSupabaseConfigured || warRowsWithLeaveOnly.length === 0) return;
    setSaveLoading(true);
    try {
      const { written, skipped, error } = await bulkUpsertDailyAttendanceFromWarRows(
        supabase,
        warRowsWithLeaveOnly,
      );
      if (error) {
        toast.error(error);
        return;
      }
      if (written === 0) {
        toast.error("沒有可寫入的列（請確認員工已對應 timeclock_uid）。");
        return;
      }
      toast.success("✅ 出勤紀錄已成功寫入資料庫！");
      if (skipped > 0) {
        toast.info(`另有 ${skipped} 筆無法對應 employee_id，已略過。`);
      }
      void refreshOvertimeKeys();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveLoading(false);
    }
  }, [warRowsWithLeaveOnly, refreshOvertimeKeys]);

  const reset = useCallback(() => {
    setFileName(null);
    setCsvRows([]);
    setParseErrors([]);
    setFilterEmployeeKey("");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setReading(false);
      const text = typeof reader.result === "string" ? reader.result : "";
      const { rows: next, parseErrors: errs } = parseAttendanceCsvText(text);
      setCsvRows(next);
      setParseErrors(errs);
    };
    reader.onerror = () => {
      setReading(false);
      setCsvRows([]);
      setParseErrors(["無法讀取檔案。"]);
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const ymLabel = useMemo(() => {
    if (!ym) return "";
    const [y, mo] = ym.split("-");
    return `${y} 年 ${Number(mo)} 月`;
  }, [ym]);

  return (
    <div className="flex flex-col gap-5">
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/80 bg-muted/15 px-4 py-8 text-center shadow-inner transition-colors",
          "hover:border-primary/25 hover:bg-muted/25",
          dragOver && "border-primary/40 bg-primary/5",
        )}
        onDragEnter={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && (f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv")) {
            onFile(f);
          }
        }}
      >
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            onFile(f);
          }}
        />
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center gap-3"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <span className="font-medium text-foreground">選擇 CSV 檔案</span>
          <span className="text-xs text-muted-foreground">
            無標題陣列：2＝UID、4＝Status（1／2）、8＝日期時間（8 欄列為第 7 欄）；支援上午／下午與 AM／PM
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={reading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {reading ? "讀取中…" : "瀏覽檔案"}
          </Button>
          {(fileName || csvRows.length || parseErrors.length) && (
            <Button type="button" variant="ghost" onClick={reset}>
              清除
            </Button>
          )}
        </div>
        {fileName && (
          <p className="mt-3 text-xs text-muted-foreground">
            已選擇：<span className="font-medium text-foreground">{fileName}</span>
          </p>
        )}
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
          <p className="font-medium">解析提醒</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-relaxed opacity-95">
            {parseErrors.slice(0, 12).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {parseErrors.length > 12 && <li>…另有 {parseErrors.length - 12} 則略</li>}
          </ul>
        </div>
      )}

      {csvRows.length > 0 && ym && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <span className="font-medium">本月分析目標：</span>
          <span className="tabular-nums">{ymLabel}</span>
          <span className="text-muted-foreground">
            （{filtered.length} 筆，已排除其他月份）
          </span>
          {dbLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              同步員工、假單與國定假日…
            </span>
          )}
        </div>
      )}

      {!isSupabaseConfigured && csvRows.length > 0 && (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {SUPABASE_CONFIG_HELP} 未連線時僅能以 CSV 姓名顯示，無法對應 timeclock_uid 與假單豁免。
        </p>
      )}

      {dbError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          資料庫：{dbError}
        </p>
      )}

      {csvRows.length > 0 &&
        ym &&
        (panelVisibleWarRows.length > 0 || monthPublicHolidaysSorted.length > 0) && (
        <WarCalendar
          ym={ym}
          leavesByDay={approvedLeavesByDay}
          anomalyEntriesByDay={anomalyCalendarMap}
          anomalyEntriesByDayAllEmployees={anomalyCalendarMapAll}
          monthPublicHolidays={monthPublicHolidaysSorted}
          yearPublicHolidayCount={yearPublicHolidayCount}
          compOffByDay={compOffLinesByDay}
          csvPunchDaySet={calendarCsvPunchDays}
        />
      )}

      {csvRows.length > 0 && ym && panelVisibleWarRows.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium text-foreground">篩選員工</span>
              <select
                className={cn(
                  "h-9 min-w-[11rem] max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                value={filterEmployeeKey}
                onChange={(e) => setFilterEmployeeKey(e.target.value)}
                aria-label="依員工篩選戰情表格與月曆"
              >
                <option value="">全部員工</option>
                {employeeFilterOptions.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {filterEmployeeKey && filteredDisplayWarRows.length === 0 && (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                此篩選下沒有列；請改選「全部員工」或確認該員在本月 CSV 有資料。
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <Table wrapperClassName="max-h-[min(72vh,880px)] overflow-auto">
              <TableHeader className="sticky top-0 z-20 border-b border-border bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className="border-b-0 bg-card hover:bg-card">
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">日期</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">星期</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">員工名稱</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">上班打卡</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">下班打卡</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">該日時數</TableHead>
                  <TableHead className="bg-card text-xs font-semibold">狀態／異常</TableHead>
                  <TableHead className="whitespace-nowrap bg-card text-xs font-semibold">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDisplayWarRows.map((r) => (
                  <TableRow
                    key={`${r.dateIso}-${r.uid}`}
                    className="border-b border-border hover:bg-muted/20"
                  >
                    <TableCell className="whitespace-nowrap tabular-nums text-sm text-foreground">
                      {r.dateDisplay}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.weekdayLabel}</TableCell>
                    <TableCell className="text-sm font-medium text-foreground">{r.employeeName}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-sm">
                      {r.clockIn ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-sm">
                      {r.clockOut ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-sm">
                      {r.hoursDay != null ? `${r.hoursDay} 小時` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          r.tags.map((t, ti) => (
                            <TagBadge key={`${r.dateIso}-${r.uid}-${ti}-${t.id}`} tag={t} />
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-middle">
                      {isOvertimeCompApprovable(r) ? (
                        overtimeKeysLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : r.employeeId &&
                          overtimeKeys.has(overtimeLookupKey(r.employeeId, r.dateIso)) ? (
                          <span className="text-xs font-semibold text-muted-foreground">
                            🔒 已轉補休
                          </span>
                        ) : (
                          <Button
                            type="button"
                            className="h-8 gap-1 bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                            onClick={() => setApprovalRow(r)}
                          >
                            {overtimeApprovalButtonLabel(r)}
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              className="h-11 w-full gap-2 px-6 text-base font-semibold shadow-md sm:w-auto sm:min-w-[20rem]"
              disabled={saveLoading || dbLoading}
              onClick={() => void persistMonthToDatabase()}
            >
              {saveLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  寫入中…
                </>
              ) : (
                <>📥 確認無誤，將本月紀錄寫入資料庫</>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              以 UNIQUE(employee_id, attendance_date) 覆寫或新增；含「僅請假、CSV 無該日打卡列」之列（上下班／時數為空、status_tags 為假單標籤）。資料庫內既有的「🔒 已轉補休」標籤會保留。
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-line border-t border-border/60 pt-3">
            上班時間：週一至週五：9:00 - 18:00{"\n"}
            中午休息12:00 - 13:00{"\n"}
            打卡時間異常(提早下班、遲到)15分鐘為裕度{"\n"}
            當日有效工時（扣午休）≤7 小時標示「時數不足」；&gt;9 小時標示「時間超時」（可搭配核准加班／補休）{"\n"}
            已核准請假但 CSV 該日完全沒有該員之列時，仍會顯示一列（僅假單標籤，上下班與時數為空）；按下「寫入資料庫」時一併寫入 daily_attendance。{"\n"}
            在職員工於主力月份之應出勤日（平日或補班週末），若 CSV 無任何打卡紀錄且非核准假單涵蓋日、非國定放假日，會列示「未出勤」。國定放假日（public_holidays.is_workday=false）不標缺卡；補班日（is_workday=true）視同平日。{"\n"}
            離職或無法對應在職 timeclock_uid 之 CSV 列已略過，不列入本表、Raw 匯總與月曆異常統計。
          </p>
        </div>
      )}

      {fileName && !reading && csvRows.length === 0 && parseErrors.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          沒有可匯總的列（請確認 Status 為 1／2 且日期時間格式正確）。
        </p>
      )}

      {csvRows.length > 0 &&
        ym &&
        warRows.length === 0 &&
        panelVisibleWarRows.length === 0 &&
        !reading && (
        <p className="text-center text-sm text-muted-foreground">
          主力月份內無法產出戰情列（請檢查日期欄位）。
        </p>
      )}

      <WeekendOvertimeApprovalDialog
        open={approvalRow != null}
        onOpenChange={(open) => {
          if (!open) setApprovalRow(null);
        }}
        row={approvalRow}
        onApproved={() => void refreshOvertimeKeys()}
      />
    </div>
  );
}
