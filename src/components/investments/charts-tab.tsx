"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildAllocation,
  buildValueSeries,
  dividendBuckets,
  rangeMonthFrom,
  rangeStart,
  realizedByYear,
  yearlySummary,
  type ChartRange,
  type PriceSeries,
} from "@/lib/invest-charts";
import { resolvePrices, type PortfolioResult } from "@/lib/invest-portfolio";
import type { InvestMarket } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { formatNumber, todayIso } from "@/components/investments/invest-ui";
import { AllocationCard } from "@/components/investments/allocation-card";
import { DividendChartCard, type DividendView } from "@/components/investments/dividend-chart-card";
import { TrendCard, type TrendStatus } from "@/components/investments/trend-card";
import { RealizedChartCard, YearlySummaryCard } from "@/components/investments/yearly-cards";

/** 歷史收盤價（invest_price_series）讀取狀態；切到圖表分頁時才讀 */
export type PriceSeriesState =
  | { status: "loading" }
  | { status: "ready"; series: Map<string, PriceSeries> }
  | { status: "error"; message: string };

const RANGES: { value: ChartRange; label: string }[] = [
  { value: "3m", label: "3 個月" },
  { value: "6m", label: "6 個月" },
  { value: "1y", label: "1 年" },
  { value: "all", label: "全部" },
];

export function ChartsTab({
  data,
  portfolio,
  accountFilter,
  priceSeries,
}: {
  data: InvestData;
  portfolio: PortfolioResult;
  accountFilter: string;
  priceSeries: PriceSeriesState | null;
}) {
  const [range, setRange] = useState<ChartRange>("all");
  const [dividendView, setDividendView] = useState<DividendView>("month");
  const today = todayIso();
  const prices = priceSeries?.status === "ready" ? priceSeries.series : null;
  const usdTwdSeries = prices?.get("USDTWD");
  const fallbackUsdTwd = data.usdTwd?.rate ?? null;

  const inFilter = (accountId: string) => accountFilter === "all" || accountId === accountFilter;
  const trades = data.trades.filter((t) => inFilter(t.account_id));
  const dividends = data.dividends.filter((d) => inFilter(d.account_id));
  const accounts = data.accounts.filter((a) => inFilter(a.id));
  const marketByAccount = new Map(data.accounts.map((a) => [a.id, a.market]));
  const hasMarket = (market: InvestMarket) =>
    accounts.some((a) => a.market === market) || dividends.some((d) => marketByAccount.get(d.account_id) === market);
  const markets = { tw: hasMarket("TW"), us: hasMarket("US") };

  // 每日市值要重播全部交易，資料或篩選沒變時沿用
  const series = useMemo(() => {
    if (!prices) return [];
    const inAccount = (accountId: string) => accountFilter === "all" || accountId === accountFilter;
    return buildValueSeries({
      trades: data.trades.filter((t) => inAccount(t.account_id)),
      actions: data.actions.filter((a) => inAccount(a.account_id)),
      splitActions: data.actions,
      prices,
      usdTwd: prices.get("USDTWD"),
      fallbackUsdTwd: data.usdTwd?.rate ?? null,
      today,
    });
  }, [data, accountFilter, prices, today]);

  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        還沒有交易紀錄。到「交易紀錄」匯入對帳單後就會出現圖表。
      </div>
    );
  }

  const start = rangeStart(range, today);
  const shownPoints = start ? series.filter((p) => p.date >= start) : series;
  const trendStatus: TrendStatus =
    priceSeries == null || priceSeries.status === "loading"
      ? { kind: "loading" }
      : priceSeries.status === "error"
        ? { kind: "error", message: priceSeries.message }
        : { kind: "ready" };

  const firstDate = [...trades.map((t) => t.trade_date), ...dividends.map((d) => d.ex_date)].reduce((min, d) =>
    d < min ? d : min
  );
  const firstMonth = firstDate.slice(0, 7);
  const thisMonth = today.slice(0, 7);
  const dividendOptions = { dividends, marketByAccount, usdTwd: usdTwdSeries, fallbackUsdTwd };
  const shownDividends = dividendBuckets({
    ...dividendOptions,
    granularity: dividendView,
    from: dividendView === "month" ? rangeMonthFrom(range, today, firstMonth) : firstMonth,
    to: thisMonth,
  });
  const dividendYears = dividendBuckets({ ...dividendOptions, granularity: "year", from: firstMonth, to: thisMonth });
  const dividendTotal = dividendYears.reduce((s, b) => s + b.tw + b.us, 0);

  const realized = realizedByYear({
    trades,
    realizedByTradeId: portfolio.realizedByTradeId,
    usdTwd: usdTwdSeries,
    fallbackUsdTwd,
  });
  const summary = yearlySummary(dividendYears, realized);

  const positions = portfolio.positions.filter((p) => inFilter(p.accountId) && p.quantity > 0);
  const resolved = resolvePrices(
    positions.map((p) => p.symbol),
    data.quotes,
    data.marketPrices
  );
  const allocation = buildAllocation({
    positions,
    priceBySymbol: new Map([...resolved].map(([symbol, r]) => [symbol, r.price])),
    marketByAccount,
    usdTwd: fallbackUsdTwd,
  });
  const hasUsdPositions = positions.some((p) => p.currency === "USD");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">期間</span>
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={range === r.value}
            onClick={() => setRange(r.value)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring sm:h-8",
              range === r.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {r.label}
          </button>
        ))}
        <span className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          金額皆為台幣；期間套用到總資產走勢與每月股利
        </span>
      </div>

      <TrendCard points={shownPoints} latest={series.at(-1) ?? null} status={trendStatus} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AllocationCard
          allocation={allocation}
          fxNote={
            hasUsdPositions && data.usdTwd
              ? `美股以 1 USD = ${formatNumber(data.usdTwd.rate, 3)} TWD 換算（${data.usdTwd.date}）`
              : null
          }
        />
        <DividendChartCard
          buckets={shownDividends}
          view={dividendView}
          onViewChange={setDividendView}
          total={dividendTotal}
          markets={markets}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RealizedChartCard rows={[...realized].map(([year, value]) => ({ year, value }))} />
        <YearlySummaryCard rows={summary.rows} total={summary.total} markets={markets} />
      </div>
    </div>
  );
}
