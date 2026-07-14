"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ExternalLink, Plus, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { InvoiceFile, ProcurementMaterialRow } from "@/types/procurement";
import type { Json } from "@/types/database.types";
import {
  normalizeAmortizationMonths,
  PURCHASE_AMORTIZATION_OPTIONS,
  resolveDefaultAmortizationMonths,
} from "@/lib/purchase-amortization";
import { computePurchaseLinePrices, roundMoney2 } from "@/lib/purchase-tax";
import { purchaseSpecFromMaterialParts } from "@/lib/procurement-material";
import { displayPoNumber, generatePoNumber } from "@/lib/purchase-order";
import {
  matchMaterial,
  normalizeItemText,
  textSimilarity,
  type MatchSource,
  type VendorItemAlias,
} from "@/lib/invoice-match";
import { archiveScanPath, fixRocDate, type InvoiceScanRow } from "@/lib/invoice-scan";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const FILTER_MATERIAL_UNCATEGORIZED = "__uncategorized__";

type VendorOption = { id: string; name: string; main_category: string };

type ReviewLine = {
  id: string;
  /** 請款單上辨識出的原始品名（人工新增列為空字串） */
  rawName: string;
  rawSpec: string;
  materialId: string | null;
  matchSource: MatchSource | null;
  /** 此列「採購物料」下拉用的類別篩選 */
  materialCategoryFilter: string;
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
    materialCategoryFilter: "",
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

const MATCH_BADGE: Record<MatchSource, { label: string; className: string }> = {
  alias: { label: "記憶對應", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  exact: { label: "主檔同名", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  fuzzy: { label: "相似候選", className: "border-amber-500/50 text-amber-700 dark:text-amber-500" },
};

export interface InvoiceReviewDialogProps {
  /** 待審核的掃描（含照片與辨識結果）；null 時不顯示 */
  scan: InvoiceScanRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 建檔歸檔完成 */
  onArchived: () => void;
}

export function InvoiceReviewDialog({ scan, open, onOpenChange, onArchived }: InvoiceReviewDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [materials, setMaterials] = useState<ProcurementMaterialRow[]>([]);
  const [aliases, setAliases] = useState<VendorItemAlias[]>([]);
  const [masterLoaded, setMasterLoaded] = useState(false);

  const [purchaseDate, setPurchaseDate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [priceIsTaxInclusive, setPriceIsTaxInclusive] = useState(false);
  const [aiTotalExTax, setAiTotalExTax] = useState<number | null>(null);
  const [aiTotalIncTax, setAiTotalIncTax] = useState<number | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [materialDialogLineId, setMaterialDialogLineId] = useState<string | null>(null);

  // 開啟時載入主檔
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setMasterLoaded(false);
    Promise.all([
      supabase.from("vendors").select("id, name, main_category"),
      supabase
        .from("procurement_materials")
        .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
        .order("name"),
      supabase.from("vendor_item_aliases").select("vendor_name, alias_text, material_id"),
    ]).then(([v, m, a]) => {
      setVendors((v.data as VendorOption[]) ?? []);
      setMaterials((m.data as ProcurementMaterialRow[]) ?? []);
      setAliases((a.data as unknown as VendorItemAlias[]) ?? []);
      setMasterLoaded(true);
    });
  }, [open]);

  // 主檔載入後，用辨識結果預填表單
  useEffect(() => {
    if (!open || !masterLoaded) return;
    const recognized = scan?.recognized ?? null;
    const vendorRaw = recognized?.vendor_name?.trim() ?? "";
    const matchedVendor =
      vendors.find((v) => v.name === vendorRaw) ??
      vendors.find((v) => vendorRaw && (v.name.includes(vendorRaw) || vendorRaw.includes(v.name)));
    const finalVendor = matchedVendor?.name ?? vendorRaw;
    setVendorName(finalVendor);
    setPurchaseDate(fixRocDate(recognized?.invoice_date) ?? new Date().toISOString().slice(0, 10));
    // 大多數單據為未稅；只有明確標示含稅時才勾
    setPriceIsTaxInclusive(recognized?.prices_tax_inclusive === true);
    setAiTotalExTax(recognized?.total_amount_ex_tax ?? null);
    setAiTotalIncTax(recognized?.total_amount_inc_tax ?? null);
    const nextLines: ReviewLine[] = (recognized?.items ?? []).map((item) => {
      const match = matchMaterial(item.name, finalVendor, materials, aliases);
      const material = match ? materials.find((m) => m.id === match.materialId) : undefined;
      return {
        id: newLineId(),
        rawName: item.name,
        rawSpec: item.spec?.trim() ?? "",
        materialId: match?.materialId ?? null,
        matchSource: match?.source ?? null,
        materialCategoryFilter: "",
        quantity: item.quantity != null ? String(item.quantity) : "",
        unitPrice: item.unit_price != null ? String(item.unit_price) : "",
        amortizationMonths: material ? resolveDefaultAmortizationMonths(material) : 1,
      };
    });
    setLines(nextLines.length > 0 ? nextLines : [emptyLine()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟＋主檔就緒時預填一次
  }, [open, masterLoaded, scan?.id]);

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
    [materials],
  );

  const materialCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of materials) {
      const c = m.item_category?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [materials]);

  const hasUncategorizedMaterials = useMemo(
    () => materials.some((m) => !m.item_category?.trim()),
    [materials],
  );

  function materialsOptionsForLine(line: ReviewLine): ProcurementMaterialRow[] {
    let base = sortedMaterials;
    if (line.materialCategoryFilter === FILTER_MATERIAL_UNCATEGORIZED) {
      base = sortedMaterials.filter((m) => !m.item_category?.trim());
    } else if (line.materialCategoryFilter) {
      base = sortedMaterials.filter((m) => (m.item_category || "").trim() === line.materialCategoryFilter);
    }
    const selected = line.materialId ? materials.find((m) => m.id === line.materialId) : null;
    if (selected && !base.some((m) => m.id === selected.id)) {
      return [selected, ...base];
    }
    return base;
  }

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

  const computedTotals = useMemo(() => {
    let exTax = 0;
    let incTax = 0;
    for (const line of lines) {
      const c = lineComputed.get(line.id);
      if (c) {
        exTax += c.amount_ex_tax;
        incTax += c.tax_included_amount;
      }
    }
    return { exTax: roundMoney2(exTax), incTax: roundMoney2(incTax) };
  }, [lines, lineComputed]);

  /** 以未稅金額為主的核對（多數單據未稅）；單據只有含稅總計時退用含稅比對 */
  const totalCheck = useMemo(() => {
    if (aiTotalExTax != null) {
      return { label: "未稅", ai: aiTotalExTax, computed: computedTotals.exTax, mismatch: Math.abs(computedTotals.exTax - aiTotalExTax) > 1 };
    }
    if (aiTotalIncTax != null) {
      return { label: "含稅", ai: aiTotalIncTax, computed: computedTotals.incTax, mismatch: Math.abs(computedTotals.incTax - aiTotalIncTax) > 1 };
    }
    return null;
  }, [aiTotalExTax, aiTotalIncTax, computedTotals]);

  async function onConfirm() {
    if (!scan) return;
    setError(null);
    if (!purchaseDate.trim()) {
      setError("請選擇日期");
      return;
    }
    if (!vendorExists) {
      setError(`廠商「${vendorName.trim()}」不在廠商主檔中，請用上方選項處理（帶入相似廠商／改名／新增）或留空`);
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

      // 2. 建立採購明細
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
        // 回滾單頭；照片仍留在佇列，可修正後重試
        await supabase.from("purchase_orders").delete().eq("id", purchaseOrderId);
        throw insErr;
      }

      // 3. 照片歸檔：inbox → archive/{廠商}/{日期}/，並掛到採購單
      const ext = scan.file_path.split(".").pop()?.toLowerCase() || "jpg";
      let finalPath = scan.file_path;
      const targetPath = archiveScanPath(vendor, purchaseDate.trim(), scan.id, ext);
      const { error: moveErr } = await supabase.storage
        .from("purchase-invoices")
        .move(scan.file_path, targetPath);
      if (!moveErr) {
        finalPath = targetPath;
      } else {
        console.error("照片歸檔搬移失敗（保留原路徑）:", moveErr.message);
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("purchase-invoices").getPublicUrl(finalPath);
      const files: InvoiceFile[] = [
        {
          url: publicUrl,
          path: finalPath,
          name: scan.file_name || `請款單-${purchaseDate.trim()}`,
          uploaded_at: new Date().toISOString(),
        },
      ];
      const { error: fileErr } = await supabase
        .from("purchase_orders")
        .update({ invoice_files: files as unknown as Json })
        .eq("id", purchaseOrderId);
      if (fileErr) console.error("採購單附件更新失敗:", fileErr.message);

      // 4. 更新佇列狀態
      const { error: scanErr } = await supabase
        .from("invoice_scans")
        .update({
          status: "archived",
          purchase_order_id: purchaseOrderId,
          file_path: finalPath,
          file_url: publicUrl,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", scan.id);
      if (scanErr) console.error("佇列狀態更新失敗:", scanErr.message);

      // 5. 寫入廠商品名→料號記憶（下次同廠商自動帶入）
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

      toast.success(`已建立採購單 ${displayPoNumber(poNumber)}（${payloads.length} 筆品項），照片已歸檔`);
      onOpenChange(false);
      onArchived();
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

  const isPdf = (scan?.media_type ?? "") === "application/pdf" || (scan?.file_path ?? "").endsWith(".pdf");

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
            onCloseAutoFocus={(e) => e.preventDefault()}
            aria-describedby="invoice-review-desc"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">人工審核建檔</Dialog.Title>
                <p id="invoice-review-desc" className="mt-1 text-sm text-muted-foreground">
                  對照左側請款單照片，逐行確認品項對應與數量單價；確認建檔後照片會依廠商／日期歸檔並掛到採購單
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
              {/* 左：請款單照片 */}
              <div className="lg:sticky lg:top-0 lg:self-start">
                <div className="rounded-lg border border-border bg-muted/20 p-2">
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <span className="text-xs font-medium text-foreground">請款單原稿</span>
                    {scan && (
                      <a
                        href={scan.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        新分頁開啟
                      </a>
                    )}
                  </div>
                  {scan ? (
                    isPdf ? (
                      <iframe
                        src={scan.file_url}
                        title="請款單 PDF"
                        className="h-[50vh] w-full rounded-md border-0 bg-white lg:h-[72vh]"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- Supabase 外部圖，僅審核時載入
                      <img
                        src={scan.file_url}
                        alt="請款單照片"
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
                {scan?.status === "failed" && (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                    這張的 AI 辨識失敗（{scan.error || "原因不明"}），以下請對照照片手動輸入。
                  </p>
                )}

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
                    const matOptions = materialsOptionsForLine(line);
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
                            value={line.materialCategoryFilter}
                            onChange={(e) => updateLine(line.id, { materialCategoryFilter: e.target.value })}
                            className="h-9 shrink-0 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-32"
                            aria-label="依物品類別篩選採購物料"
                          >
                            <option value="">全部類別</option>
                            {hasUncategorizedMaterials ? (
                              <option value={FILTER_MATERIAL_UNCATEGORIZED}>（未分類）</option>
                            ) : null}
                            {materialCategoryOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
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
                            {matOptions.map((m) => (
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
                            未稅小計
                            <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
                              {computed ? computed.amount_ex_tax.toLocaleString() : "—"}
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
                    明細未稅總計：<span className="font-semibold tabular-nums">{computedTotals.exTax.toLocaleString()}</span>
                    <span className="ml-3 text-muted-foreground">
                      含稅：<span className="tabular-nums">{computedTotals.incTax.toLocaleString()}</span>
                    </span>
                  </p>
                  {totalCheck && (
                    <p className={totalCheck.mismatch ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground"}>
                      請款單辨識{totalCheck.label}總額：
                      <span className="font-medium tabular-nums">{totalCheck.ai.toLocaleString()}</span>
                      {totalCheck.mismatch
                        ? `（與明細${totalCheck.label}加總 ${totalCheck.computed.toLocaleString()} 不符，請對照左側照片檢查漏行或金額）`
                        : "（與明細加總相符）"}
                    </p>
                  )}
                </div>

                {error && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Dialog.Close asChild>
                    <Button type="button" variant="ghost" disabled={saving}>
                      先擱著（保留在佇列）
                    </Button>
                  </Dialog.Close>
                  <Button type="button" onClick={onConfirm} disabled={saving}>
                    {saving ? "建檔中…" : "確認建檔並歸檔"}
                  </Button>
                </div>
              </div>
            </div>
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
