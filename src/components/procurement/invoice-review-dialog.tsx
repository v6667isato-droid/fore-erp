"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Camera, FileScan, Plus, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import imageCompression from "browser-image-compression";
import type { InvoiceFile, ProcurementMaterialRow } from "@/types/procurement";
import type { Json } from "@/types/database.types";
import {
  normalizeAmortizationMonths,
  PURCHASE_AMORTIZATION_OPTIONS,
  resolveDefaultAmortizationMonths,
} from "@/lib/purchase-amortization";
import { computePurchaseLinePrices } from "@/lib/purchase-tax";
import { purchaseSpecFromMaterialParts } from "@/lib/procurement-material";
import { compressInvoiceFileForStorage } from "@/lib/invoice-file";
import { displayPoNumber, generatePoNumber } from "@/lib/purchase-order";
import {
  matchMaterial,
  normalizeItemText,
  textSimilarity,
  type MatchSource,
  type VendorItemAlias,
} from "@/lib/invoice-match";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RecognizedInvoice } from "@/app/api/invoice-recognition/route";

const MAX_PDF_BYTES = 3.5 * 1024 * 1024;

type VendorOption = { id: string; name: string; main_category: string };

type ReviewLine = {
  id: string;
  /** 請款單上辨識出的原始品名（人工新增列為空字串） */
  rawName: string;
  rawSpec: string;
  materialId: string | null;
  matchSource: MatchSource | null;
  quantity: string;
  unitPrice: string;
  amortizationMonths: number;
};

function newLineId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyLine(): ReviewLine {
  return {
    id: newLineId(),
    rawName: "",
    rawSpec: "",
    materialId: null,
    matchSource: null,
    quantity: "",
    unitPrice: "",
    amortizationMonths: 1,
  };
}

