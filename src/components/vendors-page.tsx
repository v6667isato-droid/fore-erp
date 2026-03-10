"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { VendorRow } from "@/types/procurement";
import { Building2, Eye, Pencil, Trash2, Download, MapPin, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { AddVendorDialog } from "@/components/procurement/add-vendor-dialog";
import { EditVendorDialog } from "@/components/procurement/edit-vendor-dialog";
import { ViewVendorDialog } from "@/components/procurement/view-vendor-dialog";
import { exportVendorsCsv } from "@/components/procurement/export-vendors-csv";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

const VENDOR_SELECT = "id, name, main_category, contact_person, address, phone, email, fax, tax_id, notes, created_at, website";
const VENDOR_SELECT_NO_WEBSITE = "id, name, main_category, contact_person, address, phone, email, fax, tax_id, notes, created_at";
const PAGE_SIZE = 20;

function mapVendorRow(r: Record<string, unknown>): VendorRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    main_category: String(r.main_category ?? ""),
    contact_person: r.contact_person != null ? String(r.contact_person) : null,
    address: r.address != null ? String(r.address) : null,
    phone: r.phone != null ? String(r.phone) : null,
    email: r.email != null ? String(r.email) : null,
    fax: r.fax != null ? String(r.fax) : null,
    tax_id: r.tax_id != null ? String(r.tax_id) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
    website: r.website != null ? String(r.website) : null,
  };
}

