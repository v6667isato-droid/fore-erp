"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Upload, Clock, Loader2 } from "lucide-react";
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
  buildCalendarEntriesByDay,
  buildWarRoomRows,
  pickDominantMonth,
  type LeaveSpan,
  type WarRoomRow,
} from "@/lib/attendance-war-room";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";

function monthEndIso(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

function WarCalendar({
  ym,
  entriesByDay,
}: {
  ym: string;
  entriesByDay: Map<
    number,
    { employeeName: string; shortLabel: string; tagId: string }[]
  >;
}) {
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

  const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-3 font-serif text-base font-semibold text-foreground">
        {y} 年 {m} 月 · 異常熱點日曆
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {weekLabels.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          const entries = day != null ? entriesByDay.get(day) ?? [] : [];
          const has = entries.length > 0;
          return (
            <div
              key={idx}
              className={cn(
                "min-h-[5.5rem] rounded-lg border p-1 text-left align-top",
                day == null && "border-transparent bg-transparent",
                day != null && !has && "border-border/40 bg-muted/10",
                day != null && has && "border-amber-700/30 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
              )}
            >
              {day != null && (
                <>
                  <div className="mb-0.5 text-xs font-semibold tabular-nums text-foreground">
                    {day}
                  </div>
                  <ul className="max-h-20 space-y-0.5 overflow-y-auto text-[10px] leading-tight text-muted-foreground">
                    {entries.map((e, i) => (
                      <li key={i} className="break-words">
                        <span className="font-medium text-foreground">{e.employeeName}</span>
                        <span className="text-muted-foreground">（{e.shortLabel}）</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
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

export function AttendanceImporterPanel() {
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
  const [leaves, setLeaves] = useState<LeaveSpan[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const { ym, filtered } = useMemo(() => pickDominantMonth(csvRows), [csvRows]);

  useEffect(() => {
    if (!ym || !isSupabaseConfigured) {
      setEmpClockMap(new Map());
      setLeaves([]);
      setDbError(null);
      setDbLoading(false);
      return;
    }

    let cancelled = false;
    const monthStart = `${ym}-01`;
    const monthEnd = monthEndIso(ym);

    (async () => {
      setDbLoading(true);
      setDbError(null);
      try {
        const [empRes, leaveRes] = await Promise.all([
          supabase
            .from("employees")
            .select("id, name, timeclock_uid")
            .is("deleted_at", null),
          supabase
            .from("leave_requests")
            .select("employee_id, leave_type, start_date, end_date, status")
            .lte("start_date", monthEnd)
            .gte("end_date", monthStart),
        ]);

        if (cancelled) return;
        if (empRes.error) throw empRes.error;
        if (leaveRes.error) throw leaveRes.error;

        const m = new Map<string, { id: string; name: string }>();
        for (const e of empRes.data ?? []) {
          const rec = e as {
            id: string;
            name?: string;
            timeclock_uid?: string | null;
          };
          const uid = rec.timeclock_uid != null ? String(rec.timeclock_uid).trim() : "";
          if (uid)
            m.set(uid, { id: String(rec.id), name: String(rec.name ?? "—") });
        }
        setEmpClockMap(m);
        setLeaves((leaveRes.data ?? []) as LeaveSpan[]);
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
  }, [ym]);

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
    () => buildWarRoomRows(filtered, nameByUid, leaves),
    [filtered, nameByUid, leaves],
  );

  const calendarMap = useMemo(() => buildCalendarEntriesByDay(warRows), [warRows]);

  const reset = useCallback(() => {
    setFileName(null);
    setCsvRows([]);
    setParseErrors([]);
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
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-primary">
            <Clock className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-serif text-lg font-semibold text-foreground">出勤戰情分析室</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              上傳打卡鐘 CSV 後，自動以<strong className="font-medium text-foreground/90">資料筆數最多的年月</strong>
              作為分析目標並過濾其他月份。結合 Supabase 員工（timeclock_uid）與核准假單產出異常標籤與月曆熱點。
            </p>
          </div>
        </div>
      </div>

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
              同步員工與假單…
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

      {csvRows.length > 0 && ym && warRows.length > 0 && (
        <WarCalendar ym={ym} entriesByDay={calendarMap} />
      )}

      {csvRows.length > 0 && ym && warRows.length > 0 && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30">
                  <TableHead className="whitespace-nowrap text-xs font-semibold">日期</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold">星期</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold">員工名稱</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold">上班打卡</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold">下班打卡</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold">該日時數</TableHead>
                  <TableHead className="text-xs font-semibold">狀態／異常</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warRows.map((r, idx) => (
                  <TableRow
                    key={`${r.dateIso}-${r.uid}-${idx}`}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-line border-t border-border/60 pt-3">
            上班時間：週一至週五：9:00 - 18:00{"\n"}
            中午休息12:00 - 13:00{"\n"}
            打卡時間異常(提早下班、遲到)15分鐘為裕度
          </p>
        </div>
      )}

      {fileName && !reading && csvRows.length === 0 && parseErrors.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          沒有可匯總的列（請確認 Status 為 1／2 且日期時間格式正確）。
        </p>
      )}

      {csvRows.length > 0 && ym && warRows.length === 0 && !reading && (
        <p className="text-center text-sm text-muted-foreground">
          主力月份內無法產出戰情列（請檢查日期欄位）。
        </p>
      )}
    </div>
  );
}
