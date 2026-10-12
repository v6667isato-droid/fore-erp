"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { readExifDateFromFile } from "@/lib/exif-date";
import {
  isImageFile,
  softDeleteOrderAttachment,
  uploadCompletionPhoto,
  type OrderAttachment,
} from "@/lib/order-attachments";
import type { OrderHistoryItem } from "@/lib/order-history-data";

/** 不掛品項的照片（整張訂單合照） */
const ORDER_TARGET = "__order__";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(ymd: string | null): string | null {
  const m = ymd ? /^\d{4}-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
}

interface Pending {
  target: string;
  files: File[];
  takenOn: string;
  fromExif: boolean;
}

/** 完工照片：依品項分區上傳（辦公室整理後上傳，可多選或拖曳） */
export function OrderCompletionPhotos({
  orderId,
  items,
  attachments,
  urls,
  onChanged,
  onOpenPhotos,
}: {
  orderId: string;
  items: OrderHistoryItem[];
  attachments: OrderAttachment[];
  /** storage path → signed URL */
  urls: Record<string, string>;
  onChanged: () => void;
  onOpenPhotos: (photoIds: string[], index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pickTargetRef = useRef<string>(ORDER_TARGET);
  const [pending, setPending] = useState<Pending | null>(null);
  const [uploading, setUploading] = useState<{ target: string; done: number; total: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrderAttachment | null>(null);

  const itemIds = new Set(items.map((it) => it.id));
  const photosOf = (target: string) =>
    attachments.filter((a) =>
      target === ORDER_TARGET ? a.order_item_id == null : a.order_item_id === target,
    );
  const orphanPhotos = attachments.filter((a) => a.order_item_id != null && !itemIds.has(a.order_item_id));

  async function stageFiles(target: string, list: FileList | null) {
    const files = [...(list ?? [])].filter(isImageFile);
    if (files.length === 0) {
      toast.error("請選擇照片檔");
      return;
    }
    // 完工日期預設取照片中最晚的拍攝日；都讀不到就用今天
    const dates = (await Promise.all(files.map(readExifDateFromFile)))
      .filter((d): d is string => d != null)
      .sort();
    setPending({
      target,
      files,
      takenOn: dates[dates.length - 1] ?? localToday(),
      fromExif: dates.length > 0,
    });
  }

  function pick(target: string) {
    pickTargetRef.current = target;
    inputRef.current?.click();
  }

  async function uploadPending() {
    if (!pending) return;
    const { target, files, takenOn } = pending;
    setPending(null);
    setUploading({ target, done: 0, total: files.length });
    const failures: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        await uploadCompletionPhoto({
          orderId,
          orderItemId: target === ORDER_TARGET ? null : target,
          file,
          takenOn: takenOn || null,
        });
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
      setUploading({ target, done: i + 1, total: files.length });
    }
    setUploading(null);
    if (failures.length === 0) {
      toast.success(`已上傳 ${files.length} 張完工照片`);
    } else {
      toast.error(
        `${files.length - failures.length} 張成功、${failures.length} 張失敗：${failures[0]}`,
      );
    }
    onChanged();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await softDeleteOrderAttachment(deleteTarget.id);
      toast.success("已刪除照片");
      onChanged();
    } catch (e) {
      toast.error(`刪除失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function renderGrid(photos: OrderAttachment[]) {
    const ids = photos.map((p) => p.id);
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {photos.map((p, i) => {
          const thumb = urls[p.thumb_path ?? ""] ?? urls[p.storage_path];
          const date = shortDate(p.taken_on);
          return (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
              <button
                type="button"
                className="h-full w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring/40"
                onClick={() => onOpenPhotos(ids, i)}
                aria-label={`查看照片 ${i + 1}`}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private bucket signed URL
                  <img src={thumb} alt={p.file_name ?? ""} className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </button>
              {date ? (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                  {date}
                </span>
              ) : null}
              <button
                type="button"
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/60"
                onClick={() => setDeleteTarget(p)}
                aria-label="刪除照片"
                title="刪除照片"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  function renderSection(target: string, title: string, subtitle: string | null) {
    const photos = photosOf(target);
    const sectionUploading = uploading?.target === target ? uploading : null;
    const sectionPending = pending?.target === target ? pending : null;
    return (
      <section
        key={target}
        className={cn(
          "rounded-xl border bg-card p-3 transition-colors sm:p-4",
          dragTarget === target ? "border-ring bg-accent/30" : "border-border",
        )}
        onDragOver={(e) => {
          if (uploading) return;
          e.preventDefault();
          setDragTarget(target);
        }}
        onDragLeave={() => setDragTarget((cur) => (cur === target ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          setDragTarget(null);
          if (!uploading) void stageFiles(target, e.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-foreground">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[subtitle, `${photos.length} 張`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={uploading != null}
            onClick={() => pick(target)}
          >
            {sectionUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {sectionUploading ? `上傳中 ${sectionUploading.done}/${sectionUploading.total}` : "上傳照片"}
          </Button>
        </div>

        {sectionPending ? (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
            <p className="break-words text-sm text-foreground">
              已選 {sectionPending.files.length} 張：
              <span className="text-muted-foreground">
                {sectionPending.files
                  .slice(0, 3)
                  .map((f) => f.name)
                  .join("、")}
                {sectionPending.files.length > 3 ? ` 等` : ""}
              </span>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex w-full max-w-[12rem] flex-col gap-1 text-xs text-muted-foreground">
                完工日期
                <input
                  type="date"
                  value={sectionPending.takenOn}
                  onChange={(e) => setPending({ ...sectionPending, takenOn: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </label>
              <Button type="button" onClick={() => void uploadPending()}>
                上傳 {sectionPending.files.length} 張
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                取消
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {sectionPending.fromExif ? "已依照片的拍攝日期帶入，可修改" : "照片沒有拍攝日期，預設為今天，可修改"}
            </p>
          </div>
        ) : null}

        <div className="mt-3">
          {photos.length > 0 ? (
            renderGrid(photos)
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              尚未上傳。點「上傳照片」可一次選多張，電腦上也可以把照片拖曳到這裡。
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          void stageFiles(pickTargetRef.current, e.target.files);
          e.target.value = "";
        }}
      />
      {items.map((it) => renderSection(it.id, it.label, it.stage ? `工序：${it.stage}` : null))}
      {renderSection(ORDER_TARGET, "整張訂單（合照）", null)}
      {orphanPhotos.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <p className="text-sm font-medium text-foreground">已移除品項的照片</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            品項已從訂單移除，照片仍保留 · {orphanPhotos.length} 張
          </p>
          <div className="mt-3">{renderGrid(orphanPhotos)}</div>
        </section>
      ) : null}

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="刪除這張照片？"
        description="照片會從訂單履歷移除。"
        confirmLabel="刪除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
