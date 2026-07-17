"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fixRocDate } from "@/lib/invoice-scan";
import {
  accountingArchiveFileName,
  accountingArchivePath,
  DEDUCTION_CODE_OPTIONS,
  FORMAT_CODE_OPTIONS,
  isValidInvoiceNumber,
  normalizeInvoiceNumber,
  TAX_TYPE_OPTIONS,
  type AccountingInvoiceRow,
  type InvoiceFormatCode,
} from "@/lib/accounting-invoice";
import { fetchPoOptions, suggestPos, type PoOption } from "@/lib/accounting-po-match";
import { displayPoNumber } from "@/lib/purchase-order";

/** 從 Supabase 錯誤物件盡量取出可讀訊息 */
function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

export interface AccountingInvoiceReviewDialogProps {
  /** 待審核或編輯的發票（含照片與辨識結果）；null 時不顯示 */
  invoice: AccountingInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 存檔完成 */
  onSaved: () => void;
}

export function AccountingInvoiceReviewDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
}: AccountingInvoiceReviewDialogProps) {
  const isEdit = invoice?.status === "confirmed";
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [poOptions, setPoOptions] = useState<PoOption[]>([]);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerTaxId, setSellerTaxId] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [amountExTax, setAmountExTax] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [amountIncTax, setAmountIncTax] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [formatCode, setFormatCode] = useState<InvoiceFormatCode>("25");
  const [deductionCode, setDeductionCode] = useState(1);
  const [taxType, setTaxType] = useState(1);

  // 開啟時載入採購單選項並預填表單
  useEffect(() => {
    if (!open || !invoice) return;
    setError(null);
    setSaving(false);
    setDuplicateOf(null);
    void fetchPoOptions().then(setPoOptions);
    // 報稅欄位（新資料為 DB 預設：25／扣抵 1／應稅）
    setFormatCode(invoice.format_code);
    setDeductionCode(invoice.deduction_code);
    setTaxType(invoice.tax_type);

    if (invoice.status === "confirmed") {
      // 編輯模式：以已存檔欄位為準
      setInvoiceNumber(invoice.invoice_number ?? "");
      setInvoiceDate(invoice.invoice_date ?? "");
      setSellerName(invoice.seller_name ?? "");
      setSellerTaxId(invoice.seller_tax_id ?? "");
      setBuyerTaxId(invoice.buyer_tax_id ?? "");
      setAmountExTax(invoice.amount_ex_tax != null ? String(invoice.amount_ex_tax) : "");
      setTaxAmount(invoice.tax_amount != null ? String(invoice.tax_amount) : "");
      setAmountIncTax(invoice.amount_inc_tax != null ? String(invoice.amount_inc_tax) : "");
      setPurchaseOrderId(invoice.purchase_order_id ?? "");
      setNotes(invoice.notes ?? "");
      return;
    }

    const r = invoice.recognized;
    setInvoiceNumber(r?.invoice_number ? normalizeInvoiceNumber(r.invoice_number) : "");
    setInvoiceDate(fixRocDate(r?.invoice_date) ?? "");
    setSellerName(r?.seller_name?.trim() ?? "");
    setSellerTaxId(r?.seller_tax_id?.trim() ?? "");
    setBuyerTaxId(r?.buyer_tax_id?.trim() ?? "");
    setAmountExTax(r?.amount_ex_tax != null ? String(r.amount_ex_tax) : "");
    setTaxAmount(r?.tax_amount != null ? String(r.tax_amount) : "");
    // 發票未列含稅總計時，用未稅＋稅額補上
    const inc =
      r?.amount_inc_tax ??
      (r?.amount_ex_tax != null && r?.tax_amount != null ? r.amount_ex_tax + r.tax_amount : null);
    setAmountIncTax(inc != null ? String(inc) : "");
    setPurchaseOrderId(invoice.purchase_order_id ?? "");
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟時預填一次
  }, [open, invoice?.id]);

  // 發票號碼重複檢查（已存檔的其他發票）
  useEffect(() => {
    if (!open || !invoice) return;
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    if (!isValidInvoiceNumber(normalized)) {
      setDuplicateOf(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("accounting_invoices")
        .select("id, seller_name, invoice_date")
        .eq("invoice_number", normalized)
        .eq("status", "confirmed")
        .is("deleted_at", null)
        .neq("id", invoice.id)
        .limit(1);
      if (cancelled) return;
      const hit = (data ?? [])[0] as { seller_name: string | null; invoice_date: string | null } | undefined;
      setDuplicateOf(hit ? `${hit.seller_name ?? "（無賣方）"}／${hit.invoice_date ?? "（無日期）"}` : null);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, invoice, invoiceNumber]);

  const incTaxNum = parseAmount(amountIncTax);
  const exTaxNum = parseAmount(amountExTax);
  const taxNum = parseAmount(taxAmount);

  /** 三個金額都有時檢查未稅＋稅額＝含稅（容差 1 元） */
  const amountMismatch =
    incTaxNum != null && exTaxNum != null && taxNum != null && Math.abs(exTaxNum + taxNum - incTaxNum) > 1;

  /** 依含稅金額以 5% 反推未稅與稅額 */
  function fillFromIncTax() {
    if (incTaxNum == null || incTaxNum <= 0) return;
    const ex = Math.round(incTaxNum / 1.05);
    setAmountExTax(String(ex));
    setTaxAmount(String(Math.round((incTaxNum - ex) * 100) / 100));
  }

  /** 由未稅＋稅額（無稅額則以 5% 計）算含稅 */
  function fillFromExTax() {
    if (exTaxNum == null || exTaxNum <= 0) return;
    const tax = taxNum ?? Math.round(exTaxNum * 0.05);
    if (taxNum == null) setTaxAmount(String(tax));
    setAmountIncTax(String(Math.round((exTaxNum + tax) * 100) / 100));
  }

  /** 切到二聯式（22）：發票只印含稅總計，依 5% 內含稅自動回推未稅與稅額 */
  function onFormatCodeChange(code: InvoiceFormatCode) {
    setFormatCode(code);
    if (code === "22" && incTaxNum != null && incTaxNum > 0) {
      const ex = Math.round(incTaxNum / 1.05);
      setAmountExTax(String(ex));
      setTaxAmount(String(Math.round(incTaxNum) - ex));
    }
  }

  /** 課稅別為零稅率／免稅時，扣抵代號依規定只能選 3（費用）或 4（固定資產） */
  function onTaxTypeChange(next: number) {
    setTaxType(next);
    if (next !== 1 && deductionCode !== 3 && deductionCode !== 4) {
      setDeductionCode(deductionCode === 2 ? 4 : 3);
    }
  }

  const suggestions = useMemo(
    () =>
      suggestPos(
        {
          sellerName: sellerName.trim(),
          invoiceDate: invoiceDate.trim(),
          amountIncTax: incTaxNum,
          amountExTax: exTaxNum,
        },
        poOptions,
      ),
    [sellerName, invoiceDate, incTaxNum, exTaxNum, poOptions],
  );

  const selectedPo = useMemo(
    () => poOptions.find((p) => p.id === purchaseOrderId) ?? null,
    [poOptions, purchaseOrderId],
  );

  function poLabel(po: PoOption): string {
    return `${displayPoNumber(po.po_number)}｜${po.purchase_date}｜${po.vendor_name ?? "未指定廠商"}｜含稅 $${po.total_inc_tax.toLocaleString()}`;
  }

  async function onConfirm() {
    if (!invoice) return;
    setError(null);
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    if (!invoiceNumber.trim()) {
      setError("請輸入發票號碼");
      return;
    }
    if (!isValidInvoiceNumber(normalized)) {
      setError("發票號碼格式應為 2 碼英文＋8 碼數字（如 AB-12345678）");
      return;
    }
    if (incTaxNum == null || incTaxNum <= 0) {
      setError("請輸入含稅金額");
      return;
    }
    if (duplicateOf) {
      setError(`發票號碼 ${normalized} 已存檔過（${duplicateOf}），請確認是否重複上傳`);
      return;
    }

    setSaving(true);
    try {
      // 照片歸檔改名：archive/{YYYY-MM}/{發票號碼}_{日期}.{ext}
      // 首次存檔從 inbox 搬入；編輯後號碼或日期變動時也會跟著改名搬移
      const ext = invoice.file_path.split(".").pop()?.toLowerCase() || "jpg";
      let finalPath = invoice.file_path;
      let finalUrl = invoice.file_url;
      let finalFileName = invoice.file_name;
      const targetPath = accountingArchivePath(normalized, invoiceDate.trim(), invoice.id, ext);
      if (invoice.file_path !== targetPath) {
        const { error: moveErr } = await supabase.storage
          .from("accounting-invoices")
          .move(invoice.file_path, targetPath);
        if (!moveErr) {
          finalPath = targetPath;
          finalUrl = supabase.storage.from("accounting-invoices").getPublicUrl(targetPath).data.publicUrl;
          finalFileName = accountingArchiveFileName(normalized, invoiceDate.trim(), ext);
        } else {
          console.error("發票歸檔搬移失敗（保留原路徑）:", moveErr.message);
        }
      }

      const { error: updErr } = await supabase
        .from("accounting_invoices")
        .update({
          status: "confirmed",
          invoice_number: normalized,
          invoice_date: invoiceDate.trim() || null,
          seller_name: sellerName.trim() || null,
          seller_tax_id: sellerTaxId.trim() || null,
          buyer_tax_id: buyerTaxId.trim() || null,
          amount_ex_tax: exTaxNum,
          tax_amount: taxNum,
          amount_inc_tax: incTaxNum,
          format_code: formatCode,
          deduction_code: deductionCode,
          tax_type: taxType,
          purchase_order_id: purchaseOrderId || null,
          notes: notes.trim() || null,
          file_path: finalPath,
          file_url: finalUrl,
          file_name: finalFileName,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", invoice.id);
      if (updErr) {
        // DB 更新失敗時把已搬移的檔案搬回原路徑，避免紀錄指向不存在的檔案
        if (finalPath !== invoice.file_path) {
          await supabase.storage.from("accounting-invoices").move(finalPath, invoice.file_path);
        }
        if (/duplicate key|unique/i.test(updErr.message)) {
          throw new Error(`發票號碼 ${normalized} 已存檔過，請確認是否重複上傳`);
        }
        throw updErr;
      }

      toast.success(
        purchaseOrderId && selectedPo
          ? `發票 ${normalized} 已存檔並對應採購單 ${displayPoNumber(selectedPo.po_number)}`
          : `發票 ${normalized} 已存檔（未對應採購單）`,
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error(err);
      const message = errText(err, "存檔失敗，請稍後再試");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  /** 刪除此張發票：佇列中的連檔案一併刪除；已存檔的保留歸檔照片（與清單刪除行為一致） */
  async function performDelete() {
    if (!invoice) return;
    setDeleting(true);
    try {
      const { error: delErr } = await supabase
        .from("accounting_invoices")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", invoice.id);
      if (delErr) throw delErr;
      if (!isEdit) {
        await supabase.storage.from("accounting-invoices").remove([invoice.file_path]);
      }
      toast.success(
        isEdit
          ? `已刪除發票 ${invoice.invoice_number ?? ""}（照片仍保留於歸檔）`
          : "已刪除該張發票",
      );
      setDeleteOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error(errText(err, "刪除失敗，請稍後再試"));
    } finally {
      setDeleting(false);
    }
  }

  const isPdf =
    (invoice?.media_type ?? "") === "application/pdf" || (invoice?.file_path ?? "").endsWith(".pdf");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="accounting-invoice-review-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? "檢視／編輯發票" : "人工審核存檔"}
              </Dialog.Title>
              <p id="accounting-invoice-review-desc" className="mt-1 text-sm text-muted-foreground">
                對照左側發票照片確認發票號碼與金額，並對應到採購單；確認後照片會依賣方／日期歸檔
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* 左：發票照片 */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <div className="rounded-lg border border-border bg-muted/20 p-2">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-foreground">發票原稿</span>
                  {invoice && (
                    <a
                      href={invoice.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      新分頁開啟
                    </a>
                  )}
                </div>
                {invoice ? (
                  isPdf ? (
                    <iframe
                      src={invoice.file_url}
                      title="發票 PDF"
                      className="h-[50vh] w-full rounded-md border-0 bg-white lg:h-[72vh]"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase 外部圖，僅審核時載入
                    <img
                      src={invoice.file_url}
                      alt="發票照片"
                      className="max-h-[50vh] w-full rounded-md object-contain lg:max-h-[72vh]"
                    />
                  )
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">無照片</p>
                )}
              </div>
            </div>

            {/* 右：審核表單 */}
            <div className="space-y-4">
              {invoice?.status === "failed" && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                  這張的 AI 辨識失敗（{invoice.error || "原因不明"}），以下請對照照片手動輸入。
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="acct-invoice-number" className="text-xs text-muted-foreground">
                    發票號碼 *
                  </label>
                  <input
                    id="acct-invoice-number"
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    onBlur={() => setInvoiceNumber((v) => (v.trim() ? normalizeInvoiceNumber(v) : v))}
                    placeholder="AB-12345678"
                    autoComplete="off"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm uppercase text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="acct-invoice-date" className="text-xs text-muted-foreground">
                    發票日期
                  </label>
                  <input
                    id="acct-invoice-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {duplicateOf && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  這個發票號碼已存檔過（{duplicateOf}），可能是重複上傳；若確定重複，點下方「刪除此張」即可。
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <label htmlFor="acct-seller-name" className="text-xs text-muted-foreground">
                    賣方名稱
                  </label>
                  <input
                    id="acct-seller-name"
                    type="text"
                    value={sellerName}
                    onChange={(e) => setSellerName(e.target.value)}
                    autoComplete="off"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="acct-seller-tax-id" className="text-xs text-muted-foreground">
                    賣方統編
                  </label>
                  <input
                    id="acct-seller-tax-id"
                    type="text"
                    inputMode="numeric"
                    value={sellerTaxId}
                    onChange={(e) => setSellerTaxId(e.target.value)}
                    autoComplete="off"
                    placeholder="8 碼數字"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="acct-buyer-tax-id" className="text-xs text-muted-foreground">
                    買方統編
                  </label>
                  <input
                    id="acct-buyer-tax-id"
                    type="text"
                    inputMode="numeric"
                    value={buyerTaxId}
                    onChange={(e) => setBuyerTaxId(e.target.value)}
                    autoComplete="off"
                    placeholder="無則留空"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-amount-ex" className="text-xs text-muted-foreground">
                      未稅金額
                    </label>
                    <input
                      id="acct-amount-ex"
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountExTax}
                      onChange={(e) => setAmountExTax(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-tax-amount" className="text-xs text-muted-foreground">
                      稅額
                    </label>
                    <input
                      id="acct-tax-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={taxAmount}
                      onChange={(e) => setTaxAmount(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-amount-inc" className="text-xs text-muted-foreground">
                      含稅金額 *
                    </label>
                    <input
                      id="acct-amount-inc"
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountIncTax}
                      onChange={(e) => setAmountIncTax(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                      required
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {incTaxNum != null && incTaxNum > 0 && (exTaxNum == null || taxNum == null) && (
                    <Button type="button" variant="outline" className="h-7 px-2.5 text-xs" onClick={fillFromIncTax}>
                      依含稅金額以 5% 推算未稅與稅額
                    </Button>
                  )}
                  {incTaxNum == null && exTaxNum != null && exTaxNum > 0 && (
                    <Button type="button" variant="outline" className="h-7 px-2.5 text-xs" onClick={fillFromExTax}>
                      由未稅＋稅額算含稅
                    </Button>
                  )}
                  {amountMismatch && (
                    <span className="text-xs text-amber-700 dark:text-amber-500">
                      未稅＋稅額（{((exTaxNum ?? 0) + (taxNum ?? 0)).toLocaleString()}）與含稅金額不符，請對照發票確認
                    </span>
                  )}
                </div>
              </div>

              {/* 報稅申報欄位（媒體檔用） */}
              <div className="space-y-2 rounded-lg border border-border bg-muted/15 p-3">
                <p className="text-xs font-medium text-foreground">報稅申報欄位</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-format-code" className="text-xs text-muted-foreground">
                      格式代號
                    </label>
                    <select
                      id="acct-format-code"
                      value={formatCode}
                      onChange={(e) => onFormatCodeChange(e.target.value as InvoiceFormatCode)}
                      className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {FORMAT_CODE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-tax-type" className="text-xs text-muted-foreground">
                      課稅別
                    </label>
                    <select
                      id="acct-tax-type"
                      value={taxType}
                      onChange={(e) => onTaxTypeChange(Number(e.target.value))}
                      className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {TAX_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="acct-deduction-code" className="text-xs text-muted-foreground">
                      扣抵代號
                    </label>
                    <select
                      id="acct-deduction-code"
                      value={deductionCode}
                      onChange={(e) => setDeductionCode(Number(e.target.value))}
                      className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {DEDUCTION_CODE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} disabled={taxType !== 1 && (o.value === 1 || o.value === 2)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {formatCode === "22" && (
                  <p className="text-[11px] text-muted-foreground">
                    二聯式收銀機發票為內含稅：切換時已依含稅金額 ÷ 1.05 回推未稅與稅額，請對照發票確認。
                  </p>
                )}
              </div>

              {/* 採購單對應 */}
              <div className="space-y-2 rounded-lg border border-border bg-muted/15 p-3">
                <p className="text-xs font-medium text-foreground">對應採購單</p>
                {suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">依賣方／金額／日期自動找到的候選（點擊帶入）：</p>
                    <div className="flex flex-col gap-1.5">
                      {suggestions.map(({ po, amountExact }) => (
                        <button
                          key={po.id}
                          type="button"
                          onClick={() => setPurchaseOrderId(po.id)}
                          className={`flex flex-wrap items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                            purchaseOrderId === po.id
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background text-foreground hover:border-primary/50"
                          }`}
                        >
                          <span className="font-medium tabular-nums">{displayPoNumber(po.po_number)}</span>
                          <span className="text-muted-foreground">{po.purchase_date}</span>
                          <span>{po.vendor_name ?? "未指定廠商"}</span>
                          <span className="tabular-nums">含稅 ${po.total_inc_tax.toLocaleString()}</span>
                          {amountExact && (
                            <span className="rounded border border-emerald-500/50 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              金額相符
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <select
                  value={purchaseOrderId}
                  onChange={(e) => setPurchaseOrderId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="選擇對應的採購單"
                >
                  <option value="">（不對應採購單）</option>
                  {poOptions.map((po) => (
                    <option key={po.id} value={po.id}>
                      {poLabel(po)}
                    </option>
                  ))}
                </select>
                {selectedPo && incTaxNum != null && (
                  <p
                    className={
                      Math.abs(incTaxNum - selectedPo.total_inc_tax) <= 1
                        ? "text-xs text-muted-foreground"
                        : "text-xs text-amber-700 dark:text-amber-500"
                    }
                  >
                    發票含稅 ${incTaxNum.toLocaleString()} vs 採購單含稅 $
                    {selectedPo.total_inc_tax.toLocaleString()}
                    {Math.abs(incTaxNum - selectedPo.total_inc_tax) <= 1
                      ? "（金額相符）"
                      : "（金額不同：可能是部分請款或多張發票對一張採購單，確認無誤即可存檔）"}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="acct-notes" className="text-xs text-muted-foreground">
                  備註
                </label>
                <input
                  id="acct-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  autoComplete="off"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && (
                <p
                  className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={saving || deleting}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  刪除此張
                </Button>
                <div className="flex flex-wrap justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button type="button" variant="ghost" disabled={saving || deleting}>
                      {isEdit ? "取消" : "先擱著（保留在佇列）"}
                    </Button>
                  </Dialog.Close>
                  <Button type="button" onClick={onConfirm} disabled={saving || deleting}>
                    {saving ? "存檔中…" : isEdit ? "儲存變更" : "確認存檔"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => !deleting && setDeleteOpen(o)}
        title="是否刪除此張發票？"
        description={
          invoice ? (
            <>
              <p className="font-medium text-foreground">
                {(invoiceNumber.trim() || invoice.file_name) ?? "（未命名）"}
                {sellerName.trim() ? `｜${sellerName.trim()}` : ""}
                {incTaxNum != null ? `｜含稅 $${incTaxNum.toLocaleString()}` : ""}
              </p>
              <p className="mt-2 text-muted-foreground">
                {isEdit
                  ? "發票紀錄將自清單移除（照片仍保留於歸檔資料夾）。"
                  : "照片與辨識結果將一併刪除，此操作無法復原。"}
              </p>
            </>
          ) : null
        }
        confirmLabel={deleting ? "刪除中…" : "確定刪除"}
        onConfirm={performDelete}
        destructive
      />
    </Dialog.Root>
  );
}
