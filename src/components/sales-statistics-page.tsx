"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

type Granularity = "month" | "quarter" | "year";
type Metric = "quantity" | "revenue";

type SalesOrderRow = {
  id: string;
  order_date: string | null;
  status: string | null;
};

type SalesOrderItemRow = {
  order_id: string | null;
  variant_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  channel_unit_price: number | null;
  custom_category: string | null;
  custom_name: string | null;
};

type SalesVariantRow = {
  id: string;
  product_code: string;
  series_id: string | null;
  wood_type: string | null;
  spec1: string | null;
};

type SalesSeriesRow = {
  id: string;
  series_name: string | null;
  category: string | null;
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
};

const CUSTOM_CATEGORY_FALLBACK = "客製/其他";
const CUSTOM_SERIES_LABEL = "客製品項";

function makeNode(label: string, sublabel?: string): StatNode {
  return {
    label,
    sublabel,
    quantityByPeriod: new Map(),
    revenueByPeriod: new Map(),
    totalQuantity: 0,
    totalRevenue: 0,
    children: new Map(),
  };
}

function addToNode(node: StatNode, periodKey: string, quantity: number, revenue: number) {
  node.quantityByPeriod.set(periodKey, (node.quantityByPeriod.get(periodKey) ?? 0) + quantity);
  node.revenueByPeriod.set(periodKey, (node.revenueByPeriod.get(periodKey) ?? 0) + revenue);
  node.totalQuantity += quantity;
  node.totalRevenue += revenue;
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
  table: "orders" | "order_items" | "product_variants" | "product_series",
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

export function SalesStatisticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<SalesOrderRow[]>([]);
  const [items, setItems] = useState<SalesOrderItemRow[]>([]);
  const [variants, setVariants] = useState<SalesVariantRow[]>([]);
  const [seriesRows, setSeriesRows] = useState<SalesSeriesRow[]>([]);

  const [granularity, setGranularity] = useState<Granularity>("month");
  const [metric, setMetric] = useState<Metric>("quantity");
  const [statYear, setStatYear] = useState(() => new Date().getFullYear());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const [orderRes, itemRes, variantRes, seriesRes] = await Promise.all([
        fetchAllRows<SalesOrderRow>("orders", "id,order_date,status,deleted_at"),
        fetchAllRows<SalesOrderItemRow>(
          "order_items",
          "order_id,variant_id,quantity,unit_price,channel_unit_price,custom_category,custom_name",
        ),
        fetchAllRows<SalesVariantRow>(
          "product_variants",
          "id,product_code,series_id,wood_type,spec1",
        ),
        fetchAllRows<SalesSeriesRow>("product_series", "id,series_name,category"),
      ]);

      if (cancelled) return;

      const firstError =
        orderRes.error ?? itemRes.error ?? variantRes.error ?? seriesRes.error;
      if (firstError) {
        setError(firstError);
        setOrders([]);
        setItems([]);
        setVariants([]);
        setSeriesRows([]);
        setLoading(false);
        return;
      }

      setOrders(
        (orderRes.rows as Array<SalesOrderRow & { deleted_at: string | null }>).filter(
          (o) => !o.deleted_at,
        ),
      );
      setItems(itemRes.rows);
      setVariants(variantRes.rows);
      setSeriesRows(seriesRes.rows);
      setLoading(false);
    }

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  /** 成交訂單（排除報價中）之 id → 下單日 */
  const soldOrderDateById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      const date = (o.order_date ?? "").trim();
      if (!date || date.length < 10) continue;
      if ((o.status ?? "").trim() === "報價中") continue;
      map.set(o.id, date);
    }
    return map;
  }, [orders]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    for (const date of soldOrderDateById.values()) {
      const y = Number(date.slice(0, 4));
      if (Number.isFinite(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [soldOrderDateById]);

  const computed = useMemo(() => {
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const seriesById = new Map(seriesRows.map((s) => [s.id, s]));

    const periodKeys: string[] = [];
    if (granularity === "month") {
      for (let m = 1; m <= 12; m++) periodKeys.push(`${statYear}-${String(m).padStart(2, "0")}`);
    } else if (granularity === "quarter") {
      for (let q = 1; q <= 4; q++) periodKeys.push(`${statYear}-Q${q}`);
    } else {
      const years = new Set<string>();
      for (const date of soldOrderDateById.values()) years.add(date.slice(0, 4));
      periodKeys.push(...Array.from(years).sort());
    }

    const grand = makeNode("全部合計");
    const categories = new Map<string, StatNode>();
    let itemCount = 0;

    for (const item of items) {
      const orderDate = item.order_id ? soldOrderDateById.get(item.order_id) : undefined;
      if (!orderDate) continue;
      if (granularity !== "year" && !orderDate.startsWith(`${statYear}-`)) continue;

      const quantity = Number(item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
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

      addToNode(grand, periodKey, quantity, revenue);
      addToNode(categoryNode, periodKey, quantity, revenue);
      addToNode(seriesNode, periodKey, quantity, revenue);
      addToNode(leafNode, periodKey, quantity, revenue);
      itemCount += 1;
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

    return { periodKeys, grand, categoryList, itemCount };
  }, [items, variants, seriesRows, soldOrderDateById, granularity, statYear, metric]);

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
    const sections = [
      buildSection(`銷售數量（${rangeLabel}／${granularityLabel}）`, "quantity"),
      buildSection(`銷售金額（${rangeLabel}／${granularityLabel}）`, "revenue"),
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
    a.download = `銷售統計_${rangeLabel}_${granularityLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const valueCellClass = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

  function renderValueCells(node: StatNode, muted = false) {
    return (
      <>
        {computed.periodKeys.map((key) => {
          const value = cellValue(node, key);
          return (
            <td key={key} className={valueCellClass}>
              {value === 0 ? (
                <span className="text-muted-foreground/50">–</span>
              ) : (
                <span className={muted ? "text-muted-foreground" : undefined}>
                  {formatMetric(value)}
                </span>
              )}
            </td>
          );
        })}
        <td className={`${valueCellClass} font-medium`}>
          {formatQuantity(node.totalQuantity)}
        </td>
        <td className={`${valueCellClass} font-medium`}>{formatMoney(node.totalRevenue)}</td>
      </>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          依訂單日期統計各品項分類的銷售{metric === "quantity" ? "數量" : "金額"}
          ；排除「報價中」與已刪除的訂單。金額以通路價優先、否則採牌價（不含運費）。點分類與系列列可展開至品號。
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
              <label className="sr-only" htmlFor="sales-stat-year">
                統計年份
              </label>
              <select
                id="sales-stat-year"
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
          載入銷售統計中…
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
              銷售{metric === "quantity" ? "數量" : "金額"}
            </h2>
            <p className="text-xs text-muted-foreground">
              共 {computed.itemCount} 筆訂單明細納入統計
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
                      這個範圍尚無銷售資料
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr className="border-b border-border bg-muted/40 font-semibold text-foreground">
                      <td className="px-4 py-2">全部合計</td>
                      {renderValueCells(computed.grand)}
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
                            {renderValueCells(categoryNode)}
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
                                    {renderValueCells(seriesNode)}
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
                                        {renderValueCells(leaf, true)}
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
    </section>
  );
}
