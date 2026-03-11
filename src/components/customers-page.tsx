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
import type { CustomerRow } from "@/types/crm";
import { Users, Eye, Pencil, Trash2, Download } from "lucide-react";
import { AddCustomerDialog } from "@/components/crm/add-customer-dialog";
import { ViewCustomerDialog } from "@/components/crm/view-customer-dialog";
import { EditCustomerDialog } from "@/components/crm/edit-customer-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { exportCustomersCsv } from "@/components/crm/export-customers-csv";

const CUSTOMER_SELECT =
  "id, name, phone, line_id, ig_account, delivery_address, notes, source, customer_type, portal_code, portal_password, channel_id";

function mapCustomerRow(r: Record<string, unknown>): CustomerRow {
  const addr = r.delivery_address ?? r.address;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: r.phone != null ? String(r.phone) : null,
    line_id: r.line_id != null ? String(r.line_id) : null,
    ig_account: r.ig_account != null ? String(r.ig_account) : null,
    delivery_address: addr != null ? String(addr) : null,
    notes: r.notes != null ? String(r.notes) : null,
    source: r.source != null ? String(r.source) : null,
    customer_type: r.customer_type != null ? String(r.customer_type) : null,
    portal_code: r.portal_code != null ? String(r.portal_code) : null,
    portal_password: r.portal_password != null ? String(r.portal_password) : null,
    channel_id: r.channel_id != null ? String(r.channel_id) : null,
  };
}

function SocialCell({ lineId, igAccount }: { lineId: string | null | undefined; igAccount: string | null | undefined }) {
  const parts: string[] = [];
  if (lineId?.trim()) parts.push(`LINE: ${lineId.trim()}`);
  if (igAccount?.trim()) parts.push(`IG: ${igAccount.trim()}`);
  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;
  return <span className="text-sm">{parts.join(" · ")}</span>;
}

export interface ChannelOption {
  id: string;
  name: string;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [lastOrders, setLastOrders] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState("");
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

  const filteredCustomers = useMemo(() => {
    if (!filterSource) return customers;
    return customers.filter((c) => c.source === filterSource);
  }, [customers, filterSource]);

  async function fetchCustomers() {
    setLoading(true);
    let { data, error }: any = await supabase
      .from("customers")
      .select(CUSTOMER_SELECT)
      .order("id", { ascending: false });

    if (error) {
      let fallback: any = await supabase
        .from("customers")
        .select("id, name, phone, line_id, ig_account, address, notes, source, customer_type")
        .order("id", { ascending: false });
      if (fallback.error) {
        fallback = await supabase
          .from("customers")
          .select("id, name, phone, line_id, ig_account, address, notes, source")
          .order("id", { ascending: false });
      }
      if (fallback.error) {
        fallback = await supabase
          .from("customers")
          .select("id, name, phone, line_id, ig_account, address, notes")
          .order("id", { ascending: false });
      }
      if (fallback.error) {
        const minimal: any = await supabase
          .from("customers")
          .select("id, name")
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

  async function fetchLastOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("customer_id, order_date")
      .order("order_date", { ascending: false });
    if (error) {
      // 不影響主畫面，靜默失敗即可
      return;
    }
    const map: Record<string, string | null> = {};
    (data ?? []).forEach((row: any) => {
      const cid = row.customer_id ? String(row.customer_id) : "";
      if (!cid) return;
      if (map[cid] == null) {
        map[cid] = row.order_date ?? null;
      }
    });
    setLastOrders(map);
  }

  useEffect(() => {
    fetchCustomers();
    fetchChannels();
    fetchLastOrders();
  }, []);

  function requestDelete(row: CustomerRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase.from("customers").delete().eq("id", row.id);
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
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入客戶資料中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
          {filterSource && (
            <button
              type="button"
              onClick={() => setFilterSource("")}
              className="text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1"
            >
              清除篩選
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            共 {filteredCustomers.length} 筆{filterSource ? "（已篩選）" : ""}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 align-middle">客戶姓名</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">電話</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">最近訂購日期</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客戶來源</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客戶種類</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">所屬通路</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">送貨地址</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客情備註</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle min-w-[140px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  {customers.length === 0
                    ? "尚無客戶資料，請點「新增客戶」建立第一筆。"
                    : "無符合篩選條件的客戶。"}
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((row) => (
                <TableRow key={row.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setViewRow(row)}
                      className="text-left underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded-sm"
                    >
                      {row.name || "—"}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm p-2">
                    {lastOrders[row.id]
                      ? String(lastOrders[row.id]).slice(0, 10)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.customer_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.channel_id ? (channelMap[row.channel_id] ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2 max-w-[180px] truncate" title={row.delivery_address ?? undefined}>
                    {row.delivery_address ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2 max-w-[200px] truncate" title={row.notes ?? undefined}>
                    {row.notes ?? "—"}
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
