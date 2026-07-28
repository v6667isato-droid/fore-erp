"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import {
  normalizeWorkOrderStage,
  type WorkOrderStage,
} from "@/lib/work-order-stages";

type Granularity = "month" | "quarter" | "year";
type Metric = "quantity" | "revenue";

type WorkOrderStatRow = {
  id: string;
  order_item_id: string;
  stage: string | null;
  assignee_id: string | null;
};

type OrderRow = {
  id: string;
  order_number: string;
  order_date: string | null;
  status: string | null;
  deleted_at: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string | null;
  variant_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  channel_unit_price: number | null;
  custom_category: string | null;
  custom_name: string | null;
};

type VariantRow = {
  id: string;
  product_code: string;
  series_id: string | null;
  wood_type: string | null;
  spec1: string | null;
};

type SeriesRow = {
  id: string;
  series_name: string | null;
  category: string | null;
};

type EmployeeRow = {
  id: string;
  name: string | null;
};

/** 明細來源（回推訂單用）：一筆完成工單對應的訂單與期別 */
type DrillEntry = {
  orderId: string;
  periodKey: string;
  quantity: number;
  revenue: number;
};

/** 回推訂單清單中的一列（同一訂單彙總） */
type DrilldownOrderRow = {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  quantity: number;
  revenue: number;
};

type DrilldownState = {
  title: string;
  periodText: string;
  rows: DrilldownOrderRow[];
};

/** 分類 → 系列 → 品號 三層統計節點 */
type StatNode = {
  label: string;
  /** 品號層的中文規格（木種、座面） */
  sublabel?: string;
  quantityByPeriod: Map<string, number>;
  revenueByPeriod: Map<string, number>;
  totalQuantity: number;
  totalRevenue: number;
  children: Map<string, StatNode>;
  entries: DrillEntry[];
};

const CUSTOM_CATEGORY_FALLBACK = "客製/其他";
const CUSTOM_SERIES_LABEL = "客製品項";

/** 員工篩選之「未指派」選項值（避免與 employees.id 衝突） */
const UNASSIGNED_FILTER = "__unassigned__";

/** 工單到達這些工序即視為「已完成」：包裝管理、待出貨、已出貨 */
const COMPLETED_STAGES: ReadonlySet<WorkOrderStage> = new Set<WorkOrderStage>([
  "包裝管理",
  "待出貨",
  "已出貨",
]);

function makeNode(label: string, sublabel?: string): StatNode {
  return {
    label,
    sublabel,
    quantityByPeriod: new Map(),
    revenueByPeriod: new Map(),
    totalQuantity: 0,
    totalRevenue: 0,
    children: new Map(),
    entries: [],
  };
}

function addToNode(node: StatNode, entry: DrillEntry) {
  const { periodKey, quantity, revenue } = entry;
  node.quantityByPeriod.set(periodKey, (node.quantityByPeriod.get(periodKey) ?? 0) + quantity);
  node.revenueByPeriod.set(periodKey, (node.revenueByPeriod.get(periodKey) ?? 0) + revenue);
  node.totalQuantity += quantity;
  node.totalRevenue += revenue;
  node.entries.push(entry);
}

/** order_date（YYYY-MM-DD）→ 期別 key */
function periodKeyOf(orderDate: string, granularity: Granularity): string {
  const y = orderDate.slice(0, 4);
  if (granularity === "year") return y;
  const m = Number(orderDate.slice(5, 7));
  if (granularity === "quarter") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return orderDate.slice(0, 7);
}

/** Supabase 預設單次最多回 1000 筆；分頁抓齊全部資料 */
async function fetchAllRows<T>(
  table:
    | "work_orders"
    | "orders"
    | "order_items"
    | "product_variants"
    | "product_series"
    | "employees",
  columns: string,
): Promise<{ rows: T[]; error: string | null }> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) return { rows: [], error: error.message };
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { rows, error: null };
}

function formatQuantity(value: number): string {
  return value.toLocaleString("zh-TW");
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(",");
}

function openOrderInManagement(orderId: string) {
  window.open(`/?page=orders&openOrder=${encodeURIComponent(orderId)}`, "_blank", "noopener");
}

export function EmployeeCompletionStatisticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderStatRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [seriesRows, setSeriesRows] = useState<SeriesRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  const [granularity, setGranularity] = useState<Granularity>("month");
  const [metric, setMetric] = useState<Metric>("quantity");
  const [statYear, setStatYear] = useState(() => new Date().getFullYear());
  /** ""＝全部員工、UNASSIGNED_FILTER＝未指派、其餘為 employees.id */
  const [employeeFilterId, setEmployeeFilterId] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const [workOrderRes, orderRes, itemRes, variantRes, seriesRes, employeeRes] =
        await Promise.all([
          fetchAllRows<WorkOrderStatRow>("work_orders", "id,order_item_id,stage,assignee_id"),
          fetchAllRows<OrderRow>("orders", "id,order_number,order_date,status,deleted_at"),
          fetchAllRows<OrderItemRow>(
            "order_items",
            "id,order_id,variant_id,quantity,unit_price,channel_unit_price,custom_category,custom_name",
          ),
          fetchAllRows<VariantRow>("product_variants", "id,product_code,series_id,wood_type,spec1"),
          fetchAllRows<SeriesRow>("product_series", "id,series_name,category"),
          fetchAllRows<EmployeeRow>("employees", "id,name"),
        ]);

      if (cancelled) return;

      const firstError =
        workOrderRes.error ??
        orderRes.error ??
        itemRes.error ??
        variantRes.error ??
        seriesRes.error ??
        employeeRes.error;
      if (firstError) {
        setError(firstError);
        setWorkOrders([]);
        setOrders([]);
        setItems([]);
        setVariants([]);
        setSeriesRows([]);
        setEmployees([]);
        setLoading(false);
        return;
      }

      setWorkOrders(workOrderRes.rows);
      setOrders(orderRes.rows.filter((o) => !o.deleted_at));
      setItems(itemRes.rows);
      setVariants(variantRes.rows);
      setSeriesRows(seriesRes.rows);
      setEmployees(employeeRes.rows);
      setLoading(false);
    }

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  /** 成交訂單（排除報價中）之 id → 訂單資訊 */
  const soldOrderById = useMemo(() => {
    const map = new Map<string, { date: string; orderNumber: string }>();
    for (const o of orders) {
      const date = (o.order_date ?? "").trim();
      if (!date || date.length < 10) continue;
      if ((o.status ?? "").trim() === "報價中") continue;
      map.set(o.id, { date, orderNumber: o.order_number });
    }
    return map;
  }, [orders]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) {
      const name = (e.name ?? "").trim();
      if (name) map.set(e.id, name);
    }
    return map;
  }, [employees]);

  /** 已完成工單（工序到達包裝管理／待出貨／已出貨） */
  const completedWorkOrders = useMemo(
    () => workOrders.filter((w) => COMPLETED_STAGES.has(normalizeWorkOrderStage(w.stage))),
    [workOrders],
  );

  /** 員工下拉選項：僅列出實際負責過完成工單的員工 */
  const employeeOptions = useMemo(() => {
    const ids = new Set<string>();
    let hasUnassigned = false;
    for (const w of completedWorkOrders) {
      if (w.assignee_id) ids.add(w.assignee_id);
      else hasUnassigned = true;
    }
    const options = Array.from(ids)
      .map((id) => ({ id, name: employeeNameById.get(id) ?? "（未知員工）" }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
    return { options, hasUnassigned };
  }, [completedWorkOrders, employeeNameById]);

  const selectedEmployeeName =
    employeeFilterId === ""
      ? null
      : employeeFilterId === UNASSIGNED_FILTER
        ? "未指派"
        : (employeeNameById.get(employeeFilterId) ?? "（未知員工）");

  const yearOptions = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    for (const info of soldOrderById.values()) {
      const y = Number(info.date.slice(0, 4));
      if (Number.isFinite(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [soldOrderById]);

  const computed = useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const seriesById = new Map(seriesRows.map((s) => [s.id, s]));

    const periodKeys: string[] = [];
    if (granularity === "month") {
      for (let m = 1; m <= 12; m++) periodKeys.push(`${statYear}-${String(m).padStart(2, "0")}`);
    } else if (granularity === "quarter") {
      for (let q = 1; q <= 4; q++) periodKeys.push(`${statYear}-Q${q}`);
    } else {
      const years = new Set<string>();
      for (const info of soldOrderById.values()) years.add(info.date.slice(0, 4));
      periodKeys.push(...Array.from(years).sort());
    }

    const grand = makeNode("全部合計");
    const categories = new Map<string, StatNode>();
    let workOrderCount = 0;

    for (const workOrder of completedWorkOrders) {
      if (employeeFilterId === UNASSIGNED_FILTER) {
        if (workOrder.assignee_id) continue;
      } else if (employeeFilterId) {
        if (workOrder.assignee_id !== employeeFilterId) continue;
      }

      const item = itemById.get(workOrder.order_item_id);
      if (!item) continue;
      const orderInfo = item.order_id ? soldOrderById.get(item.order_id) : undefined;
      if (!orderInfo) continue;
      const orderDate = orderInfo.date;
      if (granularity !== "year" && !orderDate.startsWith(`${statYear}-`)) continue;

      const quantity = Number(item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      // 結算單價：通路價快照（儲存訂單時寫入）優先，否則採牌價
      const unitPrice = Number(item.channel_unit_price ?? item.unit_price ?? 0);
      const revenue = (Number.isFinite(unitPrice) ? unitPrice : 0) * quantity;
      const periodKey = periodKeyOf(orderDate, granularity);

      const variant = item.variant_id ? variantById.get(item.variant_id) : undefined;
      const series = variant?.series_id ? seriesById.get(variant.series_id) : undefined;
      const categoryLabel = variant
        ? ((series?.category ?? "").trim() || "未分類")
        : ((item.custom_category ?? "").trim() || CUSTOM_CATEGORY_FALLBACK);
      const seriesLabel = variant
        ? ((series?.series_name ?? "").trim() || "未知系列")
        : CUSTOM_SERIES_LABEL;
      const leafLabel = variant
        ? variant.product_code
        : ((item.custom_name ?? "").trim() || "未命名品項");
      const leafSublabel = variant
        ? [variant.wood_type, variant.spec1]
            .map((value) => (value ?? "").trim())
            .filter(Boolean)
            .join("・")
        : "";

      let categoryNode = categories.get(categoryLabel);
      if (!categoryNode) {
        categoryNode = makeNode(categoryLabel);
        categories.set(categoryLabel, categoryNode);
      }
      let seriesNode = categoryNode.children.get(seriesLabel);
      if (!seriesNode) {
        seriesNode = makeNode(seriesLabel);
        categoryNode.children.set(seriesLabel, seriesNode);
      }
      let leafNode = seriesNode.children.get(leafLabel);
      if (!leafNode) {
        leafNode = makeNode(leafLabel, leafSublabel || undefined);
        seriesNode.children.set(leafLabel, leafNode);
      }

      const entry: DrillEntry = { orderId: item.order_id!, periodKey, quantity, revenue };
      addToNode(grand, entry);
      addToNode(categoryNode, entry);
      addToNode(seriesNode, entry);
      addToNode(leafNode, entry);
      workOrderCount += 1;
    }

    const totalOf = (node: StatNode) =>
      metric === "quantity" ? node.totalQuantity : node.totalRevenue;
    const sortNodes = (nodes: Iterable<StatNode>) =>
      Array.from(nodes).sort((a, b) => totalOf(b) - totalOf(a));

    const categoryList = sortNodes(categories.values()).map((categoryNode) => ({
      node: categoryNode,
      seriesList: sortNodes(categoryNode.children.values()).map((seriesNode) => ({
        node: seriesNode,
        leafList: sortNodes(seriesNode.children.values()),
      })),
    }));

    return { periodKeys, grand, categoryList, workOrderCount };
  }, [
    completedWorkOrders,
    items,
    variants,
    seriesRows,
    soldOrderById,
    granularity,
    statYear,
    metric,
    employeeFilterId,
  ]);

  function periodLabel(key: string): string {
    if (granularity === "month") return `${Number(key.slice(5, 7))}月`;
    if (granularity === "quarter") return key.slice(5);
    return `${key}年`;
  }

  function cellValue(node: StatNode, periodKey: string): number {
    return metric === "quantity"
      ? (node.quantityByPeriod.get(periodKey) ?? 0)
      : (node.revenueByPeriod.get(periodKey) ?? 0);
  }

  function formatMetric(value: number): string {
    return metric === "quantity" ? formatQuantity(value) : formatMoney(value);
  }

  function toggleCategory(label: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleSeries(key: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 回推訂單：彙整節點（可限定期別）的來源訂單清單並開啟對話框 */
  function openDrilldown(node: StatNode, nodeTitle: string, periodKey: string | null) {
    const source = periodKey
      ? node.entries.filter((e) => e.periodKey === periodKey)
      : node.entries;
    const byOrder = new Map<string, DrilldownOrderRow>();
    for (const entry of source) {
      const orderInfo = soldOrderById.get(entry.orderId);
      if (!orderInfo) continue;
      let row = byOrder.get(entry.orderId);
      if (!row) {
        row = {
          orderId: entry.orderId,
          orderNumber: orderInfo.orderNumber,
          orderDate: orderInfo.date,
          quantity: 0,
          revenue: 0,
        };
        byOrder.set(entry.orderId, row);
      }
      row.quantity += entry.quantity;
      row.revenue += entry.revenue;
    }
    const rows = Array.from(byOrder.values()).sort(
      (a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNumber.localeCompare(a.orderNumber),
    );
    const rangeText =
      periodKey != null
        ? granularity === "year"
          ? periodLabel(periodKey)
          : `${statYear}年${periodLabel(periodKey)}`
        : granularity === "year"
          ? "全部年度"
          : `${statYear}年合計`;
    setDrilldown({ title: nodeTitle, periodText: rangeText, rows });
  }

  function handleExportCsv() {
    const { periodKeys, grand, categoryList } = computed;
    const periodHeader = periodKeys.map(periodLabel);

    function buildSection(title: string, useMetric: Metric): string[] {
      const valueOf = (node: StatNode, key: string) =>
        useMetric === "quantity"
          ? (node.quantityByPeriod.get(key) ?? 0)
          : Math.round(node.revenueByPeriod.get(key) ?? 0);
      const nodeRow = (category: string, series: string, code: string, node: StatNode) =>
        csvRow([
          category,
          series,
          code,
          node.sublabel ?? "",
          ...periodKeys.map((k) => valueOf(node, k)),
          node.totalQuantity,
          Math.round(node.totalRevenue),
        ]);

      const lines = [
        csvRow([title]),
        csvRow(["分類", "系列", "品號", "規格", ...periodHeader, "合計數量", "總金額"]),
        nodeRow("全部合計", "", "", grand),
      ];
      for (const { node: categoryNode, seriesList } of categoryList) {
        lines.push(nodeRow(categoryNode.label, "", "", categoryNode));
        for (const { node: seriesNode, leafList } of seriesList) {
          lines.push(nodeRow(categoryNode.label, seriesNode.label, "", seriesNode));
          for (const leaf of leafList) {
            lines.push(nodeRow(categoryNode.label, seriesNode.label, leaf.label, leaf));
          }
        }
      }
      return lines;
    }

    const granularityLabel =
      granularity === "month" ? "月" : granularity === "quarter" ? "季" : "年";
    const rangeLabel = granularity === "year" ? "全部年度" : `${statYear}年`;
    const scopeLabel = selectedEmployeeName
      ? `${rangeLabel}／${granularityLabel}／${selectedEmployeeName}`
      : `${rangeLabel}／${granularityLabel}`;
    const sections = [
      buildSection(`員工完成數量（${scopeLabel}）`, "quantity"),
      buildSection(`員工完成金額（${scopeLabel}）`, "revenue"),
    ];

    const lines: string[] = [];
    for (const section of sections) {
      if (lines.length > 0) lines.push("");
      lines.push(...section);
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const employeeSuffix = selectedEmployeeName ? `_${selectedEmployeeName}` : "";
    a.download = `員工完成統計_${rangeLabel}_${granularityLabel}${employeeSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const valueCellClass = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const drillButtonClass =
    "rounded px-0.5 underline-offset-2 hover:underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  function renderValueCells(node: StatNode, nodeTitle: string, muted = false) {
    return (
      <>
        {computed.periodKeys.map((key) => {
          const value = cellValue(node, key);
          return (
            <td key={key} className={valueCellClass}>
              {value === 0 ? (
                <span className="text-muted-foreground/50">–</span>
              ) : (
                <button
                  type="button"
                  onClick={() => openDrilldown(node, nodeTitle, key)}
                  title="點擊回推來源訂單"
                  className={`${drillButtonClass} ${muted ? "text-muted-foreground" : ""}`}
                >
                  {formatMetric(value)}
                </button>
              )}
            </td>
          );
        })}
        <td className={`${valueCellClass} font-medium`}>
          {node.totalQuantity === 0 ? (
            formatQuantity(0)
          ) : (
            <button
              type="button"
              onClick={() => openDrilldown(node, nodeTitle, null)}
              title="點擊回推來源訂單"
              className={drillButtonClass}
            >
              {formatQuantity(node.totalQuantity)}
            </button>
          )}
        </td>
        <td className={`${valueCellClass} font-medium`}>
          {node.totalRevenue === 0 ? (
            formatMoney(0)
          ) : (
            <button
              type="button"
              onClick={() => openDrilldown(node, nodeTitle, null)}
              title="點擊回推來源訂單"
              className={drillButtonClass}
            >
              {formatMoney(node.totalRevenue)}
            </button>
          )}
        </td>
      </>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          統計各員工負責且已完成（工序到達包裝管理／待出貨／已出貨）之工單品項
          {metric === "quantity" ? "數量" : "金額"}
          ，期別依訂單日期；排除「報價中」與已刪除的訂單。金額以通路價優先、否則採牌價（不含運費）。點分類與系列列可展開至品號；點表格中的數字可回推來源訂單。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="employee-completion-filter">
            依員工篩選
          </label>
          <select
            id="employee-completion-filter"
            value={employeeFilterId}
            onChange={(e) => setEmployeeFilterId(e.target.value)}
            className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            <option value="">全部員工</option>
            {employeeOptions.options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            {employeeOptions.hasUnassigned && (
              <option value={UNASSIGNED_FILTER}>未指派</option>
            )}
          </select>
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
            {(
              [
                { value: "month", label: "月" },
                { value: "quarter", label: "季" },
                { value: "year", label: "年" },
              ] satisfies { value: Granularity; label: string }[]
            ).map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={granularity === option.value ? "default" : "ghost"}
                className="h-8 px-3 text-xs"
                onClick={() => setGranularity(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
            {(
              [
                { value: "quantity", label: "數量" },
                { value: "revenue", label: "金額" },
              ] satisfies { value: Metric; label: string }[]
            ).map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={metric === option.value ? "default" : "ghost"}
                className="h-8 px-3 text-xs"
                onClick={() => setMetric(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {granularity !== "year" && (
            <>
              <label className="sr-only" htmlFor="employee-completion-stat-year">
                統計年份
              </label>
              <select
                id="employee-completion-stat-year"
                value={statYear}
                onChange={(e) => setStatYear(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleExportCsv}
            disabled={loading || !!error}
          >
            <Download className="h-3.5 w-3.5" />
            匯出 CSV
          </Button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          載入員工完成統計中…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              分類 × {granularity === "month" ? "月份" : granularity === "quarter" ? "季度" : "年度"}
              完成{metric === "quantity" ? "數量" : "金額"}
              {selectedEmployeeName && (
                <span className="ml-2 font-normal text-muted-foreground">
                  — 員工：{selectedEmployeeName}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              共 {computed.workOrderCount} 張完成工單納入統計
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">品項</th>
                  {computed.periodKeys.map((key) => (
                    <th key={key} className="px-3 py-2 text-right font-medium">
                      {periodLabel(key)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">合計數量</th>
                  <th className="px-3 py-2 text-right font-medium">總金額</th>
                </tr>
              </thead>
              <tbody>
                {computed.categoryList.length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-center text-muted-foreground"
                      colSpan={computed.periodKeys.length + 3}
                    >
                      這個範圍尚無完成資料
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr className="border-b border-border bg-muted/40 font-semibold text-foreground">
                      <td className="px-4 py-2">全部合計</td>
                      {renderValueCells(computed.grand, "全部合計")}
                    </tr>
                    {computed.categoryList.map(({ node: categoryNode, seriesList }) => {
                      const categoryOpen = expandedCategories.has(categoryNode.label);
                      return (
                        <Fragment key={categoryNode.label}>
                          <tr className="border-b border-border/70 font-medium text-foreground">
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => toggleCategory(categoryNode.label)}
                                className="inline-flex items-center gap-2 rounded-md text-left hover:bg-muted/60"
                                aria-expanded={categoryOpen}
                              >
                                {categoryOpen ? (
                                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <span>{categoryNode.label}</span>
                              </button>
                            </td>
                            {renderValueCells(categoryNode, categoryNode.label)}
                          </tr>
                          {categoryOpen &&
                            seriesList.map(({ node: seriesNode, leafList }) => {
                              const seriesKey = `${categoryNode.label}::${seriesNode.label}`;
                              const seriesOpen = expandedSeries.has(seriesKey);
                              return (
                                <Fragment key={seriesKey}>
                                  <tr className="border-b border-border/60">
                                    <td className="px-4 py-2 pl-9">
                                      <button
                                        type="button"
                                        onClick={() => toggleSeries(seriesKey)}
                                        className="inline-flex items-center gap-2 rounded-md text-left hover:bg-muted/60"
                                        aria-expanded={seriesOpen}
                                      >
                                        {seriesOpen ? (
                                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        )}
                                        <span>{seriesNode.label}</span>
                                      </button>
                                    </td>
                                    {renderValueCells(
                                      seriesNode,
                                      `${categoryNode.label}｜${seriesNode.label}`,
                                    )}
                                  </tr>
                                  {seriesOpen &&
                                    leafList.map((leaf) => (
                                      <tr
                                        key={`${seriesKey}::${leaf.label}`}
                                        className="border-b border-border/50"
                                      >
                                        <td className="px-4 py-2 pl-16 whitespace-nowrap">
                                          <span className="font-mono text-xs text-muted-foreground">
                                            {leaf.label}
                                          </span>
                                          {leaf.sublabel && (
                                            <span className="ml-2 text-xs text-muted-foreground/80">
                                              {leaf.sublabel}
                                            </span>
                                          )}
                                        </td>
                                        {renderValueCells(
                                          leaf,
                                          `${seriesNode.label}｜${leaf.label}`,
                                          true,
                                        )}
                                      </tr>
                                    ))}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog.Root open={drilldown !== null} onOpenChange={(open) => !open && setDrilldown(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card shadow-lg focus:outline-none">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-foreground">
                  來源訂單 — {drilldown?.title}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                  {drilldown?.periodText}
                  {selectedEmployeeName ? `・員工：${selectedEmployeeName}` : ""}・共{" "}
                  {drilldown?.rows.length ?? 0} 張訂單，合計{" "}
                  {formatQuantity(drilldown?.rows.reduce((sum, r) => sum + r.quantity, 0) ?? 0)}{" "}
                  件、NT$ {formatMoney(drilldown?.rows.reduce((sum, r) => sum + r.revenue, 0) ?? 0)}
                  。點訂單編號可開啟訂單。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto px-5 py-3">
              {drilldown && drilldown.rows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  找不到來源訂單
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">訂單編號</th>
                      <th className="py-2 pr-3 font-medium">訂單日期</th>
                      <th className="py-2 pr-3 text-right font-medium">數量</th>
                      <th className="py-2 text-right font-medium">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown?.rows.map((row) => (
                      <tr key={row.orderId} className="border-b border-border/50">
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => openOrderInManagement(row.orderId)}
                            className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline-offset-2 hover:underline"
                            title="在新分頁開啟訂單"
                          >
                            {row.orderNumber}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                          {row.orderDate}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatQuantity(row.quantity)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatMoney(row.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
