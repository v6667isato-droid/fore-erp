"use client";

import { useMemo, useState } from "react";
import {
  useCostStatisticsData,
  yearForPreset,
  type YearPreset,
} from "@/components/cost-statistics/use-cost-statistics-data";
import { loadFixedOverheadForYear, REVENUE_TAX_RATE } from "@/lib/cost-statistics-settings";
import { spreadPurchaseCostByMonth } from "@/lib/purchase-amortization";
import { Button } from "@/components/ui/button";

/** 視為「常規費用（水電／訂閱等固定開銷）」的採購類別 */
const REGULAR_EXPENSE_CATEGORIES = new Set(["常規費用", "軟體"]);

/** 成本大類固定順序與色槽（色彩跟著項目走，不隨金額排序改變） */
const BUCKET_DEFS = [
  { key: "salary", label: "人力（薪資含雇主負擔）", colorVar: "--cr-1" },
  { key: "wood", label: "木料（含攤提）", colorVar: "--cr-2" },
  { key: "material", label: "其他材料", colorVar: "--cr-3" },
  { key: "regular", label: "常規費用（水電等）", colorVar: "--cr-4" },
  { key: "rent", label: "場租", colorVar: "--cr-5" },
  { key: "loan", label: "貸款利息", colorVar: "--cr-6" },
  { key: "tax", label: `稅金（營收 ${REVENUE_TAX_RATE * 100}%）`, colorVar: "--cr-7" },
] as const;