export function VendorsPage() {
  const [records, setRecords] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewRow, setViewRow] = useState<VendorRow | null>(null);
  const [editRow, setEditRow] = useState<VendorRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<VendorRow | null>(null);
  const [page, setPage] = useState(0);
  type SortKey = "created_at" | "name" | "main_category" | "contact_person" | "phone" | "address" | "website";
  const [sortBy, setSortBy] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  const categories = useMemo(() => {
    return [...new Set(records.map((r) => r.main_category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredRecords = useMemo(() => {
    let list = records;
    if (filterCategory) list = list.filter((r) => r.main_category === filterCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.main_category || "").toLowerCase().includes(q) ||
          (r.contact_person || "").toLowerCase().includes(q) ||
          (r.address || "").toLowerCase().includes(q) ||
          (r.phone || "").toLowerCase().includes(q) ||
          (r.website || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = (a[sortBy] ?? "") as string;
      const bv = (b[sortBy] ?? "") as string;
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  }, [records, filterCategory, searchQuery, sortBy, sortAsc]);

  const totalPages = Math.max(1, Math.ceil((filteredRecords?.length ?? 0) / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageRecords = useMemo(() => {
    const list = filteredRecords ?? [];
    return list.slice(start, start + PAGE_SIZE);
  }, [filteredRecords, start]);

  useEffect(() => {
    setPage(0);
  }, [filterCategory, searchQuery]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortAsc((a) => !a);
    } else {
      setSortBy(key);
      setSortAsc(key === "created_at" ? false : true);
    }
  }
  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs font-semibold p-2 align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
        aria-label={`依${label}排序${active ? (sortAsc ? "升冪" : "降冪") : ""}`}
      >
        {label}
        {active ? (sortAsc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
    );
  }

  function googleMapsUrl(address: string | null | undefined): string {
    if (!address?.trim()) return "#";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
  }

  async function fetchVendors() {
    setLoading(true);
    let { data, error } = await supabase
      .from("vendors")
      .select(VENDOR_SELECT)
      .order("created_at", { ascending: false });

    if (error) {
      const noWebsite = await supabase.from("vendors").select(VENDOR_SELECT_NO_WEBSITE).order("created_at", { ascending: false });
      if (!noWebsite.error) {
        data = (noWebsite.data ?? []) as any;
      } else {
        const fallback: any = await supabase.from("vendors").select("id, name, main_category, contact_person, address, phone").order("id", { ascending: false });
        if (fallback.error) {
          const minimal: any = await supabase.from("vendors").select("id, name, main_category").order("id", { ascending: false });
          if (minimal.error) {
            setRecords([]);
            setLoading(false);
            return;
          }
          data = minimal.data;
        } else {
          data = fallback.data;
        }
      }
    }
    const rowsData = ((data ?? []) as unknown) as Record<string, unknown>[];
    setRecords(rowsData.map(mapVendorRow));
    setLoading(false);
  }

  useEffect(() => {
    fetchVendors();
  }, []);

  function requestDelete(row: VendorRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase.from("vendors").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除廠商");
    fetchVendors();
    setViewRow(null);
    setEditRow(null);
  }

  function handleExport() {
    const list = filteredRecords ?? [];
    if (list.length === 0) {
      toast.info("目前沒有可匯出的資料");
      return;
    }
    exportVendorsCsv(list);
    toast.success("已匯出 CSV");
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">載入廠商資料中…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">廠商總數</p>
            <p className="text-xl font-semibold text-foreground">{records.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AddVendorDialog onSuccess={fetchVendors} categoryOptions={categories} />
          <Button variant="outline" className="h-8 shrink-0 px-3 text-xs" onClick={handleExport} disabled={(filteredRecords?.length ?? 0) === 0} aria-label="匯出 CSV">
            <Download className="h-4 w-4" />
            匯出 CSV
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依類別篩選"
          >
            <option value="">類別：全部</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋廠商、類別、聯絡人、地址、網站…"
            className="h-8 min-w-[10rem] max-w-xs rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="搜尋廠商"
          />
          {(filterCategory || searchQuery.trim()) && (
            <button type="button" onClick={() => { setFilterCategory(""); setSearchQuery(""); }} className="text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1">清除篩選</button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">共 {(filteredRecords?.length ?? 0)} 筆{filterCategory || searchQuery.trim() ? "（已篩選）" : ""}</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="新增日期" sortKey="created_at" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="廠商名稱" sortKey="name" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="類別" sortKey="main_category" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="聯絡人" sortKey="contact_person" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="電話" sortKey="phone" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="地址" sortKey="address" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <SortHeader label="網站" sortKey="website" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle min-w-[140px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(filteredRecords?.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {records.length === 0 ? "尚無廠商資料，請點「新增廠商」建立第一筆。" : "無符合篩選條件的廠商。"}
                </TableCell>
              </TableRow>
            ) : (
              pageRecords.map((row) => (
                <TableRow key={row.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="text-sm text-muted-foreground p-2 whitespace-nowrap">{formatDate(row.created_at ?? "")}</TableCell>
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setViewRow(row)}
                      className="text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    >
                      {row.name || "—"}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.main_category || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.contact_person ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2 max-w-[200px]">
                    {row.address?.trim() ? (
                      <a
                        href={googleMapsUrl(row.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline truncate"
                        title={`在 Google 地圖開啟：${row.address}`}
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{row.address}</span>
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm p-2 max-w-[160px]">
                    {row.website?.trim() ? (
                      <a
                        href={row.website.trim().startsWith("http") ? row.website.trim() : `https://${row.website.trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block"
                        title={row.website.trim()}
                      >
                        {row.website.trim()}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewRow(row)} aria-label={`總覽 ${row.name}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(row)} aria-label={`編輯 ${row.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(row); }} aria-label={`刪除 ${row.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {(filteredRecords?.length ?? 0) > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <span className="text-xs text-muted-foreground">
              第 {page + 1} / {totalPages} 頁，共 {filteredRecords?.length ?? 0} 筆
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                上一頁
              </Button>
              <Button
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                下一頁
              </Button>
            </div>
          </div>
        )}
      </div>

      <ViewVendorDialog open={viewRow != null} onOpenChange={(open) => !open && setViewRow(null)} row={viewRow} />
      <EditVendorDialog open={editRow != null} onOpenChange={(open) => !open && setEditRow(null)} row={editRow} onSuccess={() => { fetchVendors(); setEditRow(null); }} categoryOptions={categories} />

      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除廠商？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">廠商：「{deleteConfirmRow.name || "未命名"}」</p>
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
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
