"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { OrderOverviewDialog } from "@/components/order-overview-dialog";
import { ClipboardList, ArrowDown, ArrowUp, ArrowUpDown, Search, Download } from "lucide-react";
import { formatDateYyMmDd } from "@/lib/utils";
import {
  plannedEndLatestByOrderIdFromWorkOrderRows,
  type WorkOrderPlannedWithOrderId,
} from "@/lib/planned-end-aggregate";
import { normalizeChannelPartnerPaymentStatus } from "@/lib/channel-partner-payment-status";

interface ChannelInfo {
  id: string;
  name: string;
}

interface ChannelOrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  notes: string | null;
  contact_person: string | null;
  customer_name: string;
  customer_alias: string | null;
  expected_delivery_date: string | null;
  /** 工單 planned_end_date：同一訂單內各品項之最晚預計完成日 */
  planned_end_max: string | null;
  status: string;
  /** 通路端僅 已結清／未結清 */
  payment_status: "已結清" | "未結清";
  total_amount: number;
}

type SortKey =
  | "order_number"
  | "order_date"
  | "customer_name"
  | "expected_delivery_date"
  | "planned_end_max"
  | "status"
  | "payment_status"
  | "total_amount";

type DateBasis = "order_date" | "expected_delivery";

function compareNullableDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function orderDateForBasis(o: ChannelOrderRow, basis: DateBasis): string | null {
  if (basis === "order_date") {
    return o.order_date ? String(o.order_date).slice(0, 10) : null;
  }
  return o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null;
}

