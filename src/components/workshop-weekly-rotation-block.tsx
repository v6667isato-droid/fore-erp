"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, Loader2, Wrench, X } from "lucide-react";
import {
  fetchLatestWorkshopRotationSafe,
  type WorkshopRotationDisplay,
} from "@/lib/meeting-minutes";
import { epSection } from "@/lib/employee-portal-section-styles";
import { Button, buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Google Drive：/preview 利於 iframe 與瀏覽器內直接預覽 PDF（免先下載） */
const WORKSHOP_CHECKLIST_PREVIEW_URL =
  "https://drive.google.com/file/d/1_Qk3N1q7GhRbp4SUSD2Az-1KCwFP7HOW/preview";

const WORKSHOP_INVENTORY_PREVIEW_URL =
  "https://drive.google.com/file/d/175bDNbVsgVMpirWtMwqsw0ylVSmqxOPI/preview";

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

/** 顯示為「近期更新 MM/DD」 */
function formatRecentUpdateMd(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [, m, dayNum] = d.split("-").map(Number);
  return `${String(m).padStart(2, "0")}/${String(dayNum).padStart(2, "0")}`;
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
  showSubtitleLine = true,
}: {
  /** 與開會紀錄儲存同步時遞增，以重新抓取「最近一次」輪替 */
  refreshTick?: number;
  subtitle?: string;
  /** false：不顯示預設／副標說明（給非 admin 儀表板） */
  showSubtitleLine?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [data, setData] = useState<WorkshopRotationDisplay | null>(null);
  const [pdfViewer, setPdfViewer] = useState<null | { title: string; src: string }>(null);

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
    <section className={epSection.card}>
      <Dialog.Root
        open={pdfViewer != null}
        onOpenChange={(open) => {
          if (!open) setPdfViewer(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(92vh,52rem)] w-[calc(100%-1.25rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl focus:outline-none sm:w-[calc(100%-2rem)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-3 py-2.5 sm:px-4">
              <Dialog.Title className="min-w-0 text-sm font-semibold text-foreground">
                {pdfViewer?.title ?? "PDF"}
              </Dialog.Title>
              <div className="flex shrink-0 items-center gap-1">
                {pdfViewer ? (
                  <a
                    href={pdfViewer.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "h-8 gap-1 px-2 text-xs text-muted-foreground",
                    )}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    新分頁
                  </a>
                ) : null}
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="關閉">
                    <X className="h-4 w-4" />
                  </Button>
                </Dialog.Close>
              </div>
            </div>
            <Dialog.Description className="sr-only">
              於此視窗內預覽 PDF；若無法顯示請使用「新分頁」開啟。
            </Dialog.Description>
            {pdfViewer ? (
              <iframe
                title={pdfViewer.title}
                src={pdfViewer.src}
                className="min-h-[min(72vh,560px)] w-full flex-1 border-0 bg-muted/20"
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className={cn(epSection.headerRowStart, "shrink-0")}>
        <div className={epSection.iconBoxAmber}>
          <Wrench className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h3 className={epSection.title}>週五工坊維護輪替</h3>
              {data?.meetingDate ? (
                <p className={cn("mt-0.5", epSection.subtitle)}>
                  近期更新 {formatRecentUpdateMd(data.meetingDate)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                onClick={() =>
                  setPdfViewer({ title: "工作清單表單", src: WORKSHOP_CHECKLIST_PREVIEW_URL })
                }
                className="cursor-pointer text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                工作清單表單
              </button>
              <button
                type="button"
                onClick={() =>
                  setPdfViewer({ title: "盤點表", src: WORKSHOP_INVENTORY_PREVIEW_URL })
                }
                className="cursor-pointer text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                盤點表
              </button>
            </div>
          </div>
          {showSubtitleLine ? (
            subtitle ? (
              <p className={cn("mt-0.5", epSection.subtitle)}>{subtitle}</p>
            ) : (
              <p className={cn("mt-0.5", epSection.subtitle)}>依最近一次開會紀錄（會議日期）</p>
            )
          ) : null}
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
