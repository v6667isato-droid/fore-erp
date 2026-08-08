"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerRow } from "@/types/crm";
import { Users, Pencil, Trash2, Download, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { AddCustomerDialog } from "@/components/crm/add-customer-dialog";
import { ViewCustomerDialog } from "@/components/crm/view-customer-dialog";
import { EditCustomerDialog } from "@/components/crm/edit-customer-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { exportCustomersCsv } from "@/components/crm/export-customers-csv";
import { ChannelsPage } from "@/components/channels-page";

type CustomersTabId = "customers" | "channels";

function parseCustomersTab(raw: string | null): CustomersTabId {
  return raw === "channels" ? "channels" : "customers";
}

const CUSTOMER_SELECT =
  "id, name, alias, contact_person, brand_name, company, tax_id, phone, line_id, ig_account, delivery_address, has_elevator, notes, source, customer_type, channel_id, contact_method, created_at";

function mapCustomerRow(r: Record<string, unknown>): CustomerRow {
  const addr = r.delivery_address ?? r.address;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    alias: r.alias != null ? String(r.alias) : null,
    contact_person: (r as any).contact_person != null ? String((r as any).contact_person) : null,
    brand_name: (r as any).brand_name != null ? String((r as any).brand_name) : null,
    company: (r as any).company != null ? String((r as any).company) : null,
    tax_id: (r as any).tax_id != null ? String((r as any).tax_id) : null,
    phone: r.phone != null ? String(r.phone) : null,
    line_id: r.line_id != null ? String(r.line_id) : null,
    ig_account: r.ig_account != null ? String(r.ig_account) : null,
    delivery_address: addr != null ? String(addr) : null,
    has_elevator: typeof r.has_elevator === "boolean" ? r.has_elevator : null,
    notes: r.notes != null ? String(r.notes) : null,
    source: r.source != null ? String(r.source) : null,
    customer_type: r.customer_type != null ? String(r.customer_type) : null,
    channel_id: r.channel_id != null ? String(r.channel_id) : null,
    contact_method: r.contact_method != null ? String(r.contact_method) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
  };
}

function contactMethodLabel(method: string | null | undefined): string | null {
  const v = (method ?? "").toLowerCase();
  if (!v) return null;
  switch (v) {
    case "line":
      return "LINE";
    case "ig":
      return "IG";
    case "fb":
      return "FB";
    case "email":
      return "Email";
    case "bingxueline":
      return "秉學Line";
    case "others":
      return "Others";
    default:
      return method ?? null;
  }
}

function ContactCell({ row }: { row: CustomerRow }) {
  const label = contactMethodLabel(row.contact_method);
  if (!label) return <span className="text-muted-foreground">—</span>;
  return <span className="text-sm">{label}</span>;
}

function shippingCity(address: string | null | undefined): string | null {
  const raw = (address ?? "").trim();
  if (!raw) return null;
  // 嘗試抓出「XX市」或「XX縣」開頭
  const match = raw.match(/^(.{1,4}?[市縣])/);
  if (match && match[1]) return match[1];
  return null;
}

export interface ChannelOption {
  id: string;
  name: string;
}

type CustomerSortKey = "name" | "contact_method" | "source" | "customer_type" | "city" | "created_at";

