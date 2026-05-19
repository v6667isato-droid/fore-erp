"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Clock, Package, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { normalizeWorkOrderStage } from "@/lib/work-order-stages";

const statusStyles: Record<string, string> = {
  生產中: "bg-[var(--badge-progress)] text-[var(--badge-progress-fg)] border-transparent",
  已結案: "bg-[var(--badge-done)] text-[var(--badge-done-fg)] border-transparent",
};

/** 與訂單管理 orders.payment_status 一致 */
const paymentStatusStyles: Record<string, string> = {
  未付款: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800",
  部分付款: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-800",
  已付訂金: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-800",
  已結清: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800",
};

/** 總覽「待付訂」KPI：仍須收款之訂單（與 orders 表欄位一致） */
const PAYMENT_PENDING_FOR_KPI = ["未付款", "部分付款"] as const;

type NameRel = { name: string } | { name: string }[] | null | undefined;

/**
 * 將工單站別歸入總覽三區（與 work_orders.stage／生產管理工單一致）：
 * 待排程｜進行中（備料中～待出貨、含暫停）｜已出貨
 */
function bucketWorkOrderStage(stageRaw: string | null | undefined): "scheduled" | "running" | "shipped" {
  const s = normalizeWorkOrderStage(stageRaw);
  if (s === "已出貨") return "shipped";
  if (s === "待排程") return "scheduled";
  return "running";
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function relName(rel: NameRel) {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.name ?? "" : rel.name ?? "";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={statusStyles[status] ?? "border-transparent bg-muted text-muted-foreground"}>
      {status}
    </Badge>
  );
}

function PaymentStatusBadge({ paymentStatus }: { paymentStatus: string }) {
  return (
    <Badge variant="outline" className={paymentStatusStyles[paymentStatus] ?? "border-transparent bg-muted text-muted-foreground"}>
      {paymentStatus}
    </Badge>
  );
}

