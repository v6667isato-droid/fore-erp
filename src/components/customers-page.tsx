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
import { Users, Eye, Pencil, Trash2 } from "lucide-react";
import { AddCustomerDialog } from "@/components/crm/add-customer-dialog";
import { ViewCustomerDialog } from "@/components/crm/view-customer-dialog";
import { EditCustomerDialog } from "@/components/crm/edit-customer-dialog";
import { toast } from "sonner";

const CUSTOMER_SELECT =
  "id, name, phone, line_id, ig_account, delivery_address, notes, source, customer_type";

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
  };
}

function SocialCell({ lineId, igAccount }: { lineId: string | null | undefined; igAccount: string | null | undefined }) {
  const parts: string[] = [];
  if (lineId?.trim()) parts.push(`LINE: ${lineId.trim()}`);
  if (igAccount?.trim()) parts.push(`IG: ${igAccount.trim()}`);
  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;
  return <span className="text-sm">{parts.join(" · ")}</span>;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState("");
  const [viewRow, setViewRow] = useState<CustomerRow | null>(null);
  const [editRow, setEditRow] = useState<CustomerRow | null>(null);

  const sources = useMemo(() => {
    return [...new Set(customers.map((c) => c.source).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b))
    );
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

  useEffect(() => {
    fetchCustomers();
  }, []);

  async function handleDelete(row: CustomerRow) {
    if (!confirm(`確定要刪除客戶「${row.name || "未命名"}」？此操作無法復原。`)) return;
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
        <AddCustomerDialog onSuccess={fetchCustomers} />
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
              <TableHead className="text-xs font-semibold p-2 align-middle">社群帳號</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客戶來源</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客戶種類</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">送貨地址</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">客情備註</TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle min-w-[140px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {customers.length === 0
                    ? "尚無客戶資料，請點「新增客戶」建立第一筆。"
                    : "無符合篩選條件的客戶。"}
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((row) => (
                <TableRow key={row.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="text-sm font-medium p-2">{row.name || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm p-2">
                    <SocialCell lineId={row.line_id} igAccount={row.ig_account} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.customer_type ?? "—"}
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
                        onClick={() => setViewRow(row)}
                        aria-label={`總覽 ${row.name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
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
                        onClick={() => handleDelete(row)}
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
        onSuccess={() => {
          fetchCustomers();
          setEditRow(null);
        }}
      />
    </div>
  );
}
