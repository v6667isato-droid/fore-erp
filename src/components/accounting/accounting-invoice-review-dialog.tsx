"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { amegoBanQuery } from "@/lib/sales-invoice";
import type { EInvoiceQrData } from "@/lib/e-invoice-qr";
import { decodeEInvoiceQrFromUrl } from "@/lib/e-invoice-qr-decode";
import { auditInvoice, toStoredReviewChecks, type AuditCheckKey } from "@/lib/invoice-audit";
import type { Json } from "@/types/database.types";
import { displayPoNumber } from "@/lib/purchase-order";
import {
  InvoiceImageViewer,
  sanitizeCropBox,
  sanitizeFieldBox,
  type InvoiceCropBox,
} from "@/components/accounting/invoice-image-viewer";
import { FieldCropZoom } from "@/components/accounting/field-crop-zoom";

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

/** 表單欄位值的來源：qr=QR 解碼（ground truth）／ocr=AI 辨識／derived=推算／manual=人工輸入 */
type FieldSource = "qr" | "ocr" | "derived" | "manual";

type FieldKey =
  | "invoiceNumber"
  | "invoiceDate"
  | "sellerName"
  | "sellerTaxId"
  | "buyerTaxId"
  | "amountExTax"
  | "taxAmount"
  | "amountIncTax"
  | "formatCode";

type QrStatus = "idle" | "decoding" | "verified" | "failed" | "unsupported";

function SourceBadge({ source }: { source?: FieldSource }) {
  if (source === "qr")
    return (
      <span className="rounded border border-emerald-500/50 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
        QR ✓
      </span>
    );
  if (source === "ocr")
    return <span className="rounded border border-border px-1 py-px text-[10px] text-muted-foreground">OCR</span>;
  if (source === "derived")
    return <span className="rounded border border-border px-1 py-px text-[10px] text-muted-foreground">推算</span>;
  if (source === "manual")
    return (
      <span className="rounded border border-sky-500/50 px-1 py-px text-[10px] text-sky-700 dark:text-sky-400">
        人工
      </span>
    );
  return null;
}

export interface AccountingInvoiceReviewDialogProps {
  /** 待審核或編輯的發票（含照片與辨識結果）；null 時不顯示 */
  invoice: AccountingInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 存檔完成 */
  onSaved: () => void;
  /** 存檔／刪除／略過後呼叫：父層切到下一張待審核發票時回傳 true（dialog 保持開啟）；沒有下一張回傳 false */
  onAdvance?: () => boolean;
  /** 佇列進度（第 index 張／共 total 張），標題列顯示 */
  queueProgress?: { index: number; total: number } | null;
}

export function AccountingInvoiceReviewDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
  onAdvance,
  queueProgress,
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
  const [qrStatus, setQrStatus] = useState<QrStatus>("idle");
  const [qrData, setQrData] = useState<EInvoiceQrData | null>(null);
  const [fieldSources, setFieldSources] = useState<Partial<Record<FieldKey, FieldSource>>>({});
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** 目前 focus／hover 的欄位：照片高亮該欄位框＋欄位下方浮出放大裁切圖 */
  const [focusField, setFocusField] = useState<FieldKey | null>(null);
  const [hoverField, setHoverField] = useState<FieldKey | null>(null);
  const activeField = focusField ?? hoverField;

  // 開啟時載入採購單選項並預填表單
  useEffect(() => {
    if (!open || !invoice) return;
    setError(null);
    setSaving(false);
    setDuplicateOf(null);
    setQrData(null);
    setQrStatus("idle");
    setShowShortcuts(false);
    setFocusField(null);
    setHoverField(null);
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
      setFieldSources({});
      return;
    }

    const r = invoice.recognized;
    // AI 判斷的格式代號（25 電子發票、21 手開三聯、22 收銀機長條發票）優先於 DB 預設；
    // 收銀機二聯式不論有無買方統編一律 22，統編僅作資料保存
    if (r?.format_code === "21" || r?.format_code === "22" || r?.format_code === "25") {
      setFormatCode(r.format_code);
    }
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
    const src: Partial<Record<FieldKey, FieldSource>> = {};
    if (r?.invoice_number) src.invoiceNumber = "ocr";
    if (fixRocDate(r?.invoice_date)) src.invoiceDate = "ocr";
    if (r?.seller_name?.trim()) src.sellerName = "ocr";
    if (r?.seller_tax_id?.trim()) src.sellerTaxId = "ocr";
    if (r?.buyer_tax_id?.trim()) src.buyerTaxId = "ocr";
    if (r?.amount_ex_tax != null) src.amountExTax = "ocr";
    if (r?.tax_amount != null) src.taxAmount = "ocr";
    if (inc != null) src.amountIncTax = r?.amount_inc_tax != null ? "ocr" : "derived";
    if (r?.format_code === "21" || r?.format_code === "22" || r?.format_code === "25") src.formatCode = "ocr";
    setFieldSources(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟時預填一次
  }, [open, invoice?.id]);

  // 賣方統編確定（OCR/QR 帶入或人工修正）→ 以財政部登記名稱自動帶出賣方抬頭。
  // 官方名稱蓋過 OCR 從票面抄的店名（更標準）；人工輸入過的名稱不覆寫。
  const fieldSourcesRef = useRef(fieldSources);
  fieldSourcesRef.current = fieldSources;
  useEffect(() => {
    if (!open) return;
    const ban = sellerTaxId.trim();
    if (!/^\d{8}$/.test(ban)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await amegoBanQuery(ban);
      if (cancelled || !r.ok || !r.name) return;
      if (fieldSourcesRef.current.sellerName === "manual") return; // 人工輸入的不動
      setSellerName(r.name);
      setFieldSources((prev) => ({ ...prev, sellerName: "derived" }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, sellerTaxId]);

  // 照片載入時自動解碼電子發票 QR：解出的值為 ground truth，覆寫 OCR 預填
  useEffect(() => {
    if (!open || !invoice || invoice.status === "confirmed") return;
    let cancelled = false;
    setQrStatus("decoding");
    void decodeEInvoiceQrFromUrl(invoice.file_url, invoice.media_type).then((res) => {
      if (cancelled) return;
      if (res.status === "decoded") {
        const qr = res.data;
        setQrData(qr);
        setQrStatus("verified");
        // QR 解得出來的必為電子發票證明聯 → 格式代號 25
        setFormatCode("25");
        setInvoiceNumber(qr.invoice_number);
        setInvoiceDate(qr.invoice_date);
        setSellerTaxId(qr.seller_tax_id);
        if (qr.buyer_tax_id) setBuyerTaxId(qr.buyer_tax_id);
        setAmountIncTax(String(qr.amount_inc_tax));
        // B2C 證明聯的 QR 銷售額常直接等於總計（內含稅），只在確為未稅時帶入
        const exValid = qr.amount_ex_tax > 0 && qr.amount_ex_tax < qr.amount_inc_tax;
        if (exValid) {
          setAmountExTax(String(qr.amount_ex_tax));
          setTaxAmount(String(qr.amount_inc_tax - qr.amount_ex_tax));
        }
        setFieldSources((prev) => ({
          ...prev,
          invoiceNumber: "qr",
          invoiceDate: "qr",
          sellerTaxId: "qr",
          amountIncTax: "qr",
          formatCode: "qr",
          ...(qr.buyer_tax_id ? { buyerTaxId: "qr" as const } : {}),
          ...(exValid ? { amountExTax: "qr" as const, taxAmount: "qr" as const } : {}),
        }));
      } else if (res.status === "unsupported") {
        setQrStatus("unsupported");
      } else {
        setQrStatus("failed");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟／換張時解碼一次
  }, [open, invoice?.id]);

  // 未稅／稅額自動推算：含稅有值且未稅、稅額為空（或仍是推算值）時自動填入。
  // 人工輸入或 QR／OCR 帶入的欄位不覆寫；「推算」值會跟著含稅金額即時重算。
  useEffect(() => {
    if (!open || isEdit) return;
    const inc = parseAmount(amountIncTax);
    if (inc == null || inc <= 0) return;
    const exAuto = amountExTax.trim() === "" || fieldSources.amountExTax === "derived";
    const taxAuto = taxAmount.trim() === "" || fieldSources.taxAmount === "derived";
    if (!exAuto || !taxAuto) return;
    if (taxType === 1) {
      const ex = Math.round(inc / 1.05);
      const tax = Math.round((inc - ex) * 100) / 100;
      setAmountExTax(String(ex));
      setTaxAmount(String(tax));
      markDerived("amountExTax", "taxAmount");
    } else if (taxType === 2 || taxType === 3) {
      // 零稅率／免稅不推 5%：稅額 0、未稅＝含稅
      setAmountExTax(String(inc));
      setTaxAmount("0");
      markDerived("amountExTax", "taxAmount");
    }
  }, [open, isEdit, amountIncTax, amountExTax, taxAmount, taxType, fieldSources.amountExTax, fieldSources.taxAmount]);

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

  function markManual(key: FieldKey) {
    setFieldSources((prev) => (prev[key] === "manual" ? prev : { ...prev, [key]: "manual" }));
  }

  function markDerived(...keys: FieldKey[]) {
    setFieldSources((prev) => {
      if (keys.every((k) => prev[k] === "derived")) return prev;
      const next = { ...prev };
      for (const k of keys) next[k] = "derived";
      return next;
    });
  }

  /** 依含稅金額以 5% 反推未稅與稅額 */
  function fillFromIncTax() {
    if (incTaxNum == null || incTaxNum <= 0) return;
    const ex = Math.round(incTaxNum / 1.05);
    setAmountExTax(String(ex));
    setTaxAmount(String(Math.round((incTaxNum - ex) * 100) / 100));
    markDerived("amountExTax", "taxAmount");
  }

  /** 由未稅＋稅額（無稅額則以 5% 計）算含稅 */
  function fillFromExTax() {
    if (exTaxNum == null || exTaxNum <= 0) return;
    const tax = taxNum ?? Math.round(exTaxNum * 0.05);
    if (taxNum == null) {
      setTaxAmount(String(tax));
      markDerived("taxAmount", "amountIncTax");
    } else {
      markDerived("amountIncTax");
    }
    setAmountIncTax(String(Math.round((exTaxNum + tax) * 100) / 100));
  }

  /** 切到二聯式（22）：發票只印含稅總計，依 5% 內含稅自動回推未稅與稅額 */
  function onFormatCodeChange(code: InvoiceFormatCode) {
    setFormatCode(code);
    markManual("formatCode");
    if (code === "22" && incTaxNum != null && incTaxNum > 0) {
      const ex = Math.round(incTaxNum / 1.05);
      setAmountExTax(String(ex));
      setTaxAmount(String(Math.round(incTaxNum) - ex));
      markDerived("amountExTax", "taxAmount");
    }
  }

  /** OCR 辨識到的字軌期別（如「115年07-08月」）；舊資料或未印為 null */
  const auditPeriod = useMemo(() => {
    const r = invoice?.recognized;
    return r?.period_roc_year != null && r?.period_start_month != null && r?.period_end_month != null
      ? { rocYear: r.period_roc_year, startMonth: r.period_start_month, endMonth: r.period_end_month }
      : null;
  }, [invoice]);

  /** 勾稽：QR ground truth vs OCR vs 表單＋金額算式＋字軌期別，輸入變動即時重算 */
  const audit = useMemo(() => {
    const r = invoice?.recognized ?? null;
    return auditInvoice({
      qr: qrData,
      ocr: r
        ? {
            invoice_number: r.invoice_number,
            invoice_date: fixRocDate(r.invoice_date) ?? null,
            seller_tax_id: r.seller_tax_id,
            amount_ex_tax: r.amount_ex_tax,
            tax_amount: r.tax_amount,
            amount_inc_tax: r.amount_inc_tax,
          }
        : null,
      form: {
        invoiceNumber,
        invoiceDate,
        sellerTaxId,
        amountExTax: exTaxNum,
        taxAmount: taxNum,
        amountIncTax: incTaxNum,
        taxType,
      },
      period: auditPeriod,
    });
  }, [qrData, invoice, invoiceNumber, invoiceDate, sellerTaxId, exTaxNum, taxNum, incTaxNum, taxType, auditPeriod]);

  /** 欄位邊框：關聯勾稽項有警告→黃、有通過→綠、無法勾稽→預設 */
  function auditBorder(...keys: AuditCheckKey[]): string {
    if (isEdit) return "border-input";
    const related = audit.checks.filter((c) => keys.includes(c.key));
    if (related.some((c) => c.status === "warn")) return "border-amber-500/70";
    if (related.some((c) => c.status === "pass")) return "border-emerald-500/50";
    return "border-input";
  }

  function auditWarnDetail(key: AuditCheckKey): string | null {
    if (isEdit) return null;
    const c = audit.checks.find((x) => x.key === key);
    return c?.status === "warn" ? (c.detail ?? "不一致，請對照發票確認") : null;
  }

  /** 勾稽全過＋QR 已驗證：存檔按鈕視覺強調，暗示可快速通過 */
  const quickPass = !isEdit && audit.qrVerified && audit.warnCount === 0;

  /** AI 回傳的各欄位概略範圍（0–1000），欄位級高亮與放大裁切用；舊資料或 PDF 為空 */
  const fieldBoxMap = useMemo<Partial<Record<FieldKey, InvoiceCropBox>>>(() => {
    const fb = invoice?.recognized?.field_boxes;
    if (!fb) return {};
    const m: Partial<Record<FieldKey, InvoiceCropBox>> = {};
    const put = (k: FieldKey, v: unknown) => {
      const b = sanitizeFieldBox(v);
      if (b) m[k] = b;
    };
    put("invoiceNumber", fb.invoice_number);
    put("invoiceDate", fb.invoice_date);
    put("sellerName", fb.seller_name);
    put("sellerTaxId", fb.seller_tax_id);
    put("buyerTaxId", fb.buyer_tax_id);
    put("amountExTax", fb.amount_ex_tax);
    put("taxAmount", fb.tax_amount);
    put("amountIncTax", fb.amount_inc_tax);
    return m;
  }, [invoice]);

  /** 欄位外層 div：hover 也會觸發高亮／放大（有座標的欄位才綁） */
  function fieldZoomWrapProps(key: FieldKey) {
    if (!fieldBoxMap[key]) return {};
    return {
      onMouseEnter: () => setHoverField(key),
      onMouseLeave: () => setHoverField((v) => (v === key ? null : v)),
    };
  }

  /** 欄位下方的放大裁切浮層；離開 focus／hover 即收合 */
  function fieldZoomPopover(key: FieldKey) {
    const box = fieldBoxMap[key];
    if (!invoice || activeField !== key || !box) return null;
    return (
      <div className="absolute left-0 top-full z-20 mt-1 w-80 max-w-[85vw] rounded-md border border-border bg-card p-1 shadow-lg">
        <FieldCropZoom src={invoice.file_url} box={box} />
      </div>
    );
  }

  /**
   * 佇列審核快捷鍵：Enter 存檔並跳下一張、1–9 選候選採購單、0 不對應、
   * S 先擱著跳下一張、D/Delete 刪除（二次確認）、? 顯示說明。
   * 焦點在輸入欄位時字母／數字不觸發；Enter 僅在勾稽全通過時直接存檔。
   */
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (isEdit || saving || deleting || deleteOpen) return;
    if (e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? "";
    const inTextField = tag === "INPUT" || tag === "TEXTAREA" || (t?.isContentEditable ?? false);

    if (e.key === "Enter") {
      if (tag === "SELECT" || tag === "BUTTON" || tag === "A") return; // 保留原生行為
      if (inTextField && audit.warnCount > 0) return; // 勾稽未全過：Enter 只是欄位確認
      e.preventDefault();
      void onConfirm();
      return;
    }

    // 其餘快捷鍵：輸入欄位或下拉選單聚焦時不觸發
    if (inTextField || tag === "SELECT") return;

    if (/^[1-9]$/.test(e.key)) {
      const target = suggestions[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        setPurchaseOrderId(target.po.id);
      }
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      setPurchaseOrderId("");
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (!onAdvance?.()) onOpenChange(false);
      return;
    }
    if (e.key === "d" || e.key === "D" || e.key === "Delete") {
      e.preventDefault();
      setDeleteOpen(true);
      return;
    }
    if (e.key === "?") {
      e.preventDefault();
      setShowShortcuts((v) => !v);
    }
  }

  // 刪除確認開啟時：再按一次 D／Delete 即確認刪除（Enter 由確認鈕原生處理）
  useEffect(() => {
    if (!open || !deleteOpen || isEdit || deleting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D" || e.key === "Delete") {
        e.preventDefault();
        void performDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- performDelete 依 invoice 而定，deleteOpen 期間不變
  }, [open, deleteOpen, isEdit, deleting]);

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

  /** 已對這張發票自動預選過採購單（每張只自動選一次，之後不覆寫使用者操作） */
  const autoPoPickedRef = useRef<string | null>(null);

  // 第一名候選「金額完全一致且賣方相符」時自動預選（不自動送出）
  useEffect(() => {
    if (!open || !invoice || isEdit) return;
    if (autoPoPickedRef.current === invoice.id) return;
    if (purchaseOrderId) return;
    const top = suggestions[0];
    if (top && top.amountExact && top.vendorMatch) {
      autoPoPickedRef.current = invoice.id;
      setPurchaseOrderId(top.po.id);
    }
  }, [open, invoice, isEdit, purchaseOrderId, suggestions]);

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
          // 存檔當下的勾稽結果（QR 驗證／例外項目），日後追溯用；編輯模式不覆寫
          ...(isEdit ? {} : { review_checks: toStoredReviewChecks(audit) as unknown as Json }),
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
      onSaved();
      if (!onAdvance?.()) onOpenChange(false);
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
      onSaved();
      if (!onAdvance?.()) onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(errText(err, "刪除失敗，請稍後再試"));
    } finally {
      setDeleting(false);
    }
  }

  const isPdf =
    (invoice?.media_type ?? "") === "application/pdf" || (invoice?.file_path ?? "").endsWith(".pdf");

  /** AI 辨識的發票紙張範圍：有值時照片預設聚焦放大該區域 */
  const cropBox = useMemo(() => sanitizeCropBox(invoice?.recognized?.crop_box), [invoice]);
  /** 需人工核對欄位所在範圍：照片上的紅框 */
  const fieldsBox = useMemo(() => sanitizeCropBox(invoice?.recognized?.fields_box), [invoice]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onKeyDown={onDialogKeyDown}
          aria-describedby="accounting-invoice-review-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                {isEdit ? "檢視／編輯發票" : "人工審核存檔"}
                {!isEdit && queueProgress && (
                  <span className="text-sm font-normal tabular-nums text-muted-foreground">
                    {queueProgress.index} / {queueProgress.total}
                  </span>
                )}
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => setShowShortcuts((v) => !v)}
                    className="rounded border border-border px-1.5 py-px text-[10px] font-normal text-muted-foreground hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                    title="鍵盤快捷鍵（按 ? 開關）"
                  >
                    ⌨ ?
                  </button>
                )}
              </Dialog.Title>
              <p id="accounting-invoice-review-desc" className="mt-1 text-sm text-muted-foreground">
                對照左側發票照片確認發票號碼與金額，並對應到採購單；確認後照片會依賣方／日期歸檔
              </p>
              {!isEdit &&
                (audit.warnCount > 0 ? (
                  <span className="mt-2 inline-flex items-center rounded border border-amber-500/50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                    ⚠ {audit.warnCount} 項待核對
                  </span>
                ) : audit.passCount > 0 ? (
                  <span className="mt-2 inline-flex items-center rounded border border-emerald-500/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    ✓ 全數勾稽通過{audit.qrVerified ? "" : "（QR 未驗證，仍請目視核對）"}
                  </span>
                ) : (
                  <span className="mt-2 inline-flex items-center rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    無可勾稽資料，請人工核對
                  </span>
                ))}
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

          {/* 鍵盤快捷鍵說明浮層（? 或標題列按鈕開關） */}
          {showShortcuts && !isEdit && (
            <div className="absolute right-5 top-16 z-10 w-72 rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-foreground">鍵盤快捷鍵</p>
                <button
                  type="button"
                  onClick={() => setShowShortcuts(false)}
                  className="rounded p-0.5 hover:bg-accent/40"
                  aria-label="關閉快捷鍵說明"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <dl className="grid grid-cols-[64px_1fr] gap-y-1.5 text-muted-foreground">
                <dt className="font-mono text-foreground">Enter</dt>
                <dd>確認存檔，自動接下一張（在欄位內時須勾稽全過）</dd>
                <dt className="font-mono text-foreground">1–9</dt>
                <dd>選第 N 個採購單候選</dd>
                <dt className="font-mono text-foreground">0</dt>
                <dd>不對應採購單</dd>
                <dt className="font-mono text-foreground">S</dt>
                <dd>先擱著，看下一張</dd>
                <dt className="font-mono text-foreground">D / Del</dt>
                <dd>刪除此張（再按一次或 Enter 確認）</dd>
                <dt className="font-mono text-foreground">?</dt>
                <dd>開關本說明</dd>
              </dl>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* 左：發票照片 */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <div className="rounded-lg border border-border bg-muted/20 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                    發票原稿
                    {!isEdit && qrStatus === "decoding" && (
                      <span className="animate-pulse rounded border border-border px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                        QR 解碼中…
                      </span>
                    )}
                    {!isEdit && qrStatus === "verified" && (
                      <span className="rounded border border-emerald-500/50 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        QR 已驗證
                      </span>
                    )}
                    {!isEdit && qrStatus === "failed" && (
                      <span className="rounded border border-amber-500/50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-500">
                        QR 無法解碼，請人工核對
                      </span>
                    )}
                    {!isEdit && qrStatus === "unsupported" && (
                      <span className="rounded border border-border px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                        PDF 無法掃 QR
                      </span>
                    )}
                  </span>
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
                    <InvoiceImageViewer
                      src={invoice.file_url}
                      alt="發票照片"
                      cropBox={cropBox}
                      fieldsBox={fieldsBox}
                      highlightBox={activeField ? (fieldBoxMap[activeField] ?? null) : null}
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
                <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("invoiceNumber")}>
                  <label htmlFor="acct-invoice-number" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    發票號碼 *
                    <SourceBadge source={fieldSources.invoiceNumber} />
                  </label>
                  <input
                    id="acct-invoice-number"
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => {
                      setInvoiceNumber(e.target.value);
                      markManual("invoiceNumber");
                    }}
                    onFocus={() => setFocusField("invoiceNumber")}
                    onBlur={() => {
                      setInvoiceNumber((v) => (v.trim() ? normalizeInvoiceNumber(v) : v));
                      setFocusField((v) => (v === "invoiceNumber" ? null : v));
                    }}
                    placeholder="AB-12345678"
                    autoComplete="off"
                    className={`h-9 rounded-lg border ${auditBorder("invoice_number")} bg-background px-3 text-sm uppercase text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`}
                    required
                  />
                  {auditWarnDetail("invoice_number") && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("invoice_number")}</p>
                  )}
                  {fieldZoomPopover("invoiceNumber")}
                </div>
                <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("invoiceDate")}>
                  <label htmlFor="acct-invoice-date" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    發票日期
                    <SourceBadge source={fieldSources.invoiceDate} />
                  </label>
                  <input
                    id="acct-invoice-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => {
                      setInvoiceDate(e.target.value);
                      markManual("invoiceDate");
                    }}
                    onFocus={() => setFocusField("invoiceDate")}
                    onBlur={() => setFocusField((v) => (v === "invoiceDate" ? null : v))}
                    className={`h-9 rounded-lg border ${auditBorder("invoice_date", "period")} bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring`}
                  />
                  {auditWarnDetail("invoice_date") && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("invoice_date")}</p>
                  )}
                  {auditWarnDetail("period") && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("period")}</p>
                  )}
                  {fieldZoomPopover("invoiceDate")}
                </div>
              </div>

              {duplicateOf && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  這個發票號碼已存檔過（{duplicateOf}），可能是重複上傳；若確定重複，點下方「刪除此張」即可。
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="relative flex flex-col gap-1.5 sm:col-span-1" {...fieldZoomWrapProps("sellerName")}>
                  <label htmlFor="acct-seller-name" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    賣方名稱
                    <SourceBadge source={fieldSources.sellerName} />
                  </label>
                  <input
                    id="acct-seller-name"
                    type="text"
                    value={sellerName}
                    onChange={(e) => {
                      setSellerName(e.target.value);
                      markManual("sellerName");
                    }}
                    onFocus={() => setFocusField("sellerName")}
                    onBlur={() => setFocusField((v) => (v === "sellerName" ? null : v))}
                    autoComplete="off"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {fieldZoomPopover("sellerName")}
                </div>
                <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("sellerTaxId")}>
                  <label htmlFor="acct-seller-tax-id" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    賣方統編
                    <SourceBadge source={fieldSources.sellerTaxId} />
                  </label>
                  <input
                    id="acct-seller-tax-id"
                    type="text"
                    inputMode="numeric"
                    value={sellerTaxId}
                    onChange={(e) => {
                      setSellerTaxId(e.target.value);
                      markManual("sellerTaxId");
                    }}
                    onFocus={() => setFocusField("sellerTaxId")}
                    onBlur={() => setFocusField((v) => (v === "sellerTaxId" ? null : v))}
                    autoComplete="off"
                    placeholder="8 碼數字"
                    className={`h-9 rounded-lg border ${auditBorder("seller_tax_id")} bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`}
                  />
                  {auditWarnDetail("seller_tax_id") && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("seller_tax_id")}</p>
                  )}
                  {fieldZoomPopover("sellerTaxId")}
                </div>
                <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("buyerTaxId")}>
                  <label htmlFor="acct-buyer-tax-id" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    買方統編
                    <SourceBadge source={fieldSources.buyerTaxId} />
                  </label>
                  <input
                    id="acct-buyer-tax-id"
                    type="text"
                    inputMode="numeric"
                    value={buyerTaxId}
                    onChange={(e) => {
                      setBuyerTaxId(e.target.value);
                      markManual("buyerTaxId");
                    }}
                    onFocus={() => setFocusField("buyerTaxId")}
                    onBlur={() => setFocusField((v) => (v === "buyerTaxId" ? null : v))}
                    autoComplete="off"
                    placeholder="無則留空"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {fieldZoomPopover("buyerTaxId")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("amountExTax")}>
                    <label htmlFor="acct-amount-ex" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      未稅金額
                      <SourceBadge source={fieldSources.amountExTax} />
                    </label>
                    <input
                      id="acct-amount-ex"
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountExTax}
                      onChange={(e) => {
                        setAmountExTax(e.target.value);
                        markManual("amountExTax");
                      }}
                      onFocus={() => setFocusField("amountExTax")}
                      onBlur={() => setFocusField((v) => (v === "amountExTax" ? null : v))}
                      className={`h-9 rounded-lg border ${auditBorder("amount_sum")} bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring`}
                    />
                    {fieldZoomPopover("amountExTax")}
                  </div>
                  <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("taxAmount")}>
                    <label htmlFor="acct-tax-amount" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      稅額
                      <SourceBadge source={fieldSources.taxAmount} />
                    </label>
                    <input
                      id="acct-tax-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={taxAmount}
                      onChange={(e) => {
                        setTaxAmount(e.target.value);
                        markManual("taxAmount");
                      }}
                      onFocus={() => setFocusField("taxAmount")}
                      onBlur={() => setFocusField((v) => (v === "taxAmount" ? null : v))}
                      className={`h-9 rounded-lg border ${auditBorder("tax_rate", "amount_sum")} bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring`}
                    />
                    {auditWarnDetail("tax_rate") && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("tax_rate")}</p>
                    )}
                    {fieldZoomPopover("taxAmount")}
                  </div>
                  <div className="relative flex flex-col gap-1.5" {...fieldZoomWrapProps("amountIncTax")}>
                    <label htmlFor="acct-amount-inc" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      含稅金額 *
                      <SourceBadge source={fieldSources.amountIncTax} />
                    </label>
                    <input
                      id="acct-amount-inc"
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountIncTax}
                      onChange={(e) => {
                        setAmountIncTax(e.target.value);
                        markManual("amountIncTax");
                      }}
                      onFocus={() => setFocusField("amountIncTax")}
                      onBlur={() => setFocusField((v) => (v === "amountIncTax" ? null : v))}
                      className={`h-9 rounded-lg border ${auditBorder("amount_inc_tax", "amount_sum")} bg-background px-3 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-ring`}
                      required
                    />
                    {auditWarnDetail("amount_inc_tax") && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-500">{auditWarnDetail("amount_inc_tax")}</p>
                    )}
                    {fieldZoomPopover("amountIncTax")}
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
                    <label htmlFor="acct-format-code" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      格式代號
                      <SourceBadge source={fieldSources.formatCode} />
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
                      {suggestions.map(({ po, amountExact, vendorMatch, dateDiffDays, amountDiff }) => (
                        <button
                          key={po.id}
                          type="button"
                          onClick={() => setPurchaseOrderId(po.id)}
                          className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                            purchaseOrderId === po.id
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background text-foreground hover:border-primary/50"
                          }`}
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium tabular-nums">{displayPoNumber(po.po_number)}</span>
                            <span className="text-muted-foreground">{po.purchase_date}</span>
                            <span>{po.vendor_name ?? "未指定廠商"}</span>
                            <span className="tabular-nums">含稅 ${po.total_inc_tax.toLocaleString()}</span>
                          </span>
                          {/* 匹配依據明細：賣方 ✓ · 日期 -1天 · 金額 -$476 */}
                          <span className="flex flex-wrap items-center gap-1 text-[11px]">
                            <span
                              className={
                                vendorMatch
                                  ? "font-medium text-emerald-700 dark:text-emerald-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {vendorMatch ? "賣方 ✓" : "賣方不符"}
                            </span>
                            {dateDiffDays != null && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {dateDiffDays === 0
                                    ? "日期同日"
                                    : `日期 ${dateDiffDays > 0 ? "+" : "-"}${Math.abs(dateDiffDays)}天`}
                                </span>
                              </>
                            )}
                            <span className="text-muted-foreground">·</span>
                            {amountExact ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-400">金額相符</span>
                            ) : amountDiff != null ? (
                              <span className="font-medium text-destructive tabular-nums">
                                金額 {amountDiff > 0 ? "+" : "-"}${Math.abs(Math.round(amountDiff)).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">金額無法比對</span>
                            )}
                          </span>
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
                  {!isEdit && onAdvance && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving || deleting}
                      onClick={() => {
                        if (!onAdvance()) onOpenChange(false);
                      }}
                    >
                      略過，看下一張
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={onConfirm}
                    disabled={saving || deleting}
                    className={quickPass ? "ring-2 ring-emerald-500/70 ring-offset-2" : undefined}
                  >
                    {saving ? "存檔中…" : isEdit ? "儲存變更" : quickPass ? "確認存檔 ✓" : "確認存檔"}
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
