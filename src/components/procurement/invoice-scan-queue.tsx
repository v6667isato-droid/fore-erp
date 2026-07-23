"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Camera, FileText, FolderUp, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { compressInvoiceFileForStorage } from "@/lib/invoice-file";
import {
  fetchPendingScans,
  fixRocDate,
  recognizeScan,
  recognizeScanFromUrl,
  type InvoiceScanRow,
} from "@/lib/invoice-scan";
import { InvoiceReviewDialog } from "@/components/procurement/invoice-review-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "待辨識", className: "border-border text-muted-foreground" },
  recognizing: { label: "AI 辨識中…", className: "border-sky-500/50 text-sky-700 dark:text-sky-400 animate-pulse" },
  ready: { label: "待審核", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  failed: { label: "辨識失敗", className: "border-destructive/50 text-destructive" },
};

export interface InvoiceScanQueueProps {
  /** 審核建檔完成後（需刷新採購清單） */
  onArchived: () => void;
}

export function InvoiceScanQueue({ onArchived }: InvoiceScanQueueProps) {
  const [scans, setScans] = useState<InvoiceScanRow[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  /** 正在跑辨識的 scan id（DB 裡仍是 pending，前端顯示辨識中） */
  const [recognizingIds, setRecognizingIds] = useState<Set<string>>(() => new Set());
  const [reviewScan, setReviewScan] = useState<InvoiceScanRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceScanRow | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setScans(await fetchPendingScans());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function markRecognizing(id: string, on: boolean) {
    setRecognizingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** 單張：壓縮 → 上傳 inbox → 建佇列紀錄 → 背景辨識 */
  async function processFile(file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error(`「${file.name}」不是圖片或 PDF，已略過`);
      return;
    }
    setUploadingCount((n) => n + 1);
    let scanId: string | null = null;
    try {
      const { blob, ext } = await compressInvoiceFileForStorage(file);
      const mediaType = blob.type || file.type;
      const path = `inbox/${newId()}.${ext}`;
      const { data: up, error: upErr } = await supabase.storage
        .from("purchase-invoices")
        .upload(path, blob, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from("purchase-invoices").getPublicUrl(up.path);

      const { data: row, error: insErr } = await supabase
        .from("invoice_scans")
        .insert({
          file_path: up.path,
          file_url: publicUrl,
          file_name: file.name,
          media_type: mediaType,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !row) throw insErr ?? new Error("佇列紀錄建立失敗");
      scanId = (row as { id: string }).id;
      await refresh();

      // 背景辨識（不阻擋下一張上傳）
      markRecognizing(scanId, true);
      void recognizeScan(scanId, blob, mediaType).then(async (outcome) => {
        markRecognizing(scanId!, false);
        if (!outcome.ok && outcome.notConfigured) {
          toast.warning("尚未設定 AI key，照片已入佇列，審核時需手動輸入");
        }
        await refresh();
      });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : `「${file.name}」上傳失敗`);
    } finally {
      setUploadingCount((n) => n - 1);
    }
  }

  async function handleFilesSelected(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    for (const f of files) {
      await processFile(f);
    }
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (filesInputRef.current) filesInputRef.current.value = "";
  }

  async function retryRecognition(scan: InvoiceScanRow) {
    markRecognizing(scan.id, true);
    const outcome = await recognizeScanFromUrl(scan);
    markRecognizing(scan.id, false);
    if (!outcome.ok) toast.error(outcome.error);
    await refresh();
  }

  async function performDelete() {
    const scan = deleteTarget;
    setDeleteTarget(null);
    if (!scan) return;
    const { error } = await supabase
      .from("invoice_scans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", scan.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    await supabase.storage.from("purchase-invoices").remove([scan.file_path]);
    toast.success("已刪除該張請款單");
    await refresh();
  }

  /** 審核 dialog 建檔／略過後帶入下一張可審核的請款單；沒有下一張時回傳 false（dialog 會關閉） */
  function advanceToNextReviewable(): boolean {
    const currentId = reviewScan?.id;
    const reviewable = scans.filter(
      (s) =>
        s.id !== currentId &&
        !recognizingIds.has(s.id) &&
        (s.status === "ready" || s.status === "failed" || s.status === "pending"),
    );
    if (reviewable.length === 0) return false;
    const idx = currentId ? scans.findIndex((s) => s.id === currentId) : -1;
    const next = reviewable.find((s) => scans.indexOf(s) > idx) ?? reviewable[0];
    setReviewScan(next);
    return true;
  }

  function scanSummary(scan: InvoiceScanRow): string {
    const r = scan.recognized;
    if (!r) return scan.file_name || "（未辨識）";
    const parts = [
      r.vendor_name?.trim() || "廠商未辨識",
      fixRocDate(r.invoice_date) ?? "日期未辨識",
      `${r.items?.length ?? 0} 項`,
    ];
    if (r.total_amount_ex_tax != null) parts.push(`未稅 $${r.total_amount_ex_tax.toLocaleString()}`);
    else if (r.total_amount_inc_tax != null) parts.push(`含稅 $${r.total_amount_inc_tax.toLocaleString()}`);
    return parts.join("｜");
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">請款單佇列</p>
          {scans.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {scans.length} 張待處理
            </span>
          )}
          {uploadingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              上傳中 {uploadingCount} 張…
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="開啟相機拍攝請款單"
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />
          <input
            ref={filesInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            aria-label="選擇請款單檔案"
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5 mr-1" />
            拍照上傳
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => filesInputRef.current?.click()}
          >
            <FolderUp className="h-3.5 w-3.5 mr-1" />
            選擇檔案（可多選）
          </Button>
        </div>
      </div>

      {scans.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          沒有待處理的請款單。可連續拍照上傳，AI 會自動辨識；之後有空再回來逐張審核建檔。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {scans.map((scan) => {
            const inFlight = recognizingIds.has(scan.id);
            const badge = STATUS_BADGE[inFlight ? "recognizing" : scan.status] ?? STATUS_BADGE.pending;
            const isPdf = (scan.media_type ?? "") === "application/pdf" || scan.file_path.endsWith(".pdf");
            const reviewable = !inFlight && (scan.status === "ready" || scan.status === "failed" || scan.status === "pending");
            return (
              <li key={scan.id} className="flex items-center gap-3 px-4 py-2.5">
                <a
                  href={scan.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  title="開啟原稿"
                >
                  {isPdf ? (
                    <span className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted/40">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase 縮圖
                    <img
                      src={scan.file_url}
                      alt="請款單縮圖"
                      className="h-12 w-12 rounded-md border border-border object-cover"
                    />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-px text-[10px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="truncate text-sm text-foreground">{scanSummary(scan)}</span>
                  </div>
                  {scan.status === "failed" && scan.error && (
                    <p className="mt-0.5 truncate text-xs text-destructive">{scan.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {(scan.status === "failed" || scan.status === "pending") && !inFlight && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="重新辨識"
                      onClick={() => void retryRecognition(scan)}
                      aria-label="重新辨識"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={!reviewable}
                    onClick={() => {
                      setReviewScan(scan);
                      setReviewOpen(true);
                    }}
                  >
                    人工審核
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    title="刪除"
                    onClick={() => setDeleteTarget(scan)}
                    aria-label="刪除此張請款單"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <InvoiceReviewDialog
        scan={reviewScan}
        open={reviewOpen}
        onOpenChange={(o) => {
          setReviewOpen(o);
          if (!o) {
            setReviewScan(null);
            void refresh();
          }
        }}
        onArchived={() => {
          void refresh();
          onArchived();
        }}
        onAdvance={advanceToNextReviewable}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="是否刪除此張請款單？"
        description={
          deleteTarget ? (
            <>
              <p className="font-medium text-foreground">{scanSummary(deleteTarget)}</p>
              <p className="mt-2 text-muted-foreground">照片與辨識結果將一併刪除，此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
