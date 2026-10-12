"use client";

import { cn } from "@/lib/utils";
import { describeActorLabel } from "@/lib/order-audit-trail";
import {
  formatHistoryDate,
  groupHistoryByDate,
  HISTORY_KIND_LABELS,
  type HistoryActor,
  type HistoryEvent,
  type HistoryEventKind,
} from "@/lib/order-history";

const KIND_CHIP: Record<HistoryEventKind, string> = {
  created: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  status: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  stage: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  payment: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  invoice: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  photos: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  shipped: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  return: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const KIND_DOT: Record<HistoryEventKind, string> = {
  created: "bg-slate-400",
  status: "bg-sky-500",
  stage: "bg-indigo-500",
  payment: "bg-amber-500",
  invoice: "bg-amber-500",
  photos: "bg-emerald-500",
  shipped: "bg-teal-500",
  return: "bg-rose-500",
};

const MAX_INLINE_PHOTOS = 6;

export function OrderHistoryTimeline({
  events,
  userNames,
  employeeNames,
  thumbUrlOf,
  onOpenPhotos,
}: {
  events: HistoryEvent[];
  userNames: Record<string, string>;
  employeeNames: Record<string, string>;
  /** 照片 id → 縮圖網址 */
  thumbUrlOf: (photoId: string) => string | undefined;
  /** 點照片：開啟這一組照片的大圖 */
  onOpenPhotos: (photoIds: string[], index: number) => void;
}) {
  function actorText(actor: HistoryActor | undefined): string | null {
    if (!actor) return null;
    if (actor.employeeId && employeeNames[actor.employeeId]) return employeeNames[actor.employeeId];
    if (actor.userId && userNames[actor.userId]) return userNames[actor.userId];
    if (actor.label) return describeActorLabel(actor.label, {});
    return null;
  }

  if (events.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">尚無紀錄</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {groupHistoryByDate(events).map((group) => (
        <li key={group.date}>
          <h3 className="text-xs font-medium text-muted-foreground">{formatHistoryDate(group.date)}</h3>
          <ul className="mt-2 flex flex-col gap-3 border-l border-border pl-4">
            {group.events.map((e) => {
              const actor = actorText(e.actor);
              const shown = e.photoIds.slice(0, MAX_INLINE_PHOTOS);
              const more = e.photoIds.length - shown.length;
              return (
                <li key={e.key} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                      KIND_DOT[e.kind],
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {e.time ? (
                      <span className="text-xs tabular-nums text-muted-foreground">{e.time}</span>
                    ) : null}
                    <span
                      className={cn(
                        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        KIND_CHIP[e.kind],
                      )}
                    >
                      {HISTORY_KIND_LABELS[e.kind]}
                    </span>
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{e.title}</span>
                    {actor ? <span className="text-xs text-muted-foreground">· {actor}</span> : null}
                  </div>
                  {e.subject ? (
                    <p className="mt-0.5 break-words text-sm text-foreground/80">{e.subject}</p>
                  ) : null}
                  {e.notes.map((n, i) => (
                    <p key={i} className="mt-0.5 text-[11px] text-muted-foreground">
                      └ {n}
                    </p>
                  ))}
                  {shown.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {shown.map((id, i) => {
                        const url = thumbUrlOf(id);
                        const isLast = i === shown.length - 1 && more > 0;
                        return (
                          <button
                            key={id}
                            type="button"
                            className="relative h-16 w-16 overflow-hidden rounded-md bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40"
                            onClick={() => onOpenPhotos(e.photoIds, i)}
                            aria-label={`查看照片 ${i + 1}`}
                          >
                            {url ? (
                              // eslint-disable-next-line @next/next/no-img-element -- private bucket signed URL
                              <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : null}
                            {isLast ? (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
                                +{more}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
