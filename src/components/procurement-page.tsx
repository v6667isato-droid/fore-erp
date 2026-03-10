"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { formatDate, relName } from "@/lib/utils";
import type { PurchaseRow, NameRel } from "@/types/procurement";
import { ProcurementSummaryCard } from "@/components/procurement/procurement-summary-card";
import { ProcurementFilters } from "@/components/procurement/procurement-filters";
import { PurchaseTable } from "@/components/procurement/purchase-table";
import { AddPurchaseDialog } from "@/components/procurement/add-purchase-dialog";
import { EditPurchaseDialog } from "@/components/procurement/edit-purchase-dialog";
import { exportProcurementCsv } from "@/components/procurement/export-procurement-csv";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Download } from "lucide-react";
import { toast } from "sonner";

/** purchases 表以關聯「vendor」連結 vendors 時使用（FK 欄位名為 vendor） */
const SELECT_WITH_VENDOR_REL =
  "id, purchase_date, item_name, item_category, spec, quantity, unit, unit_price, tax_included_amount, vendor(id, name)";

const SELECT_WITH_VENDOR_ID =
  "id, purchase_date, vendor_id, item_name, item_category, spec, quantity, unit, unit_price, tax_included_amount, vendors(name)";

type SupabaseRowVendorRel = {
  id: string;
  purchase_date: string;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | null;
  tax_included_amount: number;
  vendor?: NameRel | string | { id?: string; name?: string } | null;
};

type SupabaseRowWithVendor = {
  id: string;
  purchase_date: string;
  vendor_id?: string | null;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | null;
  tax_included_amount: number;
  vendors: NameRel;
};

