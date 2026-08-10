"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { formatDate, relName } from "@/lib/utils";
import { computePurchaseLinePrices, roundMoney2 } from "@/lib/purchase-tax";
import type { PurchaseRow, NameRel, InvoiceFile } from "@/types/procurement";
import type { Json } from "@/types/database.types";
import { purchaseSpecPartsForDisplay } from "@/lib/procurement-material";
import {
  displayPoNumber,
  groupPurchaseRows,
  parseInvoiceFiles,
  type PurchaseOrderGroup,
} from "@/lib/purchase-order";
import {
  computePoInvoiceMatches,
  fetchInvoicesForPoMatch,
  type InvoiceForPoMatch,
  type PoInvoiceMatchState,
} from "@/lib/po-invoice-match";
import { InvoiceMatchBadge } from "@/components/procurement/purchase-table";
import { ProcurementSummaryCard } from "@/components/procurement/procurement-summary-card";
import { ProcurementFilters } from "@/components/procurement/procurement-filters";
import { PurchaseTable } from "@/components/procurement/purchase-table";
import { AddPurchaseDialog } from "@/components/procurement/add-purchase-dialog";
import { EditPurchaseDialog } from "@/components/procurement/edit-purchase-dialog";
import { EditPurchaseOrderDialog } from "@/components/procurement/edit-purchase-order-dialog";
import { InvoiceScanQueue } from "@/components/procurement/invoice-scan-queue";
import { exportProcurementCsv } from "@/components/procurement/export-procurement-csv";
import { compressInvoiceFileForStorage } from "@/lib/invoice-file";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Download } from "lucide-react";
import { toast } from "sonner";

const PURCHASE_TAX_FIELDS =
  "unit_price, unit_price_is_tax_inclusive, unit_price_ex_tax, unit_price_inc_tax, amount_ex_tax, tax_included_amount";

const PURCHASE_LINE_FIELDS =
  `item_name, item_category, spec, spec2, quantity, unit, material_id, amortization_months, ${PURCHASE_TAX_FIELDS}`;

const SELECT_WITH_VENDOR_REL =
  `id, purchase_date, ${PURCHASE_LINE_FIELDS}, vendor(id, name, notes), procurement_materials(notes)`;

const SELECT_WITH_VENDOR_ID =
  `id, purchase_date, vendor_id, ${PURCHASE_LINE_FIELDS}, vendors(name, notes), procurement_materials(notes)`;

/** 採購單單頭內嵌（purchases.purchase_order_id → purchase_orders） */
type PurchaseOrderEmbed = {
  po_number?: string | null;
  notes?: string | null;
  invoice_files?: unknown;
} | {
  po_number?: string | null;
  notes?: string | null;
  invoice_files?: unknown;
}[] | null;

type SupabaseRowVendorRel = {
  id: string;
  purchase_date: string;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  spec2?: string | null;
  quantity?: number | string;
  unit?: string | null;
  material_id?: string | null;
  unit_price?: number | null;
  unit_price_is_tax_inclusive?: boolean | null;
  unit_price_ex_tax?: number | null;
  unit_price_inc_tax?: number | null;
  amount_ex_tax?: number | null;
  tax_included_amount: number;
  amortization_months?: number | null;
  vendor?: NameRel | string | { id?: string; name?: string; notes?: string | null } | null;
  procurement_materials?: { notes?: string | null } | null;
};

type SupabaseRowWithVendor = {
  id: string;
  purchase_date: string;
  vendor_id?: string | null;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  spec2?: string | null;
  quantity?: number | string;
  unit?: string | null;
  material_id?: string | null;
  unit_price?: number | null;
  unit_price_is_tax_inclusive?: boolean | null;
  unit_price_ex_tax?: number | null;
  unit_price_inc_tax?: number | null;
  amount_ex_tax?: number | null;
  tax_included_amount: number;
  amortization_months?: number | null;
  vendors: NameRel | { name?: string | null; notes?: string | null };
  procurement_materials?: { notes?: string | null } | null;
};