export default function ChannelOrdersPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = params?.channelId ?? "";

  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ChannelOrderRow[]>([]);
  const [overviewOrderId, setOverviewOrderId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("全部");
  const [paymentFilter, setPaymentFilter] = useState<string>("全部");
  const [dateBasis, setDateBasis] = useState<DateBasis>("order_date");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("order_date");
  const [sortAsc, setSortAsc] = useState(false);

  const title = useMemo(() => {
    const name = channel?.name?.trim();
    return name ? `通路訂單（${name}）` : "通路訂單";
  }, [channel?.name]);

  const statusOptions = useMemo(() => {
    const set = new Set(orders.map((o) => o.status).filter(Boolean));
    return ["全部", ...[...set].sort((a, b) => a.localeCompare(b, "zh-Hant"))];
  }, [orders]);

  const paymentOptions = useMemo(
    () => [
      { value: "全部", label: "全部" },
      { value: "未結清", label: "未結清" },
      { value: "已結清", label: "已結清" },
    ],
    []
  );

  const fetchData = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const [channelRes, ordersRes] = await Promise.all([
        supabase.from("channels").select("id, name").eq("id", channelId).single(),
        supabase
          .from("orders")
          .select(
            "id, order_number, order_date, internal_notes, expected_delivery_date, status, payment_status, total_amount, customers!inner(channel_id, contact_person, name, alias)"
          )
          .eq("customers.channel_id", channelId)
          .order("order_date", { ascending: false })
          .limit(500),
      ]);

      if (!channelRes.error && channelRes.data) {
        setChannel({ id: String(channelRes.data.id), name: String(channelRes.data.name ?? "") });
      } else {
        setChannel(null);
      }

      if (ordersRes.error) {
        setOrders([]);
        return;
      }

      const rawList = (ordersRes.data ?? []) as any[];
      const orderIds = rawList.map((r) => String(r.id));

      let plannedMap = new Map<string, string | null>();
      if (orderIds.length > 0) {
        const { data: woRows, error: woErr } = await supabase
          .from("work_orders")
          .select("planned_end_date, order_items!inner(order_id)")
          .in("order_items.order_id", orderIds);
        if (!woErr && woRows?.length) {
          plannedMap = plannedEndLatestByOrderIdFromWorkOrderRows(woRows as WorkOrderPlannedWithOrderId[]);
        }
      }

      setOrders(
        rawList.map((r) => {
          const cust = r.customers as
            | { contact_person?: string | null; name?: string | null; alias?: string | null }
            | undefined;
          const customerName = cust?.name != null ? String(cust.name).trim() : "";
          const aliasRaw = cust?.alias != null ? String(cust.alias).trim() : "";
          return {
            id: String(r.id),
            order_number: String(r.order_number ?? ""),
            order_date: r.order_date ?? null,
            notes: r.internal_notes != null ? String(r.internal_notes) : null,
            contact_person:
              cust?.contact_person != null ? String(cust.contact_person) : null,
            customer_name: customerName,
            customer_alias: aliasRaw || null,
            expected_delivery_date: r.expected_delivery_date ?? null,
            planned_end_max: plannedMap.get(String(r.id)) ?? null,
            status: r.status ?? "—",
            payment_status: normalizeChannelPartnerPaymentStatus(r.payment_status),
            total_amount: Number(r.total_amount ?? 0),
          };
        })
      );
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = orders.filter((o) => {
      if (statusFilter !== "全部" && o.status !== statusFilter) return false;

      if (paymentFilter !== "全部" && o.payment_status !== paymentFilter) {
        return false;
      }

      if (dateFrom || dateTo) {
        const d = orderDateForBasis(o, dateBasis);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }

      if (!q) return true;
      const hay = [
        o.order_number,
        o.customer_name,
        o.customer_alias ?? "",
        o.contact_person ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const dir = sortAsc ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "order_number":
          cmp = a.order_number.localeCompare(b.order_number, "zh-Hant", { numeric: true });
          break;
        case "order_date":
          cmp = compareNullableDate(
            a.order_date ? String(a.order_date).slice(0, 10) : null,
            b.order_date ? String(b.order_date).slice(0, 10) : null
          );
          break;
        case "customer_name": {
          const an = [a.customer_name, a.customer_alias ?? ""].join(" ");
          const bn = [b.customer_name, b.customer_alias ?? ""].join(" ");
          cmp = an.localeCompare(bn, "zh-Hant", { numeric: true });
          break;
        }
        case "expected_delivery_date":
          cmp = compareNullableDate(
            a.expected_delivery_date ? String(a.expected_delivery_date).slice(0, 10) : null,
            b.expected_delivery_date ? String(b.expected_delivery_date).slice(0, 10) : null
          );
          break;
        case "planned_end_max":
          cmp = compareNullableDate(a.planned_end_max, b.planned_end_max);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status, "zh-Hant");
          break;
        case "payment_status":
          cmp = a.payment_status.localeCompare(b.payment_status, "zh-Hant");
          break;
        case "total_amount":
          cmp = a.total_amount - b.total_amount;
          break;
        default:
          cmp = 0;
      }
      if (cmp !== 0) return cmp * dir;
      return a.order_number.localeCompare(b.order_number, "zh-Hant", { numeric: true });
    });

    return list;
  }, [
    orders,
    search,
    statusFilter,
    paymentFilter,
    dateBasis,
    dateFrom,
    dateTo,
    sortBy,
    sortAsc,
  ]);

  const settlement = useMemo(() => {
    const count = filteredSorted.length;
    const sum = filteredSorted.reduce((s, o) => s + o.total_amount, 0);
    const settledRows = filteredSorted.filter((o) => o.payment_status === "已結清");
    const pendingRows = filteredSorted.filter((o) => o.payment_status !== "已結清");
    const settledSum = settledRows.reduce((s, o) => s + o.total_amount, 0);
    const pendingSum = pendingRows.reduce((s, o) => s + o.total_amount, 0);
    return {
      count,
      sum,
      settledCount: settledRows.length,
      settledSum,
      pendingCount: pendingRows.length,
      pendingSum,
    };
  }, [filteredSorted]);

  function applyThisMonthOrderDate() {
    const now = new Date();
    setDateBasis("order_date");
    setDateFrom(localYmd(startOfMonth(now)));
    setDateTo(localYmd(endOfMonth(now)));
  }

  function clearDateRange() {
    setDateFrom("");
    setDateTo("");
  }

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortAsc((v) => !v);
    } else {
      setSortBy(key);
      setSortAsc(key === "order_date" || key === "planned_end_max" ? false : true);
    }
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 font-medium text-left hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded px-0.5 py-0.5"
        aria-label={`依${label}排序${active ? (sortAsc ? "升冪" : "降冪") : ""}`}
      >
        {label}
        {active ? (
          sortAsc ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        )}
      </button>
    );
  }

  function exportFilteredCsv() {
    if (!filteredSorted.length) return;
    const basisLabel = dateBasis === "order_date" ? "下單日" : "預計交貨";
    const rangeLabel =
      dateFrom || dateTo
        ? `${basisLabel} ${dateFrom || "…"}～${dateTo || "…"}`
        : "未限定日期";
    const payLabel = paymentFilter === "全部" ? "全部" : paymentFilter;
    const meta = [
      `# 通路結算匯出`,
      `# 通路:${channel?.name ?? channelId};${rangeLabel};訂單狀態:${statusFilter};付款:${payLabel}`,
      `# 筆數:${settlement.count};應收合計:${settlement.sum};已結清:${settlement.settledSum}(${settlement.settledCount}筆);未結清:${settlement.pendingSum}(${settlement.pendingCount}筆)`,
    ].join("\n");

    const header = [
      "訂單編號",
      "客戶",
      "聯絡人",
      "下單日",
      "預計交貨",
      "預計完成",
      "訂單狀態",
      "付款狀態",
      "總金額",
    ];
    const rows = filteredSorted.map((o) => [
      o.order_number,
      [o.customer_name, o.customer_alias ? `(${o.customer_alias})` : ""].filter(Boolean).join(" "),
      o.contact_person ?? "",
      o.order_date ? o.order_date.slice(0, 10) : "",
      o.expected_delivery_date ? o.expected_delivery_date.slice(0, 10) : "",
      o.planned_end_max ?? "",
      o.status,
      o.payment_status,
      String(o.total_amount ?? 0),
    ]);
    const csv = [meta, "", header, ...rows]
      .map((line) =>
        Array.isArray(line)
          ? line
              .map((v) => {
                const s = String(v ?? "");
                if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
                return s;
              })
              .join(",")
          : line
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeChannel = (channel?.name ?? "channel").replace(/[^\w\u4e00-\u9fff-]+/g, "_");
    a.href = url;
    a.download = `通路結算_${safeChannel}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-xl border border-border bg-card shadow-sm p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ClipboardList className="h-4 w-4" />
              {title}
            </div>
            <Button type="button" variant="outline" className="h-8 px-3 text-sm shrink-0" onClick={fetchData}>
              重新整理
            </Button>
          </div>

          {!loading && orders.length > 0 && (
            <>
              <div className="mt-5 rounded-lg border border-border bg-muted/15 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  結算篩選
                </p>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="settle-date-basis">
                      期間依據
                    </label>
                    <select
                      id="settle-date-basis"
                      value={dateBasis}
                      onChange={(e) => setDateBasis(e.target.value as DateBasis)}
                      className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="order_date">下單日</option>
                      <option value="expected_delivery">預計交貨日</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="settle-from">
                        起
                      </label>
                      <input
                        id="settle-from"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="settle-to">
                        迄
                      </label>
                      <input
                        id="settle-to"
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-xs"
                      onClick={applyThisMonthOrderDate}
                    >
                      本月（下單）
                    </Button>
                    <Button type="button" variant="ghost" className="h-9 text-xs" onClick={clearDateRange}>
                      清除日期
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="settle-payment">
                      付款狀態
                    </label>
                    <select
                      id="settle-payment"
                      value={paymentFilter}
                      onChange={(e) => setPaymentFilter(e.target.value)}
                      className="h-9 min-w-[11rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {paymentOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                  設定起迄後，僅列出該欄位有日期且落在區間內之訂單。「未結清」= 付款狀態非「已結清」。部分付款情境仍以 ERP 收款紀錄為準。
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="channel-order-search">
                    搜尋（客戶／別名／聯絡人／訂單編號）
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="channel-order-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="輸入關鍵字…"
                      className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="channel-order-status">
                    訂單狀態
                  </label>
                  <select
                    id="channel-order-status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {!loading && orders.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
              <div className="text-sm text-foreground space-y-1">
                <div>
                  <span className="font-medium tabular-nums">{settlement.count}</span>
                  <span className="text-muted-foreground"> 筆 · 應收合計 </span>
                  <span className="font-semibold tabular-nums">${settlement.sum.toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>
                    已結清 <span className="font-medium text-foreground tabular-nums">${settlement.settledSum.toLocaleString()}</span>
                    <span className="tabular-nums">（{settlement.settledCount} 筆）</span>
                  </span>
                  <span>
                    未結清 <span className="font-medium text-foreground tabular-nums">${settlement.pendingSum.toLocaleString()}</span>
                    <span className="tabular-nums">（{settlement.pendingCount} 筆）</span>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  以上統計依目前列表篩選結果（含搜尋、訂單狀態、結算日期、付款）。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1.5 text-xs shrink-0 self-start"
                disabled={!filteredSorted.length}
                onClick={exportFilteredCsv}
              >
                <Download className="h-3.5 w-3.5" />
                匯出結算 CSV
              </Button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground mt-4">載入中…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-4">尚無訂單紀錄</p>
          ) : (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">
                      <SortHeader label="訂單編號" sortKey="order_number" />
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      <SortHeader label="下單日" sortKey="order_date" />
                    </th>
                    <th className="pb-2 pr-3 font-medium min-w-[7rem]">
                      <SortHeader label="客戶" sortKey="customer_name" />
                    </th>
                    <th className="pb-2 pr-3 font-medium">聯絡人</th>
                    <th className="pb-2 pr-3 font-medium">備註</th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">
                      <SortHeader label="預計交貨" sortKey="expected_delivery_date" />
                    </th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">
                      <SortHeader label="預計完成" sortKey="planned_end_max" />
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      <SortHeader label="狀態" sortKey="status" />
                    </th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">
                      <SortHeader label="付款" sortKey="payment_status" />
                    </th>
                    <th className="pb-2 pr-2 text-right font-medium whitespace-nowrap">
                      <SortHeader label="金額" sortKey="total_amount" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((o) => (
                    <tr key={o.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-3 font-mono text-sm">
                        <button
                          type="button"
                          onClick={() => setOverviewOrderId(o.id)}
                          className="text-left text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded px-0.5 py-0.5"
                        >
                          {o.order_number}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {o.order_date ? formatDateYyMmDd(o.order_date) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-foreground max-w-[12rem]">
                        <div className="truncate font-medium" title={o.customer_name || undefined}>
                          {o.customer_name?.trim() || "—"}
                        </div>
                        {o.customer_alias?.trim() ? (
                          <div className="truncate text-xs text-muted-foreground" title={o.customer_alias}>
                            ({o.customer_alias})
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="py-2.5 pr-3 text-muted-foreground max-w-[8rem] truncate"
                        title={o.contact_person ?? undefined}
                      >
                        {o.contact_person?.trim() || "—"}
                      </td>
                      <td
                        className="py-2.5 pr-3 text-muted-foreground max-w-[10rem] truncate"
                        title={o.notes ?? undefined}
                      >
                        {o.notes?.trim() || "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {o.expected_delivery_date ? formatDateYyMmDd(o.expected_delivery_date) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {o.planned_end_max ? formatDateYyMmDd(o.planned_end_max) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{o.status}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap text-xs">
                        {o.payment_status}
                      </td>
                      <td className="py-2.5 pr-2 text-right font-medium text-foreground tabular-nums whitespace-nowrap">
                        ${o.total_amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSorted.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">沒有符合條件的訂單</p>
              )}
            </div>
          )}

          {!loading && orders.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              「預計完成」為生產工單之預計完成日：同一訂單若有多張工單，顯示其中最晚的一日（與「預計交貨」可不同）。點訂單編號於此頁開啟訂單總覽（不另開視窗）；「編輯訂單」將前往內部訂單管理。
            </p>
          )}
        </div>
      </div>

      <OrderOverviewDialog
        open={overviewOrderId != null}
        onOpenChange={(open) => {
          if (!open) setOverviewOrderId(null);
        }}
        orderId={overviewOrderId}
        visualTone="warm"
        onEditOrder={(id) => {
          setOverviewOrderId(null);
          if (typeof window !== "undefined") {
            window.location.assign(
              `/?page=orders&openOrder=${encodeURIComponent(id)}`,
            );
          }
        }}
      />
    </div>
  );
}