type BucketKey = (typeof BUCKET_DEFS)[number]["key"];

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPct(part: number, whole: number): string {
  if (!(whole > 0)) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function CostRatioPage() {
  const [preset, setPreset] = useState<YearPreset>("this");
  const year = useMemo(() => yearForPreset(preset), [preset]);
  const overhead = useMemo(() => loadFixedOverheadForYear(year), [year]);

  const { loading, error, computed, purchaseRows } = useCostStatisticsData({
    year,
    preset,
    annualRent: overhead.annualRent,
    annualCompanyLoan: overhead.annualCompanyLoanInterest,
  });

  /** 非木料採購（含攤提份額）依類別彙總：常規費用類自成一桶，其餘為材料細分 */
  const categoryBreakdown = useMemo(() => {
    const cutoffYm = computed.ytdCutoffLabel.slice(0, 7);
    const byCategory = new Map<string, number>();
    for (const row of purchaseRows) {
      const spreads = spreadPurchaseCostByMonth(row, { cutoffYm, statYear: year });
      for (const spread of spreads) {
        if (spread.isWood) continue;
        const cat = (row.item_category ?? "").trim() || "未分類";
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + spread.amount);
      }
    }
    const regularItems: { category: string; amount: number }[] = [];
    const materialItems: { category: string; amount: number }[] = [];
    for (const [category, amount] of byCategory) {
      if (amount === 0) continue;
      (REGULAR_EXPENSE_CATEGORIES.has(category) ? regularItems : materialItems).push({
        category,
        amount,
      });
    }
    regularItems.sort((a, b) => b.amount - a.amount);
    materialItems.sort((a, b) => b.amount - a.amount);
    const regularTotal = regularItems.reduce((sum, item) => sum + item.amount, 0);
    return { regularItems, materialItems, regularTotal };
  }, [purchaseRows, computed.ytdCutoffLabel, year]);

  const buckets = useMemo(() => {
    const nonWoodTotal = computed.totalPurchaseNonWood + computed.totalPurchaseAmortized;
    const regular = Math.min(categoryBreakdown.regularTotal, nonWoodTotal);
    const amounts: Record<BucketKey, number> = {
      salary: computed.totalSalaryCost,
      wood: computed.totalPurchaseWood,
      material: nonWoodTotal - regular,
      regular,
      rent: computed.totalRentCost,
      loan: computed.totalCompanyLoanCost,
      tax: computed.totalTaxCost,
    };
    // 占比高者在前；色彩仍固定跟著項目走
    return BUCKET_DEFS.map((def) => ({ ...def, amount: amounts[def.key] })).sort(
      (a, b) => b.amount - a.amount,
    );
  }, [computed, categoryBreakdown.regularTotal]);

  const totalCost = computed.totalCost;
  const maxMaterialAmount = categoryBreakdown.materialItems[0]?.amount ?? 0;

  return (
    <section className="space-y-4">
      {/* 圖表色票：亮／暗版皆為已驗證之分類色序（色彩對應固定項目） */}
      <style>{`
        .cost-ratio-viz {
          --cr-1: #2a78d6;
          --cr-2: #eb6834;
          --cr-3: #1baf7a;
          --cr-4: #eda100;
          --cr-5: #e87ba4;
          --cr-6: #008300;
          --cr-7: #4a3aa7;
        }
        html.dark .cost-ratio-viz {
          --cr-1: #3987e5;
          --cr-2: #d95926;
          --cr-3: #199e70;
          --cr-4: #c98500;
          --cr-5: #d55181;
          --cr-6: #008300;
          --cr-7: #9085e9;
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {year} 年年初至今（截至 {computed.ytdCutoffLabel}）各成本項目占比，僅計實際數、不含
          Q3/Q4 預估攤提；算法與「成本統計」分頁一致。木料攤提併入木料；「常規費用（水電等）」為採購類別
          {[...REGULAR_EXPENSE_CATEGORIES].map((c) => `「${c}」`).join("、")}之支出（含攤提）。
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
          載入成本占比中…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="cost-ratio-viz space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">成本結構</h2>
              <p className="text-xs text-muted-foreground">
                總成本 {formatMoney(totalCost)} · 訂單營收 {formatMoney(computed.totalRevenue)} ·
                成本占營收 {formatPct(totalCost, computed.totalRevenue)}
              </p>
            </div>

            {totalCost > 0 ? (
              <>
                <div className="mt-3 flex h-8 w-full gap-[2px]" role="img" aria-label="成本結構占比長條圖">
                  {buckets
                    .filter((b) => b.amount > 0)
                    .map((b) => (
                      <div
                        key={b.key}
                        title={`${b.label}：${formatMoney(b.amount)}（${formatPct(b.amount, totalCost)}）`}
                        className="h-full rounded-[4px]"
                        style={{
                          width: `${(b.amount / totalCost) * 100}%`,
                          minWidth: 3,
                          background: `var(${b.colorVar})`,
                        }}
                      />
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {buckets.map((b) => (
                    <span key={b.key} className="inline-flex items-center gap-1.5 text-xs text-foreground">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: `var(${b.colorVar})` }}
                      />
                      {b.label}
                      <span className="tabular-nums text-muted-foreground">
                        {formatPct(b.amount, totalCost)}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">這個年度尚無可統計資料</p>
            )}

            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">項目</th>
                    <th className="px-4 py-2 font-medium">金額</th>
                    <th className="px-4 py-2 font-medium">占總成本</th>
                    <th className="px-4 py-2 font-medium">占營收</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.key} className="border-b border-border/70">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                            style={{ background: `var(${b.colorVar})` }}
                          />
                          {b.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(b.amount)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatPct(b.amount, totalCost)}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {formatPct(b.amount, computed.totalRevenue)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-medium text-foreground">
                    <td className="px-4 py-2">總成本</td>
                    <td className="px-4 py-2 tabular-nums">{formatMoney(totalCost)}</td>
                    <td className="px-4 py-2 tabular-nums">{totalCost > 0 ? "100.0%" : "—"}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatPct(totalCost, computed.totalRevenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">其他材料細分（非木料採購，依類別）</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              含各類別攤提份額；不含已列為常規費用之類別。
            </p>
            {categoryBreakdown.materialItems.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">尚無非木料採購資料</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="whitespace-nowrap border-b border-border text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">類別</th>
                      <th className="w-1/2 px-2 py-1.5 font-medium">金額分布</th>
                      <th className="px-2 py-1.5 text-right font-medium">金額</th>
                      <th className="px-2 py-1.5 text-right font-medium">占總成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryBreakdown.materialItems.map((item) => (
                      <tr key={item.category} className="border-b border-border/50">
                        <td className="whitespace-nowrap px-2 py-1.5">{item.category}</td>
                        <td className="px-2 py-1.5">
                          <div
                            className="h-3.5 rounded-[4px]"
                            title={`${item.category}：${formatMoney(item.amount)}`}
                            style={{
                              width: `${maxMaterialAmount > 0 ? Math.max((item.amount / maxMaterialAmount) * 100, 1) : 0}%`,
                              background: "var(--cr-1)",
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatMoney(item.amount)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatPct(item.amount, totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {categoryBreakdown.regularItems.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                常規費用（水電等）組成：
                {categoryBreakdown.regularItems
                  .map((item) => `${item.category} ${formatMoney(item.amount)}`)
                  .join("、")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
