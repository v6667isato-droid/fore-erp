"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ChevronDown, ClipboardList, FileText, Hammer, PackageCheck, Settings2, Waves, X } from "lucide-react";
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
import {
  QUOTE_STATUSES,
  PRODUCTION_STATUSES,
  COMPLETED_OPEN_STATUSES,
  SETTLED_PAYMENT_STATUS,
  isPaymentUnsettled,
} from "@/components/orders/order-helpers";
import {
  getLeadTimeEstimates,
  LEAD_TIME_SETTING_KEYS,
  type LeadTimeCategoryEstimate,
  type LeadTimeEstimates,
} from "@/lib/lead-time-estimates";
import { LeadTimeWaterLevelRow } from "@/components/lead-time-water-level-row";

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

type NameRel = { name: string } | { name: string }[] | null | undefined;

/** 近期訂單 accordion 展開狀態（記住使用者偏好） */
const RECENT_ORDERS_OPEN_KEY = "dashboard:recent-orders-open";

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

/**
 * 訂單生命週期三卡（報價中｜生產中｜已完成未結案）。
 * 集合定義與訂單列表 filter 共用 order-helpers；點擊跳轉至訂單列表並套用對應 filter。
 */
function DashboardStatsRow({
  quote,
  production,
  completedOpen,
  completedUnpaid,
  onNavigate,
}: {
  quote: number | null;
  production: number | null;
  completedOpen: number | null;
  completedUnpaid: number | null;
  onNavigate?: (ordersStatus: "quote" | "production" | "completed_open") => void;
}) {
  const stats = [
    { key: "quote" as const, label: "報價中", sub: null, subWarning: false, value: quote, icon: FileText },
    { key: "production" as const, label: "生產中", sub: "已收訂金 → 完工前", subWarning: false, value: production, icon: Hammer },
    {
      key: "completed_open" as const,
      label: "已完成(未結案)",
      sub: completedUnpaid != null && completedUnpaid > 0 ? `${completedUnpaid} 筆待收尾款` : null,
      subWarning: true,
      value: completedOpen,
      icon: PackageCheck,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {stats.map((s) => {
        const Icon = s.icon;
        const display = s.value === null ? "—" : s.value;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onNavigate?.(s.key)}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/20"
            title="檢視對應訂單列表"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-base font-semibold leading-tight text-foreground">
                {display}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">件</span>
              </p>
              {s.sub && (
                <p
                  className={`text-[9px] leading-snug break-words ${
                    s.subWarning ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground/90"
                  }`}
                >
                  {s.sub}
                </p>
              )}
            </div>
          </button>
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
  const router = useRouter();
  const [recentOrders, setRecentOrders] = useState<
    Array<{ id: string; order_number: string; customer_name: string; total_amount: number; status: string; payment_status: string }>
  >([]);
  const [portalOrdersToday, setPortalOrdersToday] = useState<number>(0);
  const [recentOpen, setRecentOpen] = useState(false);
  const [leadTime, setLeadTime] = useState<LeadTimeEstimates | null>(null);
  const [leadTimeDialogOpen, setLeadTimeDialogOpen] = useState(false);

  const refreshLeadTime = async () => {
    setLeadTime(await getLeadTimeEstimates(supabase));
  };
  const [kpi, setKpi] = useState<{
    quote: number | null;
    production: number | null;
    completedOpen: number | null;
    completedUnpaid: number | null;
  }>({ quote: null, production: null, completedOpen: null, completedUnpaid: null });
  const [loading, setLoading] = useState(true);

  // 展開偏好存 localStorage（首繪一律收合，避免 SSR/CSR 不一致）
  useEffect(() => {
    try {
      setRecentOpen(localStorage.getItem(RECENT_ORDERS_OPEN_KEY) === "1");
    } catch {
      // localStorage 不可用時維持預設收合
    }
  }, []);

  function toggleRecentOpen() {
    setRecentOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RECENT_ORDERS_OPEN_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  function goToOrders(ordersStatus: "quote" | "production" | "completed_open") {
    router.push(`/?page=orders&ordersStatus=${ordersStatus}`);
  }

  useEffect(() => {
    async function fetchOverview() {
      const now = new Date();
      const todayStr = localDateString(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 13);
      const twoWeeksStartStr = localDateString(from);

      const [ordersRes, portalRes, quoteRes, productionRes, completedOpenRes, completedUnpaidRes, leadTimeRes] =
        await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, total_amount, status, payment_status, customers(name)")
            .is("deleted_at", null)
            .gte("order_date", twoWeeksStartStr)
            .lte("order_date", todayStr)
            .order("order_date", { ascending: false }),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("source", "portal").gte("order_date", todayStr).lte("order_date", todayStr),
          supabase.from("orders").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", QUOTE_STATUSES),
          supabase.from("orders").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", PRODUCTION_STATUSES),
          supabase.from("orders").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", COMPLETED_OPEN_STATUSES),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .is("deleted_at", null)
            .in("status", COMPLETED_OPEN_STATUSES)
            .or(`payment_status.is.null,payment_status.neq.${SETTLED_PAYMENT_STATUS}`),
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
      const countOf = (res: { count: number | null; error: unknown }) =>
        typeof res.count === "number" && !res.error ? res.count : 0;
      setKpi({
        quote: countOf(quoteRes),
        production: countOf(productionRes),
        completedOpen: countOf(completedOpenRes),
        completedUnpaid: countOf(completedUnpaidRes),
      });
      if (!portalRes.error && typeof portalRes.count === "number") {
        setPortalOrdersToday(portalRes.count);
      }
      setLeadTime(leadTimeRes);
      setLoading(false);
    }
    fetchOverview();
  }, []);

  const recentUnpaidCount = recentOrders.filter((o) => isPaymentUnsettled(o.payment_status)).length;

  if (loading) {
    return (
      <div className="space-y-3">
        <DashboardStatsRow quote={null} production={null} completedOpen={null} completedUnpaid={null} />
        <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          載入總覽中…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DashboardStatsRow
        quote={kpi.quote}
        production={kpi.production}
        completedOpen={kpi.completedOpen}
        completedUnpaid={kpi.completedUnpaid}
        onNavigate={goToOrders}
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
            {canEditLeadTimeParams && (
              <span className="max-w-[min(100%,14rem)] shrink-0 text-right text-[9px] leading-snug text-muted-foreground">
                繪圖中～暫停之未完工訂單，按明細品類拆分；品項達塗裝後製程（含）即不計；不含 Føre 庫存單
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <DashboardLeadTimeRow
              label="椅子"
              sublabel="餐椅、板凳，不含搖椅"
              estimate={leadTime.chair}
              showAmount={canEditLeadTimeParams}
            />
            <DashboardLeadTimeRow
              label="其他"
              sublabel="桌、櫃、搖椅等"
              estimate={leadTime.other}
              showAmount={canEditLeadTimeParams}
            />
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
      {portalOrdersToday > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-xs font-medium text-foreground">今日通路下單</span>
          <span className="text-sm font-semibold text-primary">{portalOrdersToday} 筆</span>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={toggleRecentOpen}
          aria-expanded={recentOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-card-foreground">近期訂單</h3>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-right text-[10px] text-muted-foreground">
            近 2 週 {recentOrders.length} 筆
            {recentUnpaidCount > 0 && ` · ${recentUnpaidCount} 筆未付款`}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${recentOpen ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {recentOpen && (
          <div className="max-h-[9.5rem] overflow-y-auto border-t border-border">
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
        )}
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

/** 共用水位條的 dashboard 包裝：金額口徑 → 月數負載；admin 才帶金額與公式細節 */
function DashboardLeadTimeRow({
  label,
  sublabel,
  estimate,
  showAmount = false,
}: {
  label: string;
  sublabel?: string;
  estimate: LeadTimeCategoryEstimate;
  /** admin 才顯示 backlog 金額與公式細節 */
  showAmount?: boolean;
}) {
  const monthsLoad =
    estimate.capacityPerMonth > 0 ? estimate.backlogAmount / estimate.capacityPerMonth : 0;
  return (
    <LeadTimeWaterLevelRow
      label={label}
      sublabel={sublabel}
      monthsLoad={monthsLoad}
      baseMonths={estimate.baseMonths}
      displayMonths={estimate.displayMonths}
      amountText={showAmount ? `NT$ ${Math.round(estimate.backlogAmount).toLocaleString()}` : undefined}
      detailTitle={
        showAmount
          ? `原始值 ${estimate.rawMonths.toFixed(2)} 個月＝max(基準 ${estimate.baseMonths} 個月, backlog ÷ 月產能 ${wanLabel(estimate.capacityPerMonth)})`
          : undefined
      }
    />
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
