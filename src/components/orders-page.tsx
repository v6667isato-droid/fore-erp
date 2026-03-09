"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";

type OrderStatus = "待付訂" | "生產中" | "已結案";

interface OrderRow {
  id: string;
  order_number: string;
  expected_delivery: string;
  total_amount: number;
  status: OrderStatus;
  customer_name: string;
}

type NameRel = { name: string } | { name: string }[] | null | undefined;

function relName(rel: NameRel) {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.name ?? "" : rel.name ?? "";
}

const statusStyles: Record<OrderStatus, string> = {
  待付訂: "bg-[var(--badge-pending)] text-[var(--badge-pending-fg)] border-transparent",
  生產中: "bg-[var(--badge-progress)] text-[var(--badge-progress-fg)] border-transparent",
  已結案: "bg-[var(--badge-done)] text-[var(--badge-done-fg)] border-transparent",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={statusStyles[status] ?? ""}>
      {status}
    </Badge>
  );
}

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OrderStatus | "全部">("全部");

  useEffect(() => {
    async function fetchOrders() {
      setLoading(true);
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, expected_delivery, total_amount, status, customers(name)")
        .order("expected_delivery", { ascending: true });

      if (error) {
        console.error("訂單讀取失敗:", error);
        setOrders([]);
      } else {
        const rows = (data ?? []) as Array<{
          id: string;
          order_number: string;
          expected_delivery: string | null;
          total_amount: number;
          status: string;
          customers: NameRel;
        }>;
        setOrders(
          rows.map((row) => ({
            id: row.id,
            order_number: row.order_number,
            expected_delivery: row.expected_delivery ?? "",
            total_amount: Number(row.total_amount) ?? 0,
            status: (row.status as OrderStatus) || "待付訂",
            customer_name: relName(row.customers),
          }))
        );
      }
      setLoading(false);
    }
    fetchOrders();
  }, []);

  const filtered = orders.filter((o) => {
    const matchSearch =
      search === "" ||
      (o.order_number && o.order_number.toLowerCase().includes(search.toLowerCase())) ||
      o.customer_name.includes(search);
    const matchFilter = filter === "全部" || o.status === filter;
    return matchSearch && matchFilter;
  });

  const filters: (OrderStatus | "全部")[] = ["全部", "待付訂", "生產中", "已結案"];

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入訂單中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜尋訂單編號或客戶..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-72"
          />
        </div>
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent/40"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold">訂單編號</TableHead>
              <TableHead className="text-xs font-semibold">客戶姓名</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">預計交期</TableHead>
              <TableHead className="text-xs font-semibold text-right">總金額</TableHead>
              <TableHead className="text-xs font-semibold text-right">狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  查無符合條件的訂單
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order) => (
                <TableRow key={order.id} className="group">
                  <TableCell className="font-mono text-xs font-medium">
                    {order.order_number}
                  </TableCell>
                  <TableCell className="text-sm">{order.customer_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {order.expected_delivery}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    ${order.total_amount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={order.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {orders.length} 筆訂單
      </p>
    </div>
  );
}