/** 從 Supabase 錯誤物件盡量取出可讀訊息（PostgrestError／StorageError 可能非 Error 實例） */
function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const MATCH_BADGE: Record<MatchSource, { label: string; className: string }> = {
  alias: { label: "記憶對應", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  exact: { label: "主檔同名", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  fuzzy: { label: "相似候選", className: "border-amber-500/50 text-amber-700 dark:text-amber-500" },
};

export interface InvoiceReviewDialogProps {
  onSuccess: () => void;
}

export function InvoiceReviewDialog({ onSuccess }: InvoiceReviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [file, setFile] = useState<File | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [materials, setMaterials] = useState<ProcurementMaterialRow[]>([]);
  const [aliases, setAliases] = useState<VendorItemAlias[]>([]);

  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [priceIsTaxInclusive, setPriceIsTaxInclusive] = useState(false);
  const [aiTotal, setAiTotal] = useState<number | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [materialDialogLineId, setMaterialDialogLineId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("upload");
    setFile(null);
    setError(null);
    setRecognizing(false);
    setSaving(false);
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setVendorName("");
    setPriceIsTaxInclusive(false);
    setAiTotal(null);
    setLines([]);
    supabase.from("vendors").select("id, name, main_category").then(({ data }) => {
      setVendors((data as VendorOption[]) ?? []);
    });
    supabase
      .from("procurement_materials")
      .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
      .order("name")
      .then(({ data }) => {
        setMaterials((data as ProcurementMaterialRow[]) ?? []);
      });
    supabase
      .from("vendor_item_aliases")
      .select("vendor_name, alias_text, material_id")
      .then(({ data }) => {
        setAliases((data as VendorItemAlias[]) ?? []);
      });
  }, [open]);

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
    [materials],
  );

  const vendorOptions = useMemo(
    () => [...vendors].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
    [vendors],
  );

  /** purchases.vendor_name 有外鍵限制：廠商需存在於主檔（留空則不記廠商） */
  const vendorExists = useMemo(() => {
    const v = vendorName.trim();
    if (!v) return true;
    return vendors.some((x) => x.name === v);
  }, [vendorName, vendors]);
  const [addingVendor, setAddingVendor] = useState(false);

  /** 主檔裡名稱相近的廠商（差幾個字的情況），供「你是不是要選…」建議 */
  const vendorSuggestions = useMemo(() => {
    const v = vendorName.trim();
    if (!v || vendorExists) return [];
    return vendors
      .map((x) => ({ name: x.name, score: textSimilarity(v, x.name) }))
      .filter((x) => x.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.name);
  }, [vendorName, vendorExists, vendors]);

  async function quickAddVendor() {
    const v = vendorName.trim();
    if (!v) return;
    setAddingVendor(true);
    const { data, error: insErr } = await supabase
      .from("vendors")
      .insert({ name: v, main_category: "其他" })
      .select("id, name, main_category")
      .single();
    setAddingVendor(false);
    if (insErr || !data) {
      toast.error(errText(insErr, "廠商新增失敗"));
      return;
    }
    setVendors((prev) => [...prev, data as VendorOption]);
    toast.success(`已將「${v}」加入廠商主檔（類別：其他，可到廠商分頁補完整資料）`);
  }

  /** 「修改既有廠商名稱」：搜尋選擇的來源廠商名 */
  const [renameSourceName, setRenameSourceName] = useState("");
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameSourceVendor = useMemo(
    () => vendors.find((v) => v.name === renameSourceName.trim()) ?? null,
    [vendors, renameSourceName],
  );

  /** 把既有廠商改名為辨識出的名稱；purchases 由 FK ON UPDATE CASCADE 自動跟進 */
  async function renameVendorToRecognized() {
    const source = renameSourceVendor;
    const newName = vendorName.trim();
    if (!source || !newName) return;
    const oldName = source.name;
    setRenaming(true);
    const { error: updErr } = await supabase
      .from("vendors")
      .update({ name: newName })
      .eq("id", source.id);
    if (updErr) {
      setRenaming(false);
      toast.error(errText(updErr, "廠商改名失敗"));
      return;
    }
    // 同步更新非 FK 的參照（單頭顯示與品名記憶）；失敗不阻斷主流程
    await supabase.from("purchase_orders").update({ vendor_name: newName }).eq("vendor_name", oldName);
    const { error: aliasErr } = await supabase
      .from("vendor_item_aliases")
      .update({ vendor_name: newName })
      .eq("vendor_name", oldName);
    if (aliasErr) console.error("品名記憶廠商名同步失敗:", aliasErr.message);
    setRenaming(false);
    setVendors((prev) => prev.map((v) => (v.id === source.id ? { ...v, name: newName } : v)));
    setRenameSourceName("");
    toast.success(`已將廠商「${oldName}」改名為「${newName}」，歷史採購紀錄已一併更新`);
  }

  function updateLine(id: string, patch: Partial<ReviewLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function applyRecognition(result: RecognizedInvoice) {
    const vendor = result.vendor_name?.trim() ?? "";
    // 辨識出的廠商名嘗試對回廠商主檔（包含關係即視為同廠商）
    const matchedVendor =
      vendors.find((v) => v.name === vendor) ??
      vendors.find((v) => vendor && (v.name.includes(vendor) || vendor.includes(v.name)));
    const finalVendor = matchedVendor?.name ?? vendor;
    setVendorName(finalVendor);
    if (result.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(result.invoice_date)) {
      setPurchaseDate(result.invoice_date);
    }
    if (result.prices_tax_inclusive != null) {
      setPriceIsTaxInclusive(result.prices_tax_inclusive);
    }
    setAiTotal(result.total_amount ?? null);
    const nextLines: ReviewLine[] = result.items.map((item) => {
      const match = matchMaterial(item.name, finalVendor, materials, aliases);
      const material = match ? materials.find((m) => m.id === match.materialId) : undefined;
      return {
        id: newLineId(),
        rawName: item.name,
        rawSpec: item.spec?.trim() ?? "",
        materialId: match?.materialId ?? null,
        matchSource: match?.source ?? null,
        quantity: item.quantity != null ? String(item.quantity) : "",
        unitPrice: item.unit_price != null ? String(item.unit_price) : "",
        amortizationMonths: material ? resolveDefaultAmortizationMonths(material) : 1,
      };
    });
    setLines(nextLines.length > 0 ? nextLines : [emptyLine()]);
    setStep("review");
  }

  async function recognize() {
    if (!file) {
      setError("請先選擇請款單檔案");
      return;
    }
    setError(null);
    setRecognizing(true);
    try {
      let payloadBlob: Blob = file;
      let mediaType = file.type;
      if (file.type.startsWith("image/")) {
        payloadBlob = await imageCompression(file, {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 2400,
          useWebWorker: true,
        });
        mediaType = payloadBlob.type || "image/jpeg";
      } else if (file.type === "application/pdf" && file.size > MAX_PDF_BYTES) {
        setError("PDF 檔案過大（上限約 3.5MB），請改用截圖或壓縮後再試");
        setRecognizing(false);
        return;
      }
      const base64 = await fileToBase64(payloadBlob);
      const res = await fetch("/api/invoice-recognition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_base64: base64, media_type: mediaType }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "辨識失敗，請稍後再試或改用手動輸入");
        setRecognizing(false);
        return;
      }
      applyRecognition(json.result as RecognizedInvoice);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "辨識失敗，請稍後再試");
    } finally {
      setRecognizing(false);
    }
  }

  function skipToManual() {
    setError(null);
    setAiTotal(null);
    setLines([emptyLine()]);
    setStep("review");
  }

  const lineComputed = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computePurchaseLinePrices> | null>();
    for (const line of lines) {
      const q = line.quantity.trim() ? Number(line.quantity) : 0;
      const p = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      if (Number.isNaN(q) || Number.isNaN(p)) {
        map.set(line.id, null);
        continue;
      }
      map.set(line.id, computePurchaseLinePrices(p, q, priceIsTaxInclusive));
    }
    return map;
  }, [lines, priceIsTaxInclusive]);

  const computedTotal = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      const c = lineComputed.get(line.id);
      if (c) total += c.tax_included_amount;
    }
    return Math.round(total * 100) / 100;
  }, [lines, lineComputed]);

  const totalMismatch =
    aiTotal != null && Math.abs(computedTotal - aiTotal) > 1;

  async function onConfirm() {
    setError(null);
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    if (!vendorExists) {
      setError(`廠商「${vendorName.trim()}」不在廠商主檔中，請點上方按鈕加入主檔、改選既有廠商或留空`);
      return;
    }
    const activeLines = lines.filter((l) => l.materialId || l.rawName.trim() || l.quantity.trim() || l.unitPrice.trim());
    if (activeLines.length === 0) {
      setError("請至少保留一筆品項");
      return;
    }
    for (const line of activeLines) {
      if (!line.materialId) {
        setError(`品項「${line.rawName.trim() || "（未命名）"}」尚未對應採購物料，請選擇料號或移除該列`);
        return;
      }
      const q = line.quantity.trim() ? Number(line.quantity) : 0;
      const p = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
      if (Number.isNaN(q) || q < 0 || Number.isNaN(p) || p < 0) {
        setError(`品項「${line.rawName.trim() || "品項"}」的數量或單價無效`);
        return;
      }
    }

    setSaving(true);
    try {
      const vendor = vendorName.trim() || null;

      // 1. 建採購單單頭（編號撞號時重產一次）
      let purchaseOrderId: string | null = null;
      let poNumber: string | null = null;
      for (let attempt = 0; attempt < 2 && purchaseOrderId == null; attempt++) {
        const candidate = generatePoNumber();
        const poRes = await supabase
          .from("purchase_orders")
          .insert({ po_number: candidate, purchase_date: purchaseDate.trim(), vendor_name: vendor })
          .select("id, po_number")
          .single();
        if (!poRes.error && poRes.data) {
          purchaseOrderId = (poRes.data as { id: string }).id;
          poNumber = (poRes.data as { po_number: string }).po_number;
          break;
        }
        if (!/duplicate key|unique/i.test(poRes.error?.message ?? "")) {
          throw new Error(poRes.error?.message || "採購單建立失敗");
        }
      }
      if (!purchaseOrderId) throw new Error("採購單編號產生失敗，請重試");

      // 2. 上傳請款單附件（有選檔案時）
      let uploadedPath: string | null = null;
      if (file) {
        const { blob, ext } = await compressInvoiceFileForStorage(file);
        const path = `${purchaseOrderId}/${newLineId()}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage
          .from("purchase-invoices")
          .upload(path, blob, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;
        uploadedPath = up.path;
        const {
          data: { publicUrl },
        } = supabase.storage.from("purchase-invoices").getPublicUrl(up.path);
        const files: InvoiceFile[] = [
          { url: publicUrl, path: up.path, name: file.name, uploaded_at: new Date().toISOString() },
        ];
        const { error: updErr } = await supabase
          .from("purchase_orders")
          .update({ invoice_files: files as unknown as Json })
          .eq("id", purchaseOrderId);
        if (updErr) throw updErr;
      }

      // 3. 建立採購明細
      const payloads = activeLines.map((line) => {
        const m = materials.find((x) => x.id === line.materialId)!;
        const q = line.quantity.trim() ? Number(line.quantity) : 0;
        const p = line.unitPrice.trim() ? Number(line.unitPrice) : 0;
        const tax = computePurchaseLinePrices(p, q, priceIsTaxInclusive);
        return {
          purchase_date: purchaseDate.trim(),
          vendor_name: vendor,
          purchase_order_id: purchaseOrderId,
          item_name: m.name,
          item_category: m.item_category?.trim() || null,
          spec: purchaseSpecFromMaterialParts(m.spec ?? "", m.spec2 ?? "") || null,
          spec2: m.spec2?.trim() || null,
          quantity: q,
          unit: m.unit?.trim() || null,
          material_id: m.id,
          unit_price: tax.unit_price,
          unit_price_is_tax_inclusive: tax.unit_price_is_tax_inclusive,
          unit_price_ex_tax: tax.unit_price_ex_tax,
          unit_price_inc_tax: tax.unit_price_inc_tax,
          amount_ex_tax: tax.amount_ex_tax,
          amortization_months: normalizeAmortizationMonths(line.amortizationMonths),
        };
      });
      const { error: insErr } = await supabase.from("purchases").insert(payloads);
      if (insErr) {
        // 回滾：刪掉剛建立的單頭與附件，避免留下孤兒資料
        await supabase.from("purchase_orders").delete().eq("id", purchaseOrderId);
        if (uploadedPath) {
          await supabase.storage.from("purchase-invoices").remove([uploadedPath]);
        }
        throw insErr;
      }

      // 4. 寫入廠商品名→料號記憶（下次同廠商自動帶入）
      const aliasRows = activeLines
        .filter((l) => l.rawName.trim() && l.materialId)
        .map((l) => ({
          vendor_name: vendor ?? "",
          alias_text: normalizeItemText(l.rawName),
          material_id: l.materialId as string,
        }))
        .filter((r, i, arr) => r.alias_text && arr.findIndex((x) => x.alias_text === r.alias_text) === i);
      if (aliasRows.length > 0) {
        const { error: aliasErr } = await supabase
          .from("vendor_item_aliases")
          .upsert(aliasRows, { onConflict: "vendor_name,alias_text" });
        if (aliasErr) console.error("品名記憶寫入失敗:", aliasErr.message);
      }

      toast.success(`已建立採購單 ${displayPoNumber(poNumber)}（${payloads.length} 筆品項）`);
      setOpen(false);
      onSuccess();
    } catch (err) {
      console.error(err);
      let message = errText(err, "建檔失敗，請稍後再試");
      if (/violates foreign key constraint "purchases_vendor_name_fkey"/i.test(message)) {
        message = "廠商名稱不在廠商主檔中，請改選既有廠商或先加入主檔";
      }
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <FileScan className="h-4 w-4" />
            上傳請款單建檔
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
            onCloseAutoFocus={(e) => e.preventDefault()}
            aria-describedby="invoice-review-desc"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">上傳請款單建檔</Dialog.Title>
                <p id="invoice-review-desc" className="mt-1 text-sm text-muted-foreground">
                  {step === "upload"
                    ? "上傳廠商請款單（照片或 PDF），AI 自動辨識品項並比對料號，人工審核後一次建立採購單"
                    : "逐行確認品項對應的採購物料與數量單價，確認無誤後建檔；請款單附件會一併存到此採購單"}
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

            {step === "upload" && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="invoice-file" className="text-xs text-muted-foreground">
                    請款單檔案（JPG／PNG 照片或 PDF）
                  </label>
                  <input
                    id="invoice-file"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  />
                  {/* 手機直接開相機拍請款單（capture 桌機瀏覽器會忽略，退回一般選檔） */}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    aria-label="開啟相機拍攝請款單"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full sm:w-auto"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4 mr-1.5" />
                    開啟相機拍攝（手機）
                  </Button>
                  {file && (
                    <p className="text-xs text-muted-foreground">
                      已選擇：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）
                    </p>
                  )}
                </div>

                {error && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" onClick={skipToManual} disabled={recognizing}>
                    跳過辨識，手動輸入
                  </Button>
                  <Button type="button" onClick={recognize} disabled={!file || recognizing}>
                    {recognizing ? "AI 辨識中…（約 10～30 秒）" : "開始辨識"}
                  </Button>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="invoice-review-date" className="text-xs text-muted-foreground">
                      日期 *
                    </label>
                    <input
                      id="invoice-review-date"
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="invoice-review-vendor" className="text-xs text-muted-foreground">
                      廠商
                    </label>
                    <input
                      id="invoice-review-vendor"
                      type="text"
                      list="invoice-review-vendor-datalist"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      autoComplete="off"
                      placeholder="打字篩選或從清單選擇"
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <datalist id="invoice-review-vendor-datalist">
                      {vendorOptions.map((v) => (
                        <option key={v.id} value={v.name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {!vendorExists && (
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                    <p className="text-xs text-amber-700 dark:text-amber-500">
                      「{vendorName.trim()}」不在廠商主檔中，無法建檔。
                    </p>
                    {vendorSuggestions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-foreground">你是不是要選（點擊帶入）：</span>
                        {vendorSuggestions.map((name) => (
                          <Button
                            key={name}
                            type="button"
                            variant="outline"
                            className="h-7 px-2.5 text-xs font-medium"
                            onClick={() => setVendorName(name)}
                          >
                            {name}
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        把既有廠商<strong className="text-foreground">改名</strong>為「{vendorName.trim()}」：
                      </span>
                      <input
                        type="text"
                        list="invoice-rename-vendor-datalist"
                        value={renameSourceName}
                        onChange={(e) => setRenameSourceName(e.target.value)}
                        autoComplete="off"
                        placeholder="搜尋要改名的廠商"
                        className="h-7 w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="搜尋要改名的既有廠商"
                      />
                      <datalist id="invoice-rename-vendor-datalist">
                        {vendorOptions.map((v) => (
                          <option key={v.id} value={v.name} />
                        ))}
                      </datalist>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setRenameConfirmOpen(true)}
                        disabled={!renameSourceVendor || renaming}
                        title={renameSourceVendor ? undefined : "請先從清單選擇既有廠商"}
                      >
                        {renaming ? "改名中…" : "改名"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">確認是新廠商的話，可以</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={quickAddVendor}
                        disabled={addingVendor}
                      >
                        {addingVendor ? "新增中…" : `新增「${vendorName.trim()}」為新廠商`}
                      </Button>
                      <span className="text-xs text-muted-foreground">或留空不記廠商</span>
                    </div>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={priceIsTaxInclusive}
                    onChange={(e) => setPriceIsTaxInclusive(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  單價為<strong className="font-medium">已稅</strong>金額（未勾選則為未稅，營業稅率固定 5%）
                </label>

                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-foreground">品項明細（請逐行確認料號對應）</p>
                  {lines.map((line) => {
                    const computed = lineComputed.get(line.id);
                    const badge = line.matchSource ? MATCH_BADGE[line.matchSource] : null;
                    return (
                      <div key={line.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {line.rawName.trim() ? (
                              <>
                                <span className="text-sm font-medium text-foreground">{line.rawName}</span>
                                {line.rawSpec ? (
                                  <span className="text-xs text-muted-foreground">（{line.rawSpec}）</span>
                                ) : null}
                                <span className="text-[10px] text-muted-foreground">— 請款單品名</span>
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">（手動新增品項）</span>
                            )}
                            {badge && (
                              <span className={`rounded border px-1 py-px text-[10px] font-medium ${badge.className}`}>
                                {badge.label}
                              </span>
                            )}
                            {!line.materialId && (
                              <span className="rounded border border-destructive/50 px-1 py-px text-[10px] font-medium text-destructive">
                                未對應
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                            aria-label="移除此品項"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            移除
                          </Button>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                          <select
                            value={line.materialId ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) {
                                updateLine(line.id, { materialId: null, matchSource: null });
                                return;
                              }
                              const m = materials.find((x) => x.id === v);
                              if (!m) return;
                              updateLine(line.id, {
                                materialId: m.id,
                                matchSource: null,
                                amortizationMonths: resolveDefaultAmortizationMonths(m),
                              });
                            }}
                            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="選擇對應的採購物料"
                          >
                            <option value="">請選擇採購物料</option>
                            {sortedMaterials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.item_category ? `[${m.item_category}] ` : ""}
                                {m.name}
                                {m.spec ? ` — ${m.spec}` : ""}
                                {m.spec2 ? ` · ${m.spec2}` : ""}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 shrink-0"
                            onClick={() => {
                              setMaterialDialogLineId(line.id);
                              setMaterialDialogOpen(true);
                            }}
                          >
                            新增物料
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:items-end">
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`invoice-qty-${line.id}`} className="text-[11px] text-muted-foreground">
                              數量
                            </label>
                            <input
                              id={`invoice-qty-${line.id}`}
                              type="number"
                              min={0}
                              step="any"
                              value={line.quantity}
                              onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                              className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`invoice-price-${line.id}`} className="text-[11px] text-muted-foreground">
                              單價（{priceIsTaxInclusive ? "已稅" : "未稅"}）
                            </label>
                            <input
                              id={`invoice-price-${line.id}`}
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.unitPrice}
                              onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                              className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`invoice-amort-${line.id}`} className="text-[11px] text-muted-foreground">
                              成本攤提
                            </label>
                            <select
                              id={`invoice-amort-${line.id}`}
                              value={line.amortizationMonths}
                              onChange={(e) => updateLine(line.id, { amortizationMonths: Number(e.target.value) || 1 })}
                              className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              {PURCHASE_AMORTIZATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            含稅小計
                            <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
                              {computed ? computed.tax_included_amount.toLocaleString() : "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full sm:w-auto"
                    onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    新增品項
                  </Button>
                </div>

                <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/15 px-3 py-2.5 text-sm">
                  <p className="text-foreground">
                    明細含稅總計：<span className="font-semibold tabular-nums">{computedTotal.toLocaleString()}</span>
                  </p>
                  {aiTotal != null && (
                    <p className={totalMismatch ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground"}>
                      請款單辨識總額：<span className="font-medium tabular-nums">{aiTotal.toLocaleString()}</span>
                      {totalMismatch
                        ? "（與明細加總不符，請檢查是否有漏行、金額辨識錯誤或含稅設定不同）"
                        : "（與明細加總相符）"}
                    </p>
                  )}
                </div>

                {error && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap justify-between gap-2 pt-1">
                  <Button type="button" variant="ghost" onClick={() => setStep("upload")} disabled={saving}>
                    上一步
                  </Button>
                  <div className="flex gap-2">
                    <Dialog.Close asChild>
                      <Button type="button" variant="ghost" disabled={saving}>
                        取消
                      </Button>
                    </Dialog.Close>
                    <Button type="button" onClick={onConfirm} disabled={saving}>
                      {saving ? "建檔中…" : "確認建檔"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={renameConfirmOpen}
        onOpenChange={setRenameConfirmOpen}
        title="確定要修改廠商名稱？"
        description={
          renameSourceVendor ? (
            <>
              <p className="font-medium text-foreground">
                「{renameSourceVendor.name}」 → 「{vendorName.trim()}」
              </p>
              <p className="mt-2 text-muted-foreground">
                此廠商的主檔名稱與所有歷史採購紀錄的廠商名都會一併更新為新名稱。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定改名"
        onConfirm={() => {
          setRenameConfirmOpen(false);
          void renameVendorToRecognized();
        }}
      />

      <AddMaterialDialog
        open={materialDialogOpen}
        onOpenChange={setMaterialDialogOpen}
        onCreated={(m) => {
          const row: ProcurementMaterialRow = {
            ...m,
            item_category: m.item_category ?? "",
            spec: m.spec ?? "",
            spec2: m.spec2 ?? "",
            unit: m.unit ?? "",
          };
          setMaterials((prev) => [...prev, row]);
          if (materialDialogLineId) {
            updateLine(materialDialogLineId, {
              materialId: row.id,
              matchSource: null,
              amortizationMonths: resolveDefaultAmortizationMonths(row),
            });
            setMaterialDialogLineId(null);
          }
        }}
      />
    </>
  );
}
