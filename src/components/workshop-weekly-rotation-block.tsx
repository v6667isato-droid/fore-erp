"use client";

import { useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import {
  fetchLatestWorkshopRotationSafe,
  type WorkshopRotationDisplay,
} from "@/lib/meeting-minutes";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** 2×2：左上 → 右上 → 左下 → 右下 */
const CELLS: {
  key: keyof Pick<WorkshopRotationDisplay, "vertical" | "hand" | "supervisor" | "duty">;
  labelShort: string;
}[] = [
  { key: "vertical", labelShort: "立式機具（2）" },
  { key: "hand", labelShort: "手工機具" },
  { key: "supervisor", labelShort: "機動監督" },
  { key: "duty", labelShort: "值日生" },
];

function formatMeetingDateLabel(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, dayNum] = d.split("-").map(Number);
  return `${y}/${m}/${dayNum}`;
}

function namesFor(
  data: WorkshopRotationDisplay,
  key: (typeof CELLS)[number]["key"],
): string {
  const list = data[key];
  if (!list.length) return "—";
  return list.map((x) => x.name).join("、");
}

export function WorkshopWeeklyRotationBlock({
  refreshTick = 0,
  subtitle,
}: {
  /** 與開會紀錄儲存同步時遞增，以重新抓取「最近一次」輪替 */
  refreshTick?: number;
  subtitle?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [data, setData] = useState<WorkshopRotationDisplay | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setData(null);
      setError(null);
      setHint(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setHint(null);
      const r = await fetchLatestWorkshopRotationSafe();
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.message);
        setHint("hint" in r ? r.hint ?? null : null);
        setData(null);
        return;
      }
      setData(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const hasAnyNames =
    data &&
    CELLS.some((row) => {
      const list = data[row.key];
      return Array.isArray(list) && list.length > 0;
    });

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex shrink-0 items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-800 dark:text-amber-200">
          <Wrench className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">週五工坊維護輪替</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">依最近一次開會紀錄（會議日期）</p>
          )}
        </div>
      </div>

      {!isSupabaseConfigured ? (
        <p className="text-sm text-muted-foreground">連線 Supabase 後可顯示輪替人員。</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          載入中…
        </p>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">尚無開會紀錄，請於開會紀錄填寫輪替。</p>
      ) : (
        <div>
          <p className="mb-2 text-[10px] tabular-nums text-muted-foreground">
            {formatMeetingDateLabel(data.meetingDate)}
          </p>
          {!hasAnyNames ? (
            <p className="text-xs text-muted-foreground">尚未設定輪替。</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {CELLS.map((cell) => (
                <div
                  key={cell.key}
                  className="min-w-0 rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 sm:px-2.5 sm:py-2"
                >
                  <p className="text-[10px] font-medium leading-none text-muted-foreground">
                    {cell.labelShort}
                  </p>
                  <p className="mt-1 break-words text-xs leading-snug text-foreground">
                    {namesFor(data, cell.key)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
