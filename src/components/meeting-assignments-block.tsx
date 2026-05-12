"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchMeetingAssignmentsForEmployee,
  upsertMeetingAssignmentAssigneeStatus,
  type MeetingAssignmentForEmployeeRow,
} from "@/lib/meeting-minutes";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

function formatMd(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, day] = d.split("-").map(Number);
  return `${y}/${m}/${day}`;
}

interface MeetingAssignmentsBlockProps {
  employeeId: string;
  /** 與開會紀錄區塊同步：變更時重新抓取交辦 */
  meetingDataTick: number;
  onStatusChanged?: () => void;
}

export function MeetingAssignmentsBlock({
  employeeId,
  meetingDataTick,
  onStatusChanged,
}: MeetingAssignmentsBlockProps) {
  const [rows, setRows] = useState<MeetingAssignmentForEmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !employeeId) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchMeetingAssignmentsForEmployee(employeeId);
      if (!r.ok) {
        setError(r.message);
        setRows([]);
        return;
      }
      setRows(r.rows);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load, meetingDataTick]);

  async function toggleCompleted(row: MeetingAssignmentForEmployeeRow, completed: boolean) {
    if (!isSupabaseConfigured) {
      toast.success("（Mock）僅示意，連線後會寫入資料庫。");
      return;
    }
    setPendingId(row.assignment_id);
    try {
      const r = await upsertMeetingAssignmentAssigneeStatus({
        assignmentId: row.assignment_id,
        employeeId,
        completed,
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setRows((prev) =>
        prev.map((x) =>
          x.assignment_id === row.assignment_id
            ? {
                ...x,
                completed,
                status_updated_at: new Date().toISOString(),
              }
            : x,
        ),
      );
      onStatusChanged?.();
    } finally {
      setPendingId(null);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        連線 Supabase 後可在此勾選開會紀錄交辦之完成狀態。
      </p>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        載入開會交辦…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        無法載入開會交辦：{error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">目前沒有指派給您的開會交辦。</p>
    );
  }

  return (
    <ul className="space-y-2 pr-2">
      {rows.map((row) => {
        const busy = pendingId === row.assignment_id;
        return (
          <li
            key={row.assignment_id}
            className={cn(
              "flex gap-3 rounded-xl border border-border/60 px-3 py-3 sm:px-4",
              "bg-muted/15 transition-colors hover:bg-muted/25",
            )}
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={row.completed}
                disabled={busy}
                onChange={(e) => void toggleCompleted(row, e.target.checked)}
                className="size-4 shrink-0 rounded border-input text-primary focus:ring-ring"
              />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium text-foreground",
                    row.completed && "text-muted-foreground line-through decoration-border",
                  )}
                >
                  {row.content}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium",
                      row.completed
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
                    )}
                  >
                    {row.completed ? "已完成" : "待辦"}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    開會日 {formatMd(row.meeting_date)}
                  </span>
                  {row.completed && row.status_updated_at ? (
                    <span className="whitespace-nowrap text-xs text-emerald-700 tabular-nums">
                      完成 {formatMd(row.status_updated_at)}
                    </span>
                  ) : null}
                  {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
