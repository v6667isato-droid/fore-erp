"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type YearPreset = "this" | "last";

type PurchaseCostRow = {
  purchase_date: string;
  tax_included_amount?: number | null;
  amount_ex_tax?: number | null;
};

type OrderRevenueRow = {
  order_date: string;
  total_amount?: number | null;
  status?: string | null;
};

function toCurrency(value: number): string {
  return `NT$ ${Math.round(value).toLocaleString("zh-TW")}`;
}

function monthKey(value: string): string {
  if (!value || value.length < 7) return "";
  return value.slice(0, 7);
}

function monthLabel(key: string): string {
  if (!key) return "未知";
  const [y, m] = key.split("-");
  return `${y}/${m}`;
}

export function CostStatisticsPage() {
  const [preset, setPreset] = useState<YearPreset>("this");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseCostRow[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRevenueRow[]>([]);

  const year = useMemo(() => {
    const now = new Date().getFullYear();
    return preset === "this" ? now : now - 1;
  }, [preset]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const start = `${year}-01-01`;
      const end = `${year}-12-31`;

      const [purchaseRes, orderRes] = await Promise.all([
        supabase
          .from("purchases")
          .select("purchase_date,tax_included_amount,amount_ex_tax")
          .gte("purchase_date", start)
          .lte("purchase_date", end),
        supabase
          .from("orders")
          .select("order_date,total_amount,status")
          .gte("order_date", start)
          .lte("order_date", end),
      ]);

      if (cancelled) return;

      if (purchaseRes.error || orderRes.error) {
        setError(purchaseRes.error?.message ?? orderRes.error?.message ?? "成本資料載入失敗");
        setPurchaseRows([]);
        setOrderRows([]);
        setLoading(false);
        return;
      }

      setPurchaseRows((purchaseRes.data ?? []) as PurchaseCostRow[]);
      setOrderRows((orderRes.data ?? []) as OrderRevenueRow[]);
      setLoading(false);
    }

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [year]);

  const computed = useMemo(() => {
    const costsByMonth = new Map<string, number>();
    const revenueByMonth = new Map<string, number>();

    let totalCost = 0;
    for (const row of purchaseRows) {
      const cost = Number(row.tax_included_amount ?? row.amount_ex_tax ?? 0);
      if (!Number.isFinite(cost)) continue;
      totalCost += cost;
      const key = monthKey(row.purchase_date);
      if (!key) continue;
      costsByMonth.set(key, (costsByMonth.get(key) ?? 0) + cost);
    }

    let totalRevenue = 0;
    for (const row of orderRows) {
      if ((row.status ?? "").trim() === "報價中") continue;
      const amount = Number(row.total_amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      totalRevenue += amount;
      const key = monthKey(row.order_date);
      if (!key) continue;
      revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + amount);
    }

    const monthKeys = Array.from(new Set([...costsByMonth.keys(), ...revenueByMonth.keys()])).sort();
    const monthlyRows = monthKeys.map((key) => {
      const cost = costsByMonth.get(key) ?? 0;
      const revenue = revenueByMonth.get(key) ?? 0;
      const grossProfit = revenue - cost;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      return { key, cost, revenue, grossProfit, grossMargin };
    });

    const grossProfit = totalRevenue - totalCost;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      totalCost,
      totalRevenue,
      grossProfit,
      grossMargin,
      monthlyRows,
      orderCount: orderRows.length,
      purchaseCount: purchaseRows.length,
    };
  }, [orderRows, purchaseRows]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          以 `{year}` 年資料統計（營收排除「報價中」訂單）
        </p>
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
          <Button
            type="button"
            variant={preset === "this" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setPreset("this")}
          >
            本年度
          </Button>
          <Button
            type="button"
            variant={preset === "last" ? "default" : "ghost"}
            className="h-8 px-3 text-xs"
            onClick={() => setPreset("last")}
          >
            去年度
          </Button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          載入成本統計中…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">採購成本</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{toCurrency(computed.totalCost)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">訂單營收</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{toCurrency(computed.totalRevenue)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">毛利</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{toCurrency(computed.grossProfit)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">毛利率</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{computed.grossMargin.toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">每月成本與毛利</h2>
              <p className="text-xs text-muted-foreground">
                採購 {computed.purchaseCount} 筆 / 訂單 {computed.orderCount} 筆
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">月份</th>
                    <th className="px-4 py-2 font-medium">採購成本</th>
                    <th className="px-4 py-2 font-medium">訂單營收</th>
                    <th className="px-4 py-2 font-medium">毛利</th>
                    <th className="px-4 py-2 font-medium">毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.monthlyRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>
                        這個年度尚無可統計資料
                      </td>
                    </tr>
                  ) : (
                    computed.monthlyRows.map((row) => (
                      <tr key={row.key} className="border-b border-border/70 last:border-0">
                        <td className="px-4 py-2">{monthLabel(row.key)}</td>
                        <td className="px-4 py-2">{toCurrency(row.cost)}</td>
                        <td className="px-4 py-2">{toCurrency(row.revenue)}</td>
                        <td className="px-4 py-2">{toCurrency(row.grossProfit)}</td>
                        <td className="px-4 py-2">{row.grossMargin.toFixed(1)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