export function CustomersPage({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customersTab = parseCustomersTab(searchParams.get("customersTab"));

  const setCustomersTab = useCallback(
    (next: CustomersTabId) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("page", "customers");
      if (next === "channels") nextParams.set("customersTab", "channels");
      else nextParams.delete("customersTab");
      router.replace(`/?${nextParams.toString()}`);
    },
    [router, searchParams]
  );

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState("");
  const [filterCustomerType, setFilterCustomerType] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<CustomerSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [viewRow, setViewRow] = useState<CustomerRow | null>(null);
  const [editRow, setEditRow] = useState<CustomerRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<CustomerRow | null>(null);

  const channelMap = useMemo(() => {
    const m: Record<string, string> = {};
    channels.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [channels]);

  const sources = useMemo(() => {
    const vals = customers
      .map((c) => c.source ?? "")
      .filter((v) => v && v.trim().length > 0);
    const uniq = [...new Set(vals)] as string[];
    return uniq.sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const customerTypes = useMemo(() => {
    const vals = customers
      .map((c) => c.customer_type ?? "")
      .filter((v) => v && v.trim().length > 0);
    const uniq = [...new Set(vals)] as string[];
    return uniq.sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    let list = customers;
    if (filterSource) {
      list = list.filter((c) => c.source === filterSource);
    }
    if (filterCustomerType) {
      list = list.filter((c) => c.customer_type === filterCustomerType);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter((c: any) => {
        const name = (c.name ?? "").toLowerCase();
        const alias = (c.alias ?? "").toLowerCase();
        const contact = (c.contact_person ?? "").toLowerCase();
        const phone = (c.phone ?? "").toLowerCase();
        return (
          name.includes(q) ||
          alias.includes(q) ||
          contact.includes(q) ||
          phone.includes(q)
        );
      });
    }
    return list;
  }, [customers, filterSource, filterCustomerType, searchTerm]);

  const sortedCustomers = useMemo(() => {
    const list = [...filteredCustomers];
    const factor = sortDirection === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const aCity = shippingCity(a.delivery_address) ?? "";
      const bCity = shippingCity(b.delivery_address) ?? "";
      const aContact = contactMethodLabel(a.contact_method) ?? "";
      const bContact = contactMethodLabel(b.contact_method) ?? "";

      const aValue =
        sortKey === "name"
          ? a.name ?? ""
          : sortKey === "contact_method"
            ? aContact
            : sortKey === "source"
              ? a.source ?? ""
              : sortKey === "customer_type"
                ? a.customer_type ?? ""
                : sortKey === "created_at"
                  ? a.created_at ?? ""
                  : aCity;
      const bValue =
        sortKey === "name"
          ? b.name ?? ""
          : sortKey === "contact_method"
            ? bContact
            : sortKey === "source"
              ? b.source ?? ""
              : sortKey === "customer_type"
                ? b.customer_type ?? ""
                : sortKey === "created_at"
                  ? b.created_at ?? ""
                  : bCity;

      return aValue.localeCompare(bValue, "zh-Hant", { sensitivity: "base" }) * factor;
    });
    return list;
  }, [filteredCustomers, sortDirection, sortKey]);

  function toggleSort(nextKey: CustomerSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  function SortIcon({ columnKey }: { columnKey: CustomerSortKey }) {
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    }
    if (sortDirection === "asc") {
      return <ArrowUp className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />;
    }
    return <ArrowDown className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />;
  }

  async function fetchCustomers() {
    setLoading(true);
    let { data, error }: any = await supabase
      .from("customers")
      .select(CUSTOMER_SELECT)
      .is("deleted_at", null)
      .order("id", { ascending: false });

    if (error) {
      let fallback: any = await supabase
        .from("customers")
        .select("id, name, phone, line_id, ig_account, address, notes, source, customer_type")
        .is("deleted_at", null)
        .order("id", { ascending: false });
      if (fallback.error) {
        fallback = await supabase
          .from("customers")
          .select("id, name, phone, line_id, ig_account, address, notes, source")
          .is("deleted_at", null)
          .order("id", { ascending: false });
      }
      if (fallback.error) {
        fallback = await supabase
          .from("customers")
          .select("id, name, phone, line_id, ig_account, address, notes")
          .is("deleted_at", null)
          .order("id", { ascending: false });
      }
      if (fallback.error) {
        const minimal: any = await supabase
          .from("customers")
          .select("id, name")
          .is("deleted_at", null)
          .order("id", { ascending: false });
        if (minimal.error) {
          setCustomers([]);
          setLoading(false);
          return;
        }
        data = minimal.data as any;
      } else {
        data = fallback.data;
      }
    }

    setCustomers(((data ?? []) as Record<string, unknown>[]).map(mapCustomerRow));
    setLoading(false);
  }

  async function fetchChannels() {
    const { data } = await supabase.from("channels").select("id, name").order("sort_order").order("name");
    setChannels(((data ?? []) as ChannelOption[]).map((r) => ({ id: r.id, name: String(r.name ?? "") })));
  }

  useEffect(() => {
    void fetchCustomers();
  }, []);

  useEffect(() => {
    if (customersTab === "customers") void fetchChannels();
  }, [customersTab]);

  function requestDelete(row: CustomerRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase
      .from("customers")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除客戶");
    fetchCustomers();
    setViewRow(null);
    setEditRow(null);
  }

  function handleExport() {
    const list = filteredCustomers;
    if (!list.length) {
      toast.info("目前沒有可匯出的客戶資料");
      return;
    }
    exportCustomersCsv(list);
    toast.success("已匯出客戶 CSV");
  }

  const tabList = (
    <div
      className="flex gap-1 border-b border-border"
      role="tablist"
      aria-label="客戶資料分頁"
    >
      <button
        type="button"
        role="tab"
        aria-selected={customersTab === "customers"}
        onClick={() => setCustomersTab("customers")}
        className={cn(
          "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
          customersTab === "customers"
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        客戶清單
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={customersTab === "channels"}
        onClick={() => setCustomersTab("channels")}
        className={cn(
          "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
          customersTab === "channels"
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        通路管理
      </button>
    </div>
  );

  if (customersTab === "channels") {
    return (
      <div className="flex flex-col gap-4">
        {tabList}
        <ChannelsPage embedded />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {tabList}
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入客戶資料中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tabList}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              累積客戶總數
            </p>
            <p className="text-xl font-semibold text-foreground">{customers.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AddCustomerDialog channels={channels} onSuccess={fetchCustomers} />
          {isAdmin && (
            <Button
              variant="outline"
              className="h-8 shrink-0 px-3 text-xs"
              onClick={handleExport}
              disabled={!filteredCustomers.length}
              aria-label="匯出客戶 CSV"
            >
              <Download className="h-4 w-4" />
              匯出 CSV
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選</span>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依來源篩選"
          >
            <option value="">客戶來源：全部</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={filterCustomerType}
            onChange={(e) => setFilterCustomerType(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依客戶種類篩選"
          >
            <option value="">客戶種類：全部</option>
            {customerTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {(filterSource || filterCustomerType) && (
            <button
              type="button"
              onClick={() => {
                setFilterSource("");
                setFilterCustomerType("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1"
            >
              清除篩選
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋客戶姓名 / 別名 / 聯絡人 / 電話"
              className="h-8 w-52 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">
              共 {filteredCustomers.length} 筆{filterSource || filterCustomerType || searchTerm ? "（已篩選）" : ""}
            </span>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("name")}
                  aria-label="依客戶姓名排序"
                >
                  客戶姓名
                  <SortIcon columnKey="name" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("contact_method")}
                  aria-label="依聯絡方式排序"
                >
                  聯絡方式
                  <SortIcon columnKey="contact_method" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("source")}
                  aria-label="依客戶來源排序"
                >
                  客戶來源
                  <SortIcon columnKey="source" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("customer_type")}
                  aria-label="依客戶種類排序"
                >
                  客戶種類
                  <SortIcon columnKey="customer_type" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("city")}
                  aria-label="依聯絡區域排序"
                >
                  聯絡區域
                  <SortIcon columnKey="city" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 select-none hover:text-foreground/90"
                  onClick={() => toggleSort("created_at")}
                  aria-label="依建立日期排序"
                >
                  建立日期
                  <SortIcon columnKey="created_at" />
                </button>
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle min-w-[140px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {customers.length === 0
                    ? "尚無客戶資料，請點「新增客戶」建立第一筆。"
                    : "無符合篩選條件的客戶。"}
                </TableCell>
              </TableRow>
            ) : (
              sortedCustomers.map((row) => (
                <TableRow key={row.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="align-middle whitespace-nowrap text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setViewRow(row)}
                      className="flex flex-col items-start gap-0.5 text-left underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded-sm"
                    >
                      <span>{row.name || "—"}</span>
                      {row.alias && row.alias.trim() && (
                        <span className="text-xs text-muted-foreground">({row.alias.trim()})</span>
                      )}
                    </button>
                  </TableCell>
                      <TableCell className="text-sm text-muted-foreground p-2">
                        <ContactCell row={row} />
                      </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.customer_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {shippingCity(row.delivery_address) ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground p-2">
                    {row.created_at ? String(row.created_at).slice(0, 10) : "—"}
                  </TableCell>
                  <TableCell className="p-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditRow(row)}
                        aria-label={`編輯 ${row.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(row); }}
                        aria-label={`刪除 ${row.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ViewCustomerDialog
        open={viewRow != null}
        onOpenChange={(open) => !open && setViewRow(null)}
        row={viewRow}
      />

      <EditCustomerDialog
        open={editRow != null}
        onOpenChange={(open) => !open && setEditRow(null)}
        row={editRow}
        channels={channels}
        onSuccess={() => {
          fetchCustomers();
          setEditRow(null);
        }}
      />

      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除客戶？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">客戶：「{deleteConfirmRow.name || "未命名"}」</p>
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
