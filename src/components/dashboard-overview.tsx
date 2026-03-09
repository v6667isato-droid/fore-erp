"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Package, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type OrderStatus = "待付訂" | "生產中" | "已結案";

const statusStyles: Record<string, string> = {
  待付訂: "bg-[var(--badge-pending)] text-[var(--badge-pending-fg)] border-transparent",
  生產中: "bg-[var(--badge-progress)] text-[var(--badge-progress-fg)] border-transparent",
  已結案: "bg-[var(--badge-done)] text-[var(--badge-done-fg)] border-transparent",
};

type NameRel = { name: string } | { name: string }[] | null | undefined;

function relName(rel: NameRel) {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.name ?? "" : rel.name ?? "";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={statusStyles[status] ?? ""}>
      {status}
    </Badge>
  );
}

export function DashboardOverview() {
  const [recentOrders, setRecentOrders] = useState<Array<{ id: string; order_number: string; customer_name: string; total_amount: number; status: string }>>([]);
  const [recentPurchases, setRecentPurchases] = useState<Array<{ id: string; item_name: string; vendor_name: string; tax_included_amount: number }>>([]);
  const [taskCounts, setTaskCounts] = useState({ todo: 0, inProgress: 0, done: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchOverview() {
      const [ordersRes, purchasesRes, tasksRes] = await Promise.all([
        supabase.from("orders").select("id, order_number, total_amount, status, customers(name)").order("expected_delivery", { ascending: false }).limit(5),
        supabase.from("purchases").select("id, item_name, tax_included_amount, vendors(name)").order("purchase_date", { ascending: false }).limit(4),
        supabase.from("production_tasks").select("status"),
      ]);

      if (!ordersRes.error && ordersRes.data) {
        const rows = ordersRes.data as Array<{
          id: string;
          order_number: string;
          total_amount: number;
          status: string;
          customers: NameRel;
        }>;
        setRecentOrders(
          rows.map((r) => ({
            id: r.id,
            order_number: r.order_number,
            customer_name: relName(r.customers),
            total_amount: Number(r.total_amount) ?? 0,
            status: r.status,
          }))
        );
      }
      if (!purchasesRes.error && purchasesRes.data) {
        const rows = purchasesRes.data as Array<{
          id: string;
          item_name: string | null;
          tax_included_amount: number;
          vendors: NameRel;
        }>;
        setRecentPurchases(
          rows.map((r) => ({
            id: r.id,
            item_name: r.item_name ?? "—",
            vendor_name: relName(r.vendors) || "—",
            tax_included_amount: Number(r.tax_included_amount) ?? 0,
          }))
        );
      }
      if (!tasksRes.error && tasksRes.data) {
        const todo = tasksRes.data.filter((t: { status: string }) => t.status === "待處理").length;
        const inProgress = tasksRes.data.filter((t: { status: string }) => t.status === "進行中").length;
        const done = tasksRes.data.filter((t: { status: string }) => t.status === "已完成").length;
        setTaskCounts({ todo, inProgress, done });
      }
      setLoading(false);
    }
    fetchOverview();
  }, []);

  const totalTasks = taskCounts.todo + taskCounts.inProgress + taskCounts.done;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        載入總覽中…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-card-foreground">近期訂單</h3>
          </div>
          <span className="text-xs text-muted-foreground">共 {recentOrders.length} 筆</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">訂單編號</TableHead>
              <TableHead className="text-xs">客戶</TableHead>
              <TableHead className="text-xs text-right">金額</TableHead>
              <TableHead className="text-xs text-right">狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-4">尚無訂單</TableCell>
              </TableRow>
            ) : (
              recentOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.order_number}</TableCell>
                  <TableCell className="text-sm">{order.customer_name}</TableCell>
                  <TableCell className="text-right text-sm">${order.total_amount.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={order.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-card-foreground">生產進度</h3>
          </div>
          <div className="flex flex-col gap-3">
            <ProgressRow label="待處理" count={taskCounts.todo} total={totalTasks} color="bg-[var(--badge-pending)]" />
            <ProgressRow label="進行中" count={taskCounts.inProgress} total={totalTasks} color="bg-[var(--badge-progress)]" />
            <ProgressRow label="已完成" count={taskCounts.done} total={totalTasks} color="bg-[var(--badge-done)]" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-card-foreground">近期採購</h3>
          </div>
          <div className="flex flex-col gap-3">
            {recentPurchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚無採購紀錄</p>
            ) : (
              recentPurchases.map((r) => (
                <div key={r.id} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{r.item_name}</span>
                    <span className="text-xs text-muted-foreground">{r.vendor_name}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">${r.tax_included_amount.toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-sm font-semibold text-foreground">{count}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