type SupabaseRowNoVendor = {
  id: string;
  purchase_date: string;
  purchase_order_id?: string | null;
  purchase_orders?: PurchaseOrderEmbed;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  spec2?: string | null;
  quantity?: number | string;
  unit?: string | null;
  material_id?: string | null;
  unit_price?: number | null;
  unit_price_is_tax_inclusive?: boolean | null;
  unit_price_ex_tax?: number | null;
  unit_price_inc_tax?: number | null;
  amount_ex_tax?: number | null;
  tax_included_amount: number;
  amortization_months?: number | null;
  vendor_name?: string | null;
  /** 由 purchases.vendor_name FK 內嵌之 vendors（僅載入 notes） */
  vendors?: { notes?: string | null } | { notes?: string | null }[] | null;
  procurement_materials?: { notes?: string | null } | null;
};

function vendorDisplayName(vendor: SupabaseRowVendorRel["vendor"]): string {
  if (vendor == null) return "—";
  if (typeof vendor === "string") return vendor.trim() || "—";
  if (typeof vendor === "object" && "name" in vendor) return (vendor.name as string)?.trim() || "—";
  return relName(vendor as NameRel) || "—";
}

function vendorIdFromRel(vendor: SupabaseRowVendorRel["vendor"]): string | undefined {
  if (vendor == null || typeof vendor !== "object") return undefined;
  if ("id" in vendor && typeof (vendor as { id?: string }).id === "string") return (vendor as { id: string }).id;
  return undefined;
}

function vendorNotesFromRel(vendor: SupabaseRowVendorRel["vendor"]): string | null {
  if (vendor == null || typeof vendor !== "object") return null;
  if (Array.isArray(vendor)) {
    const n = (vendor[0] as { notes?: unknown } | undefined)?.notes;
    return normalizedMaterialNotes(n);
  }
  if ("notes" in vendor) return normalizedMaterialNotes((vendor as { notes?: unknown }).notes);
  return null;
}

function vendorNotesFromVendorsJoin(vendors: SupabaseRowWithVendor["vendors"]): string | null {
  if (vendors == null) return null;
  if (Array.isArray(vendors)) {
    const n = (vendors[0] as { notes?: unknown } | undefined)?.notes;
    return normalizedMaterialNotes(n);
  }
  if (typeof vendors === "object" && "notes" in vendors) {
    return normalizedMaterialNotes((vendors as { notes?: unknown }).notes);
  }
  return null;
}

function vendorNotesFromNameFkEmbed(row: SupabaseRowNoVendor): string | null {
  const v = row.vendors;
  if (v == null) return null;
  if (Array.isArray(v)) {
    return normalizedMaterialNotes(v[0]?.notes);
  }
  return normalizedMaterialNotes(v.notes);
}
function normalizedMaterialNotes(notes: unknown): string | null {
  if (notes == null) return null;
  const t = String(notes).trim();
  return t || null;
}

/** 自 purchase_orders 內嵌取出單頭欄位（to-one 關聯通常為物件，防禦性處理陣列） */
function poFieldsFromEmbed(
  purchaseOrderId: string | null | undefined,
  embed: PurchaseOrderEmbed | undefined,
): Pick<PurchaseRow, "purchase_order_id" | "po_number" | "po_notes" | "po_invoice_files"> {
  const po = Array.isArray(embed) ? embed[0] : embed;
  return {
    purchase_order_id: purchaseOrderId ?? null,
    po_number: po?.po_number ?? null,
    po_notes: po?.notes ?? null,
    po_invoice_files: parseInvoiceFiles(po?.invoice_files),
  };
}

function specFieldsForPurchaseRow(
  mergedSpec: string | null | undefined,
  spec2Col: string | null | undefined,
  procurement_materials?: { notes?: string | null } | null,
): Pick<PurchaseRow, "spec" | "spec2" | "spec_primary" | "spec_secondary" | "material_notes"> {
  const merged = mergedSpec ?? "";
  const raw2 = spec2Col ?? null;
  const parts = purchaseSpecPartsForDisplay(merged, raw2);
  return {
    spec: merged,
    spec2: raw2,
    spec_primary: parts.primary,
    spec_secondary: parts.secondary,
    material_notes: normalizedMaterialNotes(procurement_materials?.notes),
  };
}

