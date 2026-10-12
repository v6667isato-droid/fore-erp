"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Images, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ImageLightbox, type LightboxImage } from "@/components/ui/image-lightbox";
import { OrderHistoryTimeline } from "@/components/orders/order-history-timeline";
import { OrderCompletionPhotos } from "@/components/orders/order-completion-photos";
import { buildOrderHistory } from "@/lib/order-history";
import { loadOrderHistoryData, type OrderHistoryData } from "@/lib/order-history-data";
import { signOrderRecordUrls } from "@/lib/order-attachments";

type Tab = "timeline" | "photos";

function slashDate(ymd: string | null): string {
  return ymd ? ymd.slice(0, 10).replace(/-/g, "/") : "—";
}

/** 訂單履歷：從建立到出貨的時間軸＋依品項上傳的完工照片 */
export function OrderHistoryDialog({
  order,
  open,
  onOpenChange,
  onPhotosChanged,
}: {
  order: { id: string; order_number: string | null; customer_name?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 照片新增／刪除後通知列表更新張數 */
  onPhotosChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [data, setData] = useState<OrderHistoryData | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  /** 只採用最後一次載入的結果（快速切換訂單時避免舊結果蓋掉新的） */
  const loadSeqRef = useRef(0);

  const orderId = order?.id ?? null;

  const load = useCallback(async (id: string) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const next = await loadOrderHistoryData(id);
      const signed = await signOrderRecordUrls(
        next.attachments.flatMap((a) => [a.storage_path, a.thumb_path ?? ""]),
      );
      if (seq !== loadSeqRef.current) return;
      setData(next);
      setUrls(signed);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      toast.error(`載入訂單履歷失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !orderId) return;
    setTab("timeline");
    setData(null);
    setUrls({});
    void load(orderId);
  }, [open, orderId, load]);

  const events = useMemo(() => (data ? buildOrderHistory(data.input) : []), [data]);

  const attachmentById = useMemo(
    () => new Map((data?.attachments ?? []).map((a) => [a.id, a])),
    [data],
  );
  const itemLabelById = useMemo(
    () => new Map((data?.items ?? []).map((it) => [it.id, it.label])),
    [data],
  );

  const openPhotos = useCallback(
    (photoIds: string[], index: number) => {
      const images: LightboxImage[] = [];
      for (const id of photoIds) {
        const a = attachmentById.get(id);
        const url = a ? (urls[a.storage_path] ?? urls[a.thumb_path ?? ""]) : undefined;
        if (!a || !url) continue;
        const item = a.order_item_id ? (itemLabelById.get(a.order_item_id) ?? "已移除的品項") : "整張訂單";
        images.push({ url, title: [item, a.taken_on ? slashDate(a.taken_on) : null].filter(Boolean).join(" · ") });
      }
      if (images.length > 0) setLightbox({ images, index: Math.min(index, images.length - 1) });
    },
    [attachmentById, itemLabelById, urls],
  );

  const thumbUrlOf = useCallback(
    (photoId: string) => {
      const a = attachmentById.get(photoId);
      return a ? (urls[a.thumb_path ?? ""] ?? urls[a.storage_path]) : undefined;
    },
    [attachmentById, urls],
  );

  const photoCount = data?.attachments.length ?? 0;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed inset-0 z-50 flex max-h-[100dvh] flex-col bg-background shadow-lg focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:border-border"
            aria-describedby={undefined}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-4">
              <div className="min-w-0">
                <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Images className="h-4 w-4 shrink-0" />
                  訂單履歷
                </Dialog.Title>
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {order?.order_number ?? ""}
                  {order?.customer_name ? ` · ${order.customer_name}` : ""}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </Dialog.Close>
            </div>

            <div className="border-b border-border px-4 py-2">
              <div
                className="inline-flex flex-wrap rounded-xl border border-border bg-muted/30 p-1 shadow-inner"
                role="tablist"
                aria-label="訂單履歷分頁"
              >
                {(
                  [
                    { id: "timeline" as const, label: "時間軸" },
                    { id: "photos" as const, label: `完工照片${data ? `（${photoCount}）` : ""}` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={cn(
                      "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                      tab === t.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {!data ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "載入訂單履歷中…" : "無法載入訂單履歷"}
                </p>
              ) : tab === "timeline" ? (
                <div className="flex flex-col gap-4">
                  <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">目前狀態</dt>
                      <dd className="mt-0.5 font-medium text-foreground">{data.summary.status ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">下單日</dt>
                      <dd className="mt-0.5 tabular-nums text-foreground">{slashDate(data.summary.order_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">預計交期</dt>
                      <dd className="mt-0.5 tabular-nums text-foreground">
                        {slashDate(data.summary.expected_delivery_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">完工照片</dt>
                      <dd className="mt-0.5 text-foreground">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setTab("photos")}
                        >
                          {photoCount} 張
                        </button>
                      </dd>
                    </div>
                  </dl>
                  <OrderHistoryTimeline
                    events={events}
                    userNames={data.userNames}
                    employeeNames={data.employeeNames}
                    thumbUrlOf={thumbUrlOf}
                    onOpenPhotos={openPhotos}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    訂單狀態自 2026/8/6 起有完整紀錄，更早的訂單只顯示建立、收款與出貨日期。
                  </p>
                </div>
              ) : (
                <OrderCompletionPhotos
                  orderId={orderId ?? ""}
                  items={data.items}
                  attachments={data.attachments}
                  urls={urls}
                  onChanged={() => {
                    if (orderId) void load(orderId);
                    onPhotosChanged?.();
                  }}
                  onOpenPhotos={openPhotos}
                />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ImageLightbox
        images={lightbox?.images ?? []}
        index={lightbox?.index ?? null}
        onIndexChange={(index) => setLightbox((cur) => (cur && index != null ? { ...cur, index } : null))}
      />
    </>
  );
}
