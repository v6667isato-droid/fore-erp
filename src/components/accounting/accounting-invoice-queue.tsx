"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Camera, FileText, FolderUp, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { compressInvoiceFileForStorage } from "@/lib/invoice-file";
import { fixRocDate } from "@/lib/invoice-scan";
import {
  fetchInvoiceQueue,
  normalizeInvoiceNumber,
  recognizeAccountingInvoice,
  recognizeAccountingInvoiceFromUrl,
  type AccountingInvoiceRow,
} from "@/lib/accounting-invoice";
import { AccountingInvoiceReviewDialog } from "@/components/accounting/accounting-invoice-review-dialog";
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

export interface AccountingInvoiceQueueProps {
  /** 審核存檔完成後（需刷新已存檔發票清單） */
  onConfirmed: () => void;
}

export function AccountingInvoiceQueue({ onConfirmed }: AccountingInvoiceQueueProps) {
  const [rows, setRows] = useState<AccountingInvoiceRow[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  /** 正在跑辨識的發票 id（DB 裡仍是 pending，前端顯示辨識中） */
  const [recognizingIds, setRecognizingIds] = useState<Set<string>>(() => new Set());
  const [reviewRow, setReviewRow] = useState<AccountingInvoiceRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccountingInvoiceRow | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setRows(await fetchInvoiceQueue());
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
    try {
      const { blob, ext } = await compressInvoiceFileForStorage(file);
      const mediaType = blob.type || file.type;
      const path = `inbox/${newId()}.${ext}`;
      const { data: up, error: upErr } = await supabase.storage
        .from("accounting-invoices")
        .upload(path, blob, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from("accounting-invoices").getPublicUrl(up.path);

      const { data: row, error: insErr } = await supabase
        .from("accounting_invoices")
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
      const invoiceId = (row as { id: string }).id;
      await refresh();

      // 背景辨識（不阻擋下一張上傳）
      markRecognizing(invoiceId, true);
      void recognizeAccountingInvoice(invoiceId, blob, mediaType).then(async (outcome) => {
        markRecognizing(invoiceId, false);
        if (!outcome.ok && outcome.notConfigured) {
          toast.warning("尚未設定 AI key，發票已入佇列，審核時需手動輸入");
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

  async function retryRecognition(row: AccountingInvoiceRow) {
    markRecognizing(row.id, true);
    const outcome = await recognizeAccountingInvoiceFromUrl(row);
    markRecognizing(row.id, false);
    if (!outcome.ok) toast.error(outcome.error);
    await refresh();
  }

  async function performDelete() {
    const row = deleteTarget;
    setDeleteTarget(null);
    if (!row) return;
    const { error } = await supabase
      .from("accounting_invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    await supabase.storage.from("accounting-invoices").remove([row.file_path]);
    toast.success("已刪除該張發票");
    await refresh();
  }

  function rowSummary(row: AccountingInvoiceRow): string {
    const r = row.recognized;
    if (!r) return row.file_name || "（未辨識）";
    const parts = [
      r.invoice_number ? normalizeInvoiceNumber(r.invoice_number) : "號碼未辨識",
      r.seller_name?.trim() || "賣方未辨識",
      fixRocDate(r.invoice_date) ?? "日期未辨識",
    ];
    if (r.amount_inc_tax != null) parts.push(`含稅 $${r.amount_inc_tax.toLocaleString()}`);
    else if (r.amount_ex_tax != null) parts.push(`未稅 $${r.amount_ex_tax.toLocaleString()}`);
    return parts.join("｜");
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">發票佇列</p>
          {rows.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {rows.length} 張待處理
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
            aria-label="開啟相機拍攝發票"
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />
          <input
            ref={filesInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            aria-label="選擇發票檔案"
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

      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          沒有待處理的發票。可連續拍照或多選檔案上傳，AI 會自動辨識發票號碼與金額；之後有空再回來逐張審核存檔。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const inFlight = recognizingIds.has(row.id);
            const badge = STATUS_BADGE[inFlight ? "recognizing" : row.status] ?? STATUS_BADGE.pending;
            const isPdf = (row.media_type ?? "") === "application/pdf" || row.file_path.endsWith(".pdf");
            const reviewable = !inFlight && (row.status === "ready" || row.status === "failed" || row.status === "pending");
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <a
                  href={row.file_url}
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
                      src={row.file_url}
                      alt="發票縮圖"
                      className="h-12 w-12 rounded-md border border-border object-cover"
                    />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-px text-[10px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="truncate text-sm text-foreground">{rowSummary(row)}</span>
                  </div>
                  {row.status === "failed" && row.error && (
                    <p className="mt-0.5 truncate text-xs text-destructive">{row.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {(row.status === "failed" || row.status === "pending") && !inFlight && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="重新辨識"
                      onClick={() => void retryRecognition(row)}
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
                      setReviewRow(row);
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
                    onClick={() => setDeleteTarget(row)}
                    aria-label="刪除此張發票"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AccountingInvoiceReviewDialog
        invoice={reviewRow}
        open={reviewOpen}
        onOpenChange={(o) => {
          setReviewOpen(o);
          if (!o) {
            setReviewRow(null);
            void refresh();
          }
        }}
        onSaved={() => {
          void refresh();
          onConfirmed();
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="是否刪除此張發票？"
        description={
          deleteTarget ? (
            <>
              <p className="font-medium text-foreground">{rowSummary(deleteTarget)}</p>
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