function DashboardStatsRow({
  activeOrders,
  inProgressOrders,
  pendingPayments,
}: {
  activeOrders: number | null;
  inProgressOrders: number | null;
  pendingPayments: number | null;
}) {
  const stats = [
    { label: "生產中訂單", sub: "orders.status＝生產中", value: activeOrders, unit: "件", icon: Package },
    { label: "進行中訂單", sub: "orders.status∈生產中、暫停", value: inProgressOrders, unit: "件", icon: TrendingUp },
    { label: "待付訂", sub: "orders.payment_status∈未付款、部分付款", value: pendingPayments, unit: "件", icon: Clock },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => {
          const Icon = s.icon;
          const display = s.value === null ? "—" : s.value;
          return (
            <div key={s.label} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold text-foreground">
                  {display}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">{s.unit}</span>
                </p>
                <p className="text-[10px] text-muted-foreground/90 mt-1 leading-snug break-words">{s.sub}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardOverview() {
  const [recentOrders, setRecentOrders] = useState<
    Array<{ id: string; order_number: string; customer_name: string; total_amount: number; status: string; payment_status: string }>
  >([]);
  const [recentPurchases, setRecentPurchases] = useState<
    Array<{ id: string; item_name: string; vendor_name: string; purchase_date: string; tax_included_amount: number }>
  >([]);
  const [workOrderCounts, setWorkOrderCounts] = useState({ scheduled: 0, running: 0, shipped: 0 });
  const [portalOrdersToday, setPortalOrdersToday] = useState<number>(0);
  const [kpi, setKpi] = useState<{
    activeOrders: number | null;
    inProgressOrders: number | null;
    pendingPayments: number | null;
  }>({ activeOrders: null, inProgressOrders: null, pendingPayments: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchOverview() {
      const now = new Date();
      const todayStr = localDateString(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 13);
      const twoWeeksStartStr = localDateString(from);

      const [ordersRes, purchasesRes, workOrdersRes, portalRes, producingRes, inProgressOrdersRes, paymentPendingRes] =
        await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, total_amount, status, payment_status, customers(name)")
            .gte("order_date", twoWeeksStartStr)
            .lte("order_date", todayStr)
            .order("order_date", { ascending: false }),
          supabase
            .from("purchases")
            .select("id, item_name, purchase_date, tax_included_amount, vendors(name)")
            .order("purchase_date", { ascending: false })
            .limit(4),
          supabase.from("work_orders").select(`
          id,
          stage,
          order_items(
            orders( id, status )
          )
        `),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("source", "portal").gte("order_date", todayStr).lte("order_date", todayStr),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "生產中"),
          supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["生產中", "暫停"]),
          supabase.from("orders").select("id", { count: "exact", head: true }).in("payment_status", [...PAYMENT_PENDING_FOR_KPI]),
        ]);

      if (!ordersRes.error && ordersRes.data) {
        const rows = ordersRes.data as Array<{
          id: string;
          order_number: string;
          total_amount: number;
          status: string;
          payment_status: string | null;
          customers: NameRel;
        }>;
        setRecentOrders(
          rows.map((r) => ({
            id: r.id,
            order_number: r.order_number,
            customer_name: relName(r.customers),
            total_amount: Number(r.total_amount) ?? 0,
            status: r.status,
            payment_status: String(r.payment_status ?? "未付款"),
          }))
        );
      } else {
        setRecentOrders([]);
      }
      if (!purchasesRes.error && purchasesRes.data) {
        const rows = purchasesRes.data as Array<{
          id: string;
          item_name: string | null;
          purchase_date: string | null;
          tax_included_amount: number;
          vendors: NameRel;
        }>;
        setRecentPurchases(
          rows.map((r) => ({
            id: r.id,
            item_name: r.item_name ?? "—",
            vendor_name: relName(r.vendors) || "—",
            purchase_date: String(r.purchase_date ?? ""),
            tax_included_amount: Number(r.tax_included_amount) ?? 0,
          }))
        );
      }
      if (!workOrdersRes.error && workOrdersRes.data) {
        const rows = workOrdersRes.data as Array<{
          id: string;
          stage: string | null;
          order_items:
            | {
                orders:
                  | { id: string; status: string | null }
                  | { id: string; status: string | null }[]
                  | null;
              }
            | Array<{
                orders:
                  | { id: string; status: string | null }
                  | { id: string; status: string | null }[]
                  | null;
              }>
            | null;
        }>;
        let scheduled = 0;
        let running = 0;
        let shipped = 0;
        for (const row of rows) {
          const oi = Array.isArray(row.order_items) ? row.order_items[0] : row.order_items;
          const orderRel = oi?.orders;
          const orderObj = Array.isArray(orderRel) ? orderRel[0] : orderRel;
          // 與生產管理工單列表慣例：報價中／結案訂單不計入
          if (!orderObj || orderObj.status === "報價中" || orderObj.status === "結案") {
            continue;
          }
          const bucket = bucketWorkOrderStage(row.stage);
          if (bucket === "scheduled") scheduled++;
          else if (bucket === "running") running++;
          else shipped++;
        }
        setWorkOrderCounts({ scheduled, running, shipped });
      } else {
        setWorkOrderCounts({ scheduled: 0, running: 0, shipped: 0 });
      }

      setKpi({
        activeOrders: typeof producingRes.count === "number" && !producingRes.error ? producingRes.count : 0,
        inProgressOrders:
          typeof inProgressOrdersRes.count === "number" && !inProgressOrdersRes.error ? inProgressOrdersRes.count : 0,
        pendingPayments:
          typeof paymentPendingRes.count === "number" && !paymentPendingRes.error ? paymentPendingRes.count : 0,
      });
      if (!portalRes.error && typeof portalRes.count === "number") {
        setPortalOrdersToday(portalRes.count);
      }
      setLoading(false);
    }
    fetchOverview();
  }, []);

  const totalWorkOrders =
    workOrderCounts.scheduled + workOrderCounts.running + workOrderCounts.shipped;

  if (loading) {
    return (
      <div className="space-y-6">
        <DashboardStatsRow activeOrders={null} inProgressOrders={null} pendingPayments={null} />
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入總覽中…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardStatsRow
        activeOrders={kpi.activeOrders}
        inProgressOrders={kpi.inProgressOrders}
        pendingPayments={kpi.pendingPayments}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {portalOrdersToday > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">今日通路下單</span>
          <span className="text-lg font-semibold text-primary">{portalOrdersToday} 筆</span>
        </div>
      )}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-card-foreground">近期訂單</h3>
          </div>
          <span className="text-xs text-muted-foreground text-right shrink-0">
            近 2 週內（依訂單日期）· 共 {recentOrders.length} 筆
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">訂單編號</TableHead>
              <TableHead className="text-xs">客戶</TableHead>
              <TableHead className="text-xs text-right">金額</TableHead>
              <TableHead className="text-xs text-right">訂單狀態</TableHead>
              <TableHead className="text-xs text-right">付款狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-4">尚無訂單</TableCell>
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
                  <TableCell className="text-right">
                    <PaymentStatusBadge paymentStatus={order.payment_status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-card-foreground">生產進度</h3>
            </div>
            <span className="text-xs text-muted-foreground text-right shrink-0 max-w-[min(100%,16rem)] leading-snug">
              依生產工單站別；不含報價中／結案訂單（進行中＝備料中～待出貨含暫停）
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <ProgressRow label="待排程" count={workOrderCounts.scheduled} total={totalWorkOrders} color="bg-[var(--badge-pending)]" />
            <ProgressRow label="進行中" count={workOrderCounts.running} total={totalWorkOrders} color="bg-[var(--badge-progress)]" />
            <ProgressRow label="已出貨" count={workOrderCounts.shipped} total={totalWorkOrders} color="bg-[var(--badge-done)]" />
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
                <div key={r.id} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-foreground">{r.item_name}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatDateYyMmDd(r.purchase_date)}</span>
                      <span className="mx-1.5 text-border">·</span>
                      <span>{r.vendor_name}</span>
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-foreground">${r.tax_included_amount.toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
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