function parseQuantityForTax(q: string | number | undefined | null): number {
  if (q == null || q === "—" || q === "") return 0;
  const n = Number(q);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function mapPurchaseTaxFields(row: {
  unit_price?: number | null;
  unit_price_is_tax_inclusive?: boolean | null;
  unit_price_ex_tax?: number | null;
  unit_price_inc_tax?: number | null;
  amount_ex_tax?: number | null;
  tax_included_amount?: number | null;
  quantity?: number | string;
}): Pick<
  PurchaseRow,
  "unit_price" | "unit_price_is_tax_inclusive" | "unit_price_ex_tax" | "unit_price_inc_tax" | "amount_ex_tax" | "tax_included_amount"
> {
  const up = Number(row.unit_price ?? 0);
  const qty = parseQuantityForTax(row.quantity);
  const flag = Boolean(row.unit_price_is_tax_inclusive);
  const ex = row.unit_price_ex_tax != null ? Number(row.unit_price_ex_tax) : NaN;
  const inc = row.unit_price_inc_tax != null ? Number(row.unit_price_inc_tax) : NaN;
  const amtEx = row.amount_ex_tax != null ? Number(row.amount_ex_tax) : NaN;
  const taxInc = row.tax_included_amount != null ? Number(row.tax_included_amount) : NaN;
  const complete = [ex, inc, amtEx, taxInc].every((n) => Number.isFinite(n));
  const line = complete
    ? { unit_price_ex_tax: ex, unit_price_inc_tax: inc, amount_ex_tax: amtEx, tax_included_amount: taxInc }
    : computePurchaseLinePrices(up, qty, flag);
  return {
    unit_price: up,
    unit_price_is_tax_inclusive: flag,
    unit_price_ex_tax: roundMoney2(line.unit_price_ex_tax),
    unit_price_inc_tax: roundMoney2(line.unit_price_inc_tax),
    amount_ex_tax: roundMoney2(line.amount_ex_tax),
    tax_included_amount: roundMoney2(line.tax_included_amount),
  };
}

function mapRowVendorRel(row: SupabaseRowVendorRel): PurchaseRow {
  return {
    id: row.id,
    purchase_date: formatDate(row.purchase_date),
    vendor_name: vendorDisplayName(row.vendor),
    vendor_notes: vendorNotesFromRel(row.vendor),
    vendor_id: vendorIdFromRel(row.vendor),
    material_id: row.material_id ?? undefined,
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    ...specFieldsForPurchaseRow(row.spec ?? "", row.spec2 ?? null, row.procurement_materials),
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    amortization_months: row.amortization_months ?? null,
    ...mapPurchaseTaxFields(row),
  };
}

function mapRowWithVendor(row: SupabaseRowWithVendor): PurchaseRow {
  return {
    id: row.id,
    purchase_date: formatDate(row.purchase_date),
    vendor_name: relName(row.vendors) || "—",
    vendor_notes: vendorNotesFromVendorsJoin(row.vendors),
    vendor_id: row.vendor_id ?? undefined,
    material_id: row.material_id ?? undefined,
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    ...specFieldsForPurchaseRow(row.spec ?? "", row.spec2 ?? null, row.procurement_materials),
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    amortization_months: row.amortization_months ?? null,
    ...mapPurchaseTaxFields(row),
  };
}

function mapRowNoVendor(row: SupabaseRowNoVendor): PurchaseRow {
  return {
    id: row.id,
    ...poFieldsFromEmbed(row.purchase_order_id, row.purchase_orders),
    purchase_date: formatDate(row.purchase_date),
    vendor_name: row.vendor_name?.trim() || "—",
    vendor_notes: vendorNotesFromNameFkEmbed(row),
    vendor_id: undefined,
    material_id: row.material_id ?? undefined,
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    ...specFieldsForPurchaseRow(row.spec ?? "", row.spec2 ?? null, row.procurement_materials),
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    amortization_months: row.amortization_months ?? null,
    ...mapPurchaseTaxFields(row),
  };
}

export interface ProcurementPurchasesTabProps {
  onNavigateToVendors?: () => void;
  isAdmin?: boolean;
}

export function ProcurementPurchasesTab({ onNavigateToVendors, isAdmin = false }: ProcurementPurchasesTabProps) {
  const router = useRouter();
  const [records, setRecords] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterItemName, setFilterItemName] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterInvoiceMatch, setFilterInvoiceMatch] = useState<"" | PoInvoiceMatchState>("");
  const [editRow, setEditRow] = useState<PurchaseRow | null>(null);
  const [editGroup, setEditGroup] = useState<PurchaseOrderGroup | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<PurchaseRow | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<PurchaseOrderGroup | null>(null);
  const [invoiceUploadTarget, setInvoiceUploadTarget] = useState<PurchaseOrderGroup | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const invoiceFileInputRef = useRef<HTMLInputElement>(null);
  /** 已存檔發票（判斷各採購單「已對應／有相符／無對應」用） */
  const [invoicesForMatch, setInvoicesForMatch] = useState<InvoiceForPoMatch[]>([]);

  async function fetchPurchases() {
    setLoading(true);
    void fetchInvoicesForPoMatch().then(setInvoicesForMatch);

    const resWithPo = await supabase
      .from("purchases")
      .select(
        `id, purchase_date, ${PURCHASE_LINE_FIELDS}, vendor_name, purchase_order_id, purchase_orders(po_number, notes, invoice_files), procurement_materials(notes), vendors(notes)`,
      )
      .is("deleted_at", null)
      .order("purchase_date", { ascending: false });

    if (!resWithPo.error && resWithPo.data) {
      setRecords((resWithPo.data as SupabaseRowNoVendor[]).map(mapRowNoVendor));
      setLoading(false);
      return;
    }

    const resVendorName = await supabase
      .from("purchases")
      .select(`id, purchase_date, ${PURCHASE_LINE_FIELDS}, vendor_name, procurement_materials(notes), vendors(notes)`)
      .is("deleted_at", null)
      .order("purchase_date", { ascending: false });

    if (!resVendorName.error && resVendorName.data) {
      setRecords((resVendorName.data as SupabaseRowNoVendor[]).map(mapRowNoVendor));
      setLoading(false);
      return;
    }

    const resRel = await supabase
      .from("purchases")
      .select(SELECT_WITH_VENDOR_REL)
      .is("deleted_at", null)
      .order("purchase_date", { ascending: false });
    if (!resRel.error && resRel.data) {
      setRecords(((resRel.data ?? []) as SupabaseRowVendorRel[]).map(mapRowVendorRel));
      setLoading(false);
      return;
    }

    const res2 = await supabase
      .from("purchases")
      .select(SELECT_WITH_VENDOR_ID)
      .is("deleted_at", null)
      .order("purchase_date", { ascending: false });
    if (!res2.error && res2.data) {
      setRecords(((res2.data ?? []) as unknown as SupabaseRowWithVendor[]).map(mapRowWithVendor));
      setLoading(false);
      return;
    }

    const fallback = await supabase
      .from("purchases")
      .select(`id, purchase_date, ${PURCHASE_LINE_FIELDS}, procurement_materials(notes)`)
      .is("deleted_at", null)
      .order("purchase_date", { ascending: false });

    if (fallback.error) {
      console.error("採購資料讀取失敗:", fallback.error.message);
      setRecords([]);
      setLoading(false);
      return;
    }

    const rows = (fallback.data ?? []) as (SupabaseRowNoVendor & { unit_price?: number | null })[];
    setRecords(rows.map((r) => mapRowNoVendor({
      ...r,
      unit_price: r.unit_price ?? undefined,
      vendor_name: undefined,
    })));
    setLoading(false);
  }

  useEffect(() => {
    fetchPurchases();
  }, []);

  function handleYearChange(year: string) {
    setFilterYear(year);
    if (filterMonth && year && filterMonth.slice(0, 4) !== year) {
      setFilterMonth("");
    }
  }

  function handleMonthChange(month: string) {
    setFilterMonth(month);
    if (month) {
      setFilterYear(month.slice(0, 4));
    }
  }

  const filteredRecords = records.filter((r) => {
    if (filterMonth) {
      if (r.purchase_date.slice(0, 7) !== filterMonth) return false;
    } else if (filterYear && r.purchase_date.slice(0, 4) !== filterYear) {
      return false;
    }
    if (filterCategory && r.item_category !== filterCategory) return false;
    if (filterVendor && r.vendor_id !== filterVendor && r.vendor_name !== filterVendor) return false;
    if (filterItemName && r.item_name !== filterItemName) return false;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      const text = [
        r.po_number ?? "",
        r.vendor_name,
        r.vendor_notes ?? "",
        r.item_name,
        r.item_category,
        r.spec,
        r.spec_primary,
        r.spec_secondary,
        r.material_notes ?? "",
        r.unit,
        String(r.quantity),
      ]
        .join(" ")
        .toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  /** 各採購單的發票對應狀態（key=group.key）；以未篩選的全部採購單計算，避免相符發票被篩掉的單搶走 */
  const invoiceMatches = useMemo(
    () => computePoInvoiceMatches(groupPurchaseRows(records), invoicesForMatch),
    [records, invoicesForMatch],
  );

  /** 明細列所屬採購單的對應狀態（分組 key 與 groupPurchaseRows 同規則） */
  function rowMatchState(r: PurchaseRow): PoInvoiceMatchState {
    return invoiceMatches.get(r.purchase_order_id ?? `line-${r.id}`)?.state ?? "none";
  }

  /** 對應發票篩選套用後的明細列（表格、手機卡片、CSV 匯出共用） */
  const matchFilteredRecords = filterInvoiceMatch
    ? filteredRecords.filter((r) => rowMatchState(r) === filterInvoiceMatch)
    : filteredRecords;
  const filteredGroups = groupPurchaseRows(matchFilteredRecords);

  /** 各狀態張數（以其他篩選條件套用後計，供篩選選單顯示） */
  const invoiceMatchCounts = (() => {
    const counts: Record<PoInvoiceMatchState, number> = { matched: 0, candidate: 0, none: 0 };
    for (const g of groupPurchaseRows(filteredRecords)) {
      counts[invoiceMatches.get(g.key)?.state ?? "none"] += 1;
    }
    return counts;
  })();

  /** 點「有相符」徽章：切到會計管理並帶入發票號碼搜尋，在發票端完成對應 */
  function openInvoicePage(invoiceNumber: string) {
    router.push(`/?page=accounting&invoiceSearch=${encodeURIComponent(invoiceNumber)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const thisYear = new Date().getFullYear();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const startRecent = oneYearAgo.toISOString().slice(0, 10);

  const recordsForSummary = records.filter((r) => {
    const inDateRange = filterMonth
      ? r.purchase_date.slice(0, 7) === filterMonth
      : filterYear
        ? r.purchase_date >= `${filterYear}-01-01` && r.purchase_date <= `${filterYear}-12-31`
        : filterCategory
          ? r.purchase_date >= `${thisYear}-01-01` && r.purchase_date <= today
          : r.purchase_date >= startRecent && r.purchase_date <= today;
    if (!inDateRange) return false;
    if (filterCategory && r.item_category !== filterCategory) return false;
    if (filterVendor && r.vendor_id !== filterVendor && r.vendor_name !== filterVendor) return false;
    if (filterItemName && r.item_name !== filterItemName) return false;
    return true;
  });
  const totalSpent = recordsForSummary.reduce((sum, r) => sum + r.tax_included_amount, 0);

  const summaryPeriod = filterMonth
    ? filterMonth
    : filterYear
      ? `${filterYear}年`
      : filterCategory
        ? "今年"
        : "最近一年";
  const summaryLabel = filterCategory
    ? `${filterCategory} ${summaryPeriod}採購總計`
    : `${summaryPeriod}採購總計`;

  function requestDelete(row: PurchaseRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase
      .from("purchases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除進貨紀錄");
    fetchPurchases();
  }

  async function performDeleteGroup() {
    if (!deleteConfirmGroup) return;
    const group = deleteConfirmGroup;
    setDeleteConfirmGroup(null);
    const now = new Date().toISOString();
    if (group.purchase_order_id) {
      const { error } = await supabase
        .from("purchases")
        .update({ deleted_at: now })
        .eq("purchase_order_id", group.purchase_order_id);
      if (error) {
        toast.error(error.message || "刪除失敗");
        return;
      }
      await supabase
        .from("purchase_orders")
        .update({ deleted_at: now })
        .eq("id", group.purchase_order_id);
    } else {
      const ids = group.lines.map((l) => l.id);
      const { error } = await supabase
        .from("purchases")
        .update({ deleted_at: now })
        .in("id", ids);
      if (error) {
        toast.error(error.message || "刪除失敗");
        return;
      }
    }
    toast.success("已刪除採購單");
    fetchPurchases();
  }

  function requestUploadInvoice(group: PurchaseOrderGroup) {
    setInvoiceUploadTarget(group);
    invoiceFileInputRef.current?.click();
  }

  async function handleInvoiceFileSelected(file: File | null) {
    const target = invoiceUploadTarget;
    setInvoiceUploadTarget(null);
    if (!file || !target?.purchase_order_id) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("請選擇圖片或 PDF 檔案");
      return;
    }
    setUploadingInvoice(true);
    try {
      const { blob, ext } = await compressInvoiceFileForStorage(file);
      const path = `${target.purchase_order_id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await supabase.storage
        .from("purchase-invoices")
        .upload(path, blob, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("purchase-invoices").getPublicUrl(data.path);
      const nextFiles: InvoiceFile[] = [
        ...target.invoice_files,
        { url: publicUrl, path: data.path, name: file.name, uploaded_at: new Date().toISOString() },
      ];
      const { error: updErr } = await supabase
        .from("purchase_orders")
        .update({ invoice_files: nextFiles as unknown as Json })
        .eq("id", target.purchase_order_id);
      if (updErr) throw updErr;
      toast.success("請款單已上傳");
      fetchPurchases();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "請款單上傳失敗");
    } finally {
      setUploadingInvoice(false);
      if (invoiceFileInputRef.current) invoiceFileInputRef.current.value = "";
    }
  }

  function handleExport() {
    if (matchFilteredRecords.length === 0) {
      toast.info("目前沒有可匯出的資料");
      return;
    }
    exportProcurementCsv(matchFilteredRecords);
    toast.success("已匯出 CSV");
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="載入中">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          </div>
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <p className="sr-only">載入採購資料中…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ProcurementSummaryCard summaryLabel={summaryLabel} totalSpent={totalSpent}>
        <div className="flex flex-wrap items-center gap-2">
          <AddPurchaseDialog onSuccess={fetchPurchases} onNavigateToVendors={onNavigateToVendors} />
          {isAdmin && (
            <Button
              variant="outline"
              className="h-8 shrink-0 px-3 text-xs"
              onClick={handleExport}
              disabled={filteredRecords.length === 0}
              aria-label="匯出篩選結果為 CSV"
            >
              <Download className="h-4 w-4" />
              匯出 CSV
            </Button>
          )}
        </div>
      </ProcurementSummaryCard>

      <input
        ref={invoiceFileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        aria-label="上傳請款單附件"
        onChange={(e) => handleInvoiceFileSelected(e.target.files?.[0] ?? null)}
      />
      {uploadingInvoice && (
        <p className="text-xs text-muted-foreground" role="status">請款單上傳中…</p>
      )}

      <InvoiceScanQueue onArchived={fetchPurchases} />

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <ProcurementFilters
          filterYear={filterYear}
          filterMonth={filterMonth}
          filterCategory={filterCategory}
          filterVendor={filterVendor}
          filterItemName={filterItemName}
          filterSearch={filterSearch}
          filterInvoiceMatch={filterInvoiceMatch}
          invoiceMatchCounts={invoiceMatchCounts}
          onYearChange={handleYearChange}
          onMonthChange={handleMonthChange}
          onCategoryChange={setFilterCategory}
          onVendorChange={setFilterVendor}
          onItemNameChange={setFilterItemName}
          onSearchChange={setFilterSearch}
          onInvoiceMatchChange={setFilterInvoiceMatch}
          records={records}
        />
        <PurchaseTable
          groups={filteredGroups}
          totalUnfilteredCount={records.length}
          invoiceMatches={invoiceMatches}
          onOpenInvoice={openInvoicePage}
          onEdit={setEditRow}
          onDelete={requestDelete}
          onEditGroup={setEditGroup}
          onDeleteGroup={setDeleteConfirmGroup}
          onUploadInvoice={requestUploadInvoice}
        />
      </div>

      <EditPurchaseDialog
        open={editRow != null}
        onOpenChange={(open) => !open && setEditRow(null)}
        row={editRow}
        onSuccess={() => {
          setEditRow(null);
          fetchPurchases();
        }}
      />

      <EditPurchaseOrderDialog
        open={editGroup != null}
        onOpenChange={(open) => !open && setEditGroup(null)}
        group={editGroup}
        onSuccess={() => {
          setEditGroup(null);
          fetchPurchases();
        }}
      />

      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除此筆採購品項？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">品項：{deleteConfirmRow.item_name ?? "—"}</p>
              <p className="text-muted-foreground">日期：{deleteConfirmRow.purchase_date ?? "—"}</p>
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />

      <ConfirmDialog
        open={deleteConfirmGroup != null}
        onOpenChange={(open) => !open && setDeleteConfirmGroup(null)}
        title="是否確定刪除整張採購單？"
        description={
          deleteConfirmGroup ? (
            <>
              <p className="font-medium text-foreground">
                單號：{displayPoNumber(deleteConfirmGroup.po_number)}
              </p>
              <p className="text-muted-foreground">廠商：{deleteConfirmGroup.vendor_name}</p>
              <p className="text-muted-foreground">
                共 {deleteConfirmGroup.lines.length} 筆品項，含稅總計 $
                {deleteConfirmGroup.total_inc_tax.toLocaleString()}
              </p>
              <p className="mt-2 text-muted-foreground">單內所有品項將一併刪除，此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDeleteGroup}
        destructive
      />

      <div className="flex flex-col gap-3 sm:hidden">
        <p className="text-xs font-semibold text-muted-foreground">採購單</p>
        {filteredGroups.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            {records.length === 0 ? "尚無採購紀錄" : "無符合篩選條件的紀錄"}
          </p>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.key} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-xs text-primary">{displayPoNumber(group.po_number)}</span>
                  <InvoiceMatchBadge match={invoiceMatches.get(group.key)} onOpenInvoice={openInvoicePage} />
                </span>
                <span className="text-xs text-muted-foreground">{group.purchase_date}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {group.vendor_name}
                  {group.vendor_notes?.trim() ? (
                    <span className="text-muted-foreground font-normal">&nbsp;（{group.vendor_notes.trim()}）</span>
                  ) : null}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  ${group.total_inc_tax.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                {group.lines.map((record) => (
                  <div key={record.id} className="text-xs text-muted-foreground">
                    <p className="text-foreground">{record.item_name}</p>
                    <p>
                      {[
                        record.spec_primary.trim() ? `規格 ${record.spec_primary}` : null,
                        record.quantity !== "—" ? `數量 ${record.quantity} ${record.unit || ""}`.trim() : null,
                        `含稅 $${record.tax_included_amount.toLocaleString()}`,
                      ]
                        .filter(Boolean)
                        .join("｜")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
