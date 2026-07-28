"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Clock, Package, Settings2, TrendingUp, Waves, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  getLeadTimeEstimates,
  LEAD_TIME_SETTING_KEYS,
  type LeadTimeCategoryEstimate,
  type LeadTimeEstimates,
} from "@/lib/lead-time-estimates";

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
    <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${statusStyles[status] ?? "border-transparent bg-muted text-muted-foreground"}`}>
      {status}
    </Badge>
  );
}

function PaymentStatusBadge({ paymentStatus }: { paymentStatus: string }) {
  return (
    <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${paymentStatusStyles[paymentStatus] ?? "border-transparent bg-muted text-muted-foreground"}`}>
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {stats.map((s) => {
        const Icon = s.icon;
        const display = s.value === null ? "—" : s.value;
        return (
          <div key={s.label} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-base font-semibold leading-tight text-foreground">
                {display}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{s.unit}</span>
              </p>
              <p className="text-[9px] text-muted-foreground/90 leading-snug break-words">{s.sub}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardOverview({
  canEditLeadTimeParams = false,
}: {
  /** admin 才能調整水位參數（產能門檻、基準交期） */
  canEditLeadTimeParams?: boolean;
}) {
  const [recentOrders, setRecentOrders] = useState<
    Array<{ id: string; order_number: string; customer_name: string; total_amount: number; status: string; payment_status: string }>
  >([]);
  const [workOrderCounts, setWorkOrderCounts] = useState({ scheduled: 0, running: 0, shipped: 0 });
  const [portalOrdersToday, setPortalOrdersToday] = useState<number>(0);
  const [leadTime, setLeadTime] = useState<LeadTimeEstimates | null>(null);
  const [leadTimeDialogOpen, setLeadTimeDialogOpen] = useState(false);

  const refreshLeadTime = async () => {
    setLeadTime(await getLeadTimeEstimates(supabase));
  };
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

      const [ordersRes, workOrdersRes, portalRes, producingRes, inProgressOrdersRes, paymentPendingRes, leadTimeRes] =
        await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, total_amount, status, payment_status, customers(name)")
            .gte("order_date", twoWeeksStartStr)
            .lte("order_date", todayStr)
            .order("order_date", { ascending: false }),
          supabase.from("work_orders").select(`
          id,
          stage,
          order_items(
            orders( id, status, deleted_at )
          )
        `),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("source", "portal").gte("order_date", todayStr).lte("order_date", todayStr),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "生產中"),
          supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["生產中", "暫停"]),
          supabase.from("orders").select("id", { count: "exact", head: true }).in("payment_status", [...PAYMENT_PENDING_FOR_KPI]),
          getLeadTimeEstimates(supabase),
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
      if (!workOrdersRes.error && workOrdersRes.data) {
        const rows = workOrdersRes.data as Array<{
          id: string;
          stage: string | null;
          order_items:
            | {
                orders:
                  | { id: string; status: string | null; deleted_at?: string | null }
                  | { id: string; status: string | null; deleted_at?: string | null }[]
                  | null;
              }
            | Array<{
                orders:
                  | { id: string; status: string | null; deleted_at?: string | null }
                  | { id: string; status: string | null; deleted_at?: string | null }[]
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
          // 與生產管理工單列表慣例：已軟刪除、報價中／結案訂單不計入
          if (
            !orderObj ||
            orderObj.deleted_at ||
            orderObj.status === "報價中" ||
            orderObj.status === "結案"
          ) {
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
      setLeadTime(leadTimeRes);
      setLoading(false);
    }
    fetchOverview();
  }, []);

  const totalWorkOrders =
    workOrderCounts.scheduled + workOrderCounts.running + workOrderCounts.shipped;

  if (loading) {
    return (
      <div className="space-y-3">
        <DashboardStatsRow activeOrders={null} inProgressOrders={null} pendingPayments={null} />
        <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          載入總覽中…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DashboardStatsRow
        activeOrders={kpi.activeOrders}
        inProgressOrders={kpi.inProgressOrders}
        pendingPayments={kpi.pendingPayments}
      />
      {leadTime && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Waves className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-card-foreground">訂單水位與交期預估</h3>
              {canEditLeadTimeParams && (
                <button
                  type="button"
                  onClick={() => setLeadTimeDialogOpen(true)}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="調整產能門檻與基準交期"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="max-w-[min(100%,14rem)] shrink-0 text-right text-[9px] leading-snug text-muted-foreground">
              繪圖中～暫停之未完工訂單，按明細品類拆分；不含 Føre 庫存單
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <LeadTimeWaterLevelRow label="椅子" sublabel="餐椅、板凳，不含搖椅" estimate={leadTime.chair} />
            <LeadTimeWaterLevelRow label="其他" sublabel="桌、櫃、搖椅等" estimate={leadTime.other} />
          </div>
          {canEditLeadTimeParams && (
            <LeadTimeParamsDialog
              open={leadTimeDialogOpen}
              onOpenChange={setLeadTimeDialogOpen}
              current={leadTime}
              onSaved={refreshLeadTime}
            />
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        {portalOrdersToday > 0 && (
          <div className="col-span-full flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 lg:col-span-2">
            <span className="text-xs font-medium text-foreground">今日通路下單</span>
            <span className="text-sm font-semibold text-primary">{portalOrdersToday} 筆</span>
          </div>
        )}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-card-foreground">近期訂單</h3>
            </div>
            <span className="shrink-0 text-right text-[10px] text-muted-foreground">
              近 2 週內 · 共 {recentOrders.length} 筆
            </span>
          </div>
          <div className="max-h-[9.5rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 py-1 text-[10px]">訂單編號</TableHead>
                  <TableHead className="h-7 px-2 py-1 text-[10px]">客戶</TableHead>
                  <TableHead className="h-7 px-2 py-1 text-right text-[10px]">金額</TableHead>
                  <TableHead className="h-7 px-2 py-1 text-right text-[10px]">訂單狀態</TableHead>
                  <TableHead className="h-7 px-2 py-1 text-right text-[10px]">付款狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-2 text-center text-xs text-muted-foreground">
                      尚無訂單
                    </TableCell>
                  </TableRow>
                ) : (
                  recentOrders.map((order) => (
                    <TableRow key={order.id} className="hover:bg-muted/40">
                      <TableCell className="px-2 py-1 font-mono text-[10px]">{order.order_number}</TableCell>
                      <TableCell className="px-2 py-1 text-xs">{order.customer_name}</TableCell>
                      <TableCell className="px-2 py-1 text-right text-xs">${order.total_amount.toLocaleString()}</TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <PaymentStatusBadge paymentStatus={order.payment_status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-card-foreground">生產進度</h3>
            </div>
            <span className="max-w-[min(100%,12rem)] shrink-0 text-right text-[9px] leading-snug text-muted-foreground">
              依工單站別；不含報價中／結案
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <ProgressRow label="待排程" count={workOrderCounts.scheduled} total={totalWorkOrders} color="bg-[var(--badge-pending)]" />
            <ProgressRow label="進行中" count={workOrderCounts.running} total={totalWorkOrders} color="bg-[var(--badge-progress)]" />
            <ProgressRow label="已出貨" count={workOrderCounts.shipped} total={totalWorkOrders} color="bg-[var(--badge-done)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 萬元標籤：400000 → 40萬 */
function wanLabel(amount: number): string {
  const wan = amount / 10000;
  const rounded = Math.round(wan * 10) / 10;
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded}萬`;
}

/** 滿水位＝當月起 4 個月（一季）的產能 */
const LEAD_TIME_SCALE_MONTHS = 4;

/** 當月起連續 monthCount 個月的「N月」標籤 */
function upcomingMonthLabels(monthCount: number): string[] {
  const now = new Date();
  return Array.from({ length: monthCount }, (_, i) => `${((now.getMonth() + i) % 12) + 1}月`);
}

function LeadTimeWaterLevelRow({
  label,
  sublabel,
  estimate,
}: {
  label: string;
  sublabel?: string;
  estimate: LeadTimeCategoryEstimate;
}) {
  // 刻度＝當月起 4 個月產能，每格一個月；超過基準交期的水位以警示色顯示
  const scaleMax = estimate.capacityPerMonth * LEAD_TIME_SCALE_MONTHS;
  const baseAmount = Math.min(estimate.baseMonths * estimate.capacityPerMonth, scaleMax);
  const cappedBacklog = Math.max(0, Math.min(estimate.backlogAmount, scaleMax));
  const normalPct = (Math.min(cappedBacklog, baseAmount) / scaleMax) * 100;
  const excessPct = (Math.max(0, cappedBacklog - baseAmount) / scaleMax) * 100;
  const overloaded = estimate.backlogAmount > baseAmount;
  const monthLabels = upcomingMonthLabels(LEAD_TIME_SCALE_MONTHS);

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-baseline justify-between gap-2 sm:w-40 sm:shrink-0 sm:flex-col sm:gap-0.5">
        <span className="text-xs font-medium text-foreground">
          {label}
          {sublabel && (
            <span className="ml-1 text-[9px] font-normal text-muted-foreground">{sublabel}</span>
          )}
        </span>
        <span className="text-xs font-semibold text-foreground">
          NT$ {Math.round(estimate.backlogAmount).toLocaleString()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
          <div className="absolute inset-y-0 left-0 flex w-full">
            <div
              className="h-full bg-[var(--badge-progress)] transition-all"
              style={{ width: `${normalPct}%` }}
            />
            {excessPct > 0 && (
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${excessPct}%` }} />
            )}
          </div>
          {/* 月分隔線（每格＝一個月產能） */}
          {monthLabels.slice(1).map((_, i) => (
            <div
              key={i}
              className="absolute inset-y-0 w-px bg-foreground/30"
              style={{ left: `${((i + 1) / LEAD_TIME_SCALE_MONTHS) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex text-[9px] text-muted-foreground">
          {monthLabels.map((m) => (
            <span key={m} className="w-1/4 text-center">
              {m}
            </span>
          ))}
        </div>
      </div>
      <div
        className="shrink-0 text-xs text-foreground sm:w-36 sm:text-right"
        title={`原始值 ${estimate.rawMonths.toFixed(2)} 個月＝max(基準 ${estimate.baseMonths} 個月, backlog ÷ 月產能 ${wanLabel(estimate.capacityPerMonth)})`}
      >
        預估交期：
        <span className={`font-semibold ${overloaded ? "text-amber-600 dark:text-amber-400" : ""}`}>
          {estimate.displayMonths.toFixed(1)} 個月
        </span>
      </div>
    </div>
  );
}

function LeadTimeParamsDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: LeadTimeEstimates;
  onSaved: () => Promise<void>;
}) {
  const [chairCapacity, setChairCapacity] = useState("");
  const [chairBase, setChairBase] = useState("");
  const [otherCapacity, setOtherCapacity] = useState("");
  const [otherBase, setOtherBase] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChairCapacity(String(current.chair.capacityPerMonth));
    setChairBase(String(current.chair.baseMonths));
    setOtherCapacity(String(current.other.capacityPerMonth));
    setOtherBase(String(current.other.baseMonths));
  }, [open, current]);

  const fields = [
    { label: "椅子產能門檻（NT$/月）", value: chairCapacity, set: setChairCapacity, key: LEAD_TIME_SETTING_KEYS.chairCapacityPerMonth },
    { label: "椅子基準交期（月）", value: chairBase, set: setChairBase, key: LEAD_TIME_SETTING_KEYS.chairBaseMonths },
    { label: "其他產能門檻（NT$/月）", value: otherCapacity, set: setOtherCapacity, key: LEAD_TIME_SETTING_KEYS.otherCapacityPerMonth },
    { label: "其他基準交期（月）", value: otherBase, set: setOtherBase, key: LEAD_TIME_SETTING_KEYS.otherBaseMonths },
  ];

  async function handleSave() {
    const rows: Array<{ key: string; value: number }> = [];
    for (const f of fields) {
      const n = Number(f.value);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(`「${f.label}」需為大於 0 的數字`);
        return;
      }
      rows.push({ key: f.key, value: n });
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }
    toast.success("水位參數已更新");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="lead-time-params-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">調整水位參數</Dialog.Title>
              <p id="lead-time-params-desc" className="mt-1 text-sm text-muted-foreground">
                交期（月）＝max(基準交期, backlog ÷ 月產能)，進位到 0.5；刻度為當月起 4 個月產能
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="關閉">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={saving}>取消</Button>
            </Dialog.Close>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-xs font-semibold text-foreground">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