type SupabaseRowNoVendor = {
  id: string;
  purchase_date: string;
  item_name: string;
  item_category?: string | null;
  spec?: string | null;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | null;
  tax_included_amount: number;
  vendor_name?: string | null;
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

function mapRowVendorRel(row: SupabaseRowVendorRel): PurchaseRow {
  return {
    id: row.id,
    purchase_date: formatDate(row.purchase_date),
    vendor_name: vendorDisplayName(row.vendor),
    vendor_id: vendorIdFromRel(row.vendor),
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    spec: row.spec ?? "",
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    unit_price: Number(row.unit_price ?? 0) ?? 0,
    tax_included_amount: Number(row.tax_included_amount) ?? 0,
  };
}

function mapRowWithVendor(row: SupabaseRowWithVendor): PurchaseRow {
  return {
    id: row.id,
    purchase_date: formatDate(row.purchase_date),
    vendor_name: relName(row.vendors) || "—",
    vendor_id: row.vendor_id ?? undefined,
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    spec: row.spec ?? "",
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    unit_price: Number(row.unit_price ?? 0) ?? 0,
    tax_included_amount: Number(row.tax_included_amount) ?? 0,
  };
}

function mapRowNoVendor(row: SupabaseRowNoVendor): PurchaseRow {
  return {
    id: row.id,
    purchase_date: formatDate(row.purchase_date),
    vendor_name: row.vendor_name?.trim() || "—",
    vendor_id: undefined,
    item_name: row.item_name ?? "—",
    item_category: row.item_category ?? "",
    spec: row.spec ?? "",
    quantity: row.quantity ?? "—",
    unit: row.unit ?? "",
    unit_price: Number(row.unit_price ?? 0) ?? 0,
    tax_included_amount: Number(row.tax_included_amount) ?? 0,
  };
}

export interface ProcurementPageProps {
  onNavigateToVendors?: () => void;
}

export function ProcurementPage({ onNavigateToVendors }: ProcurementPageProps) {
  const [records, setRecords] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterItemName, setFilterItemName] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [editRow, setEditRow] = useState<PurchaseRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<PurchaseRow | null>(null);

  async function fetchPurchases() {
    setLoading(true);

    // 1. 優先：資料庫使用 vendor_name 欄位（無 FK 關聯）
    const resVendorName = await supabase
      .from("purchases")
      .select("id, purchase_date, item_name, item_category, spec, quantity, unit, unit_price, tax_included_amount, vendor_name")
      .order("purchase_date", { ascending: false });

    if (!resVendorName.error && resVendorName.data) {
      setRecords((resVendorName.data as SupabaseRowNoVendor[]).map(mapRowNoVendor));
      setLoading(false);
      return;
    }

    // 2. 備援：purchases 以關聯「vendor」連結 vendors（FK 欄位名為 vendor 時）
    const resRel = await supabase
      .from("purchases")
      .select(SELECT_WITH_VENDOR_REL)
      .order("purchase_date", { ascending: false });
    if (!resRel.error && resRel.data) {
      setRecords(((resRel.data ?? []) as SupabaseRowVendorRel[]).map(mapRowVendorRel));
      setLoading(false);
      return;
    }

    // 3. 備援：含 vendor_id + vendors(name)
    const res2 = await supabase
      .from("purchases")
      .select(SELECT_WITH_VENDOR_ID)
      .order("purchase_date", { ascending: false });
    if (!res2.error && res2.data) {
      setRecords(((res2.data ?? []) as SupabaseRowWithVendor[]).map(mapRowWithVendor));
      setLoading(false);
      return;
    }

    // 4. 僅基本欄位（無 vendor_name、unit_price 時）
    const fallback = await supabase
      .from("purchases")
      .select("id, purchase_date, item_name, item_category, spec, quantity, unit, tax_included_amount")
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

  const filteredRecords = records.filter((r) => {
    if (filterYear && r.purchase_date.slice(0, 4) !== filterYear) return false;
    if (filterCategory && r.item_category !== filterCategory) return false;
    if (filterVendor && r.vendor_id !== filterVendor && r.vendor_name !== filterVendor) return false;
    if (filterItemName && r.item_name !== filterItemName) return false;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      const text = [r.vendor_name, r.item_name, r.item_category, r.spec, r.unit, String(r.quantity)].join(" ").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const today = new Date().toISOString().slice(0, 10);
  const thisYear = new Date().getFullYear();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const startRecent = oneYearAgo.toISOString().slice(0, 10);

  const recordsForSummary = records.filter((r) => {
    const inDateRange = filterYear
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

  const summaryLabel = filterCategory
    ? filterYear
      ? `${filterCategory} ${filterYear}年採購總計`
      : `${filterCategory} 今年採購總計`
    : filterYear
      ? `${filterYear}年採購總計`
      : "最近一年採購總計";

  function requestDelete(row: PurchaseRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase.from("purchases").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除進貨紀錄");
    fetchPurchases();
  }

  function handleExport() {
    if (filteredRecords.length === 0) {
      toast.info("目前沒有可匯出的資料");
      return;
    }
    exportProcurementCsv(filteredRecords);
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
          <AddPurchaseDialog onSuccess={fetchPurchases} onNavigateToVendors={onNavigateToVendors} purchases={records} />
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
        </div>
      </ProcurementSummaryCard>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <ProcurementFilters
          filterYear={filterYear}
          filterCategory={filterCategory}
          filterVendor={filterVendor}
          filterItemName={filterItemName}
          filterSearch={filterSearch}
          onYearChange={setFilterYear}
          onCategoryChange={setFilterCategory}
          onVendorChange={setFilterVendor}
          onItemNameChange={setFilterItemName}
          onSearchChange={setFilterSearch}
          records={records}
        />
        <PurchaseTable
          records={filteredRecords}
          totalUnfilteredCount={records.length}
          onEdit={setEditRow}
          onDelete={requestDelete}
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

      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除此筆採購紀錄？"
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

      <div className="flex flex-col gap-3 sm:hidden">
        <p className="text-xs font-semibold text-muted-foreground">採購明細</p>
        {filteredRecords.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            {records.length === 0 ? "尚無採購紀錄" : "無符合篩選條件的紀錄"}
          </p>
        ) : (
          filteredRecords.map((record) => (
            <div key={record.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{record.vendor_name}</span>
                <span className="text-sm font-semibold text-foreground">
                  ${record.tax_included_amount.toLocaleString()}
                </span>
              </div>
              {record.item_category ? (
                <p className="mt-0.5 text-xs text-muted-foreground">類別：{record.item_category}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">{record.item_name}</p>
              {record.spec ? (
                <p className="mt-0.5 text-xs text-muted-foreground">規格：{record.spec}</p>
              ) : null}
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  單價 ${Number(record.unit_price ?? 0).toLocaleString()}
                  {record.quantity !== "—" && ` · ${record.quantity} ${record.unit || ""}`.trim()}
                </span>
                <span>{record.purchase_date}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
