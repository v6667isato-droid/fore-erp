"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { cn } from "@/lib/utils";
import { investDb } from "@/lib/invest-client";
import {
  resolvePrices,
  toTwd,
  valuePosition,
  type PortfolioResult,
  type Position,
  type ResolvedPrice,
} from "@/lib/invest-portfolio";
import type { InvestMarket } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { chartColors } from "@/components/investments/chart-ui";
import { Cell, GroupRow, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
import {
  currencyPrefix,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  Panel,
  pnlClass,
  SearchInput,
  Segmented,
  Stat,
} from "@/components/investments/invest-ui";

type CurrencySummary = {
  currency: string;
  cost: number;
  marketValue: number;
  unrealized: number;
  /** 有持股但沒有現價（無收盤價也沒手動輸入）的檔數；> 0 時市值不完整 */
  unpriced: number;
  realized: number;
  dividends: number;
  /** 有持股的檔數 */
  holdings: number;
};

function summarize(
  positions: Position[],
  priceBySymbol: Map<string, number>,
  dividends: InvestData["dividends"]
): CurrencySummary[] {
  const map = new Map<string, CurrencySummary>();
  const get = (currency: string) => {
    let s = map.get(currency);
    if (!s) {
      s = { currency, cost: 0, marketValue: 0, unrealized: 0, unpriced: 0, realized: 0, dividends: 0, holdings: 0 };
      map.set(currency, s);
    }
    return s;
  };
  for (const p of positions) {
    const s = get(p.currency);
    s.realized += p.realizedPnl;
    if (p.quantity <= 0) continue;
    s.holdings += 1;
    s.cost += p.cost;
    const v = valuePosition(p, priceBySymbol.get(p.symbol));
    if (v) {
      s.marketValue += v.marketValue;
      s.unrealized += v.unrealizedPnl;
    } else {
      s.unpriced += 1;
    }
  }
  for (const d of dividends) {
    if (d.received_at) get(d.currency).dividends += d.net_amount;
  }
  return [...map.values()].sort((a, b) => (a.currency === "TWD" ? -1 : b.currency === "TWD" ? 1 : 0));
}

/** 各幣別合計換算台幣（美元以目前匯率換算，不含匯差）；有無法換算的幣別時回 null */
function totalInTwd(summaries: CurrencySummary[], usdTwd: number): CurrencySummary | null {
  const total: CurrencySummary = {
    currency: "TWD",
    cost: 0,
    marketValue: 0,
    unrealized: 0,
    unpriced: 0,
    realized: 0,
    dividends: 0,
    holdings: 0,
  };
  for (const s of summaries) {
    if (toTwd(1, s.currency, usdTwd) == null) return null;
    const conv = (n: number) => toTwd(n, s.currency, usdTwd) ?? 0;
    total.cost += conv(s.cost);
    total.marketValue += conv(s.marketValue);
    total.unrealized += conv(s.unrealized);
    total.realized += conv(s.realized);
    total.dividends += conv(s.dividends);
    total.unpriced += s.unpriced;
    total.holdings += s.holdings;
  }
  return total;
}

const MARKET_LABELS: Record<InvestMarket, string> = { TW: "台股", US: "美股" };
const CURRENCY_LABELS: Record<string, string> = { TWD: "台幣", USD: "美元" };
const MARKET_BAR: Record<InvestMarket, string> = { TW: chartColors.twBg, US: chartColors.usBg };
const TOTAL_SCOPE = "total";

/** 資產總覽：大字市值＋總損益、損益率，下方一列成本與各項損益；可切換台幣合計／各幣別 */
function SummaryPanel({
  summaries,
  twdTotal,
  labelOf,
  usdTwd,
}: {
  summaries: CurrencySummary[];
  twdTotal: CurrencySummary | null;
  labelOf: (currency: string) => string;
  usdTwd: InvestData["usdTwd"];
}) {
  const titleId = useId();
  const options = [
    ...(twdTotal ? [{ value: TOTAL_SCOPE, label: "合計（台幣）" }] : []),
    ...summaries.map((s) => ({ value: s.currency, label: labelOf(s.currency) })),
  ];
  const [picked, setPicked] = useState(TOTAL_SCOPE);
  const scope = options.some((o) => o.value === picked) ? picked : options[0]?.value;
  const s = scope === TOTAL_SCOPE ? twdTotal : summaries.find((c) => c.currency === scope);
  if (!s) return null;

  const totalPnl = s.unrealized + s.realized + s.dividends;
  // 損益率以目前持股成本為分母（已出清部分的成本不在持股成本內，已實現損益與股利仍計入分子）
  const pnlRate = s.cost > 0 ? totalPnl / s.cost : null;
  const unrealizedRate = s.cost > 0 ? s.unrealized / s.cost : null;
  const twdOfScope = usdTwd ? toTwd(s.marketValue, s.currency, usdTwd.rate) : null;
  const note = [
    scope === TOTAL_SCOPE && usdTwd
      ? `美元以 1 USD = ${formatNumber(usdTwd.rate, 3)} TWD 換算（${usdTwd.date}），成本也以目前匯率換算、不含匯差`
      : `${labelOf(s.currency)} ${s.holdings} 檔持股`,
    scope !== TOTAL_SCOPE && s.currency !== "TWD" && twdOfScope != null ? `約 NT$ ${formatMoney(twdOfScope)}` : null,
    s.unpriced > 0 ? `${s.unpriced} 檔沒有現價，市值與未實現損益不含這幾檔` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          資產總覽
        </h2>
        {options.length > 1 && (
          <Segmented label="總覽範圍" options={options} value={scope} onChange={setPicked} className="w-full sm:w-auto" />
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-muted-foreground">目前市值</div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">
            {currencyPrefix(s.currency)} {formatMoney(s.marketValue, s.currency)}
          </div>
          <div className="text-xs text-muted-foreground">{note}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <Stat
            label="總損益"
            value={formatSignedMoney(totalPnl, s.currency)}
            valueClassName={pnlClass(totalPnl)}
            sub="未實現＋已實現＋股利"
            size="lg"
          />
          <Stat
            label="損益率"
            value={formatPercent(pnlRate)}
            valueClassName={pnlClass(pnlRate)}
            sub="總損益 ÷ 持股成本"
            size="lg"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-4">
        <Stat label="持股成本" value={formatMoney(s.cost, s.currency)} />
        <Stat
          label="未實現損益"
          value={
            <>
              {formatSignedMoney(s.unrealized, s.currency)}{" "}
              <span className="text-xs font-medium">{formatPercent(unrealizedRate)}</span>
            </>
          }
          valueClassName={pnlClass(s.unrealized)}
        />
        <Stat label="已實現損益" value={formatSignedMoney(s.realized, s.currency)} valueClassName={pnlClass(s.realized)} />
        <Stat label="已入帳股利" value={formatMoney(s.dividends, s.currency)} />
      </div>
    </section>
  );
}

type HoldingRow = {
  p: Position;
  market: InvestMarket;
  resolved: ResolvedPrice | undefined;
  value: ReturnType<typeof valuePosition>;
  /** 台幣市值，算占比與排序用；無法換算時為 null */
  valueTwd: number | null;
};

export function HoldingsTab({
  data,
  portfolio,
  accountFilter,
  onReload,
  onFixWarning,
}: {
  data: InvestData;
  portfolio: PortfolioResult;
  accountFilter: string;
  onReload: () => Promise<void>;
  onFixWarning: (accountId: string, symbol: string) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  /** 現價輸入中的值（失焦才存檔）；undefined＝沒有編輯中 */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number | null>>({});

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const quoteBySymbol = new Map(data.quotes.map((q) => [q.symbol, q]));
  const resolvedBySymbol = resolvePrices(
    portfolio.positions.map((p) => p.symbol),
    data.quotes,
    data.marketPrices
  );
  const priceBySymbol = new Map([...resolvedBySymbol].map(([symbol, r]) => [symbol, r.price]));
  const inFilter = (accountId: string) => accountFilter === "all" || accountId === accountFilter;
  const positions = portfolio.positions.filter((p) => inFilter(p.accountId));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;
  const filteredDividends = data.dividends.filter((d) => inFilter(d.account_id));
  const summaries = summarize(positions, priceBySymbol, filteredDividends);
  const usdTwd = data.usdTwd?.rate ?? null;
  const twdTotal = summaries.length > 1 && usdTwd ? totalInTwd(summaries, usdTwd) : null;
  const marketOf = (p: Position): InvestMarket =>
    accountsById.get(p.accountId)?.market ?? (p.currency === "TWD" ? "TW" : "US");
  /** 幣別的顯示名稱：該幣別的持股都在同一個市場時用市場名稱（台股／美股） */
  const labelOf = (currency: string) => {
    const markets = new Set(positions.filter((p) => p.currency === currency).map(marketOf));
    return markets.size === 1 ? MARKET_LABELS[[...markets][0]] : (CURRENCY_LABELS[currency] ?? currency);
  };

  /** 每檔已入帳股利（實收）合計 */
  const dividendsByPosition = new Map<string, number>();
  for (const d of filteredDividends) {
    if (!d.received_at) continue;
    const key = `${d.account_id}|${d.symbol}`;
    dividendsByPosition.set(key, (dividendsByPosition.get(key) ?? 0) + d.net_amount);
  }

  // 同一檔只提示第一次賣超的日期
  const warnings = new Map<string, PortfolioResult["warnings"][number]>();
  for (const w of portfolio.warnings) {
    if (!inFilter(w.accountId)) continue;
    const key = `${w.accountId}|${w.symbol}`;
    if (!warnings.has(key)) warnings.set(key, w);
  }

  const holdingRows: HoldingRow[] = positions.map((p) => {
    const resolved = resolvedBySymbol.get(p.symbol);
    const price = p.symbol in priceDrafts ? priceDrafts[p.symbol] : (resolved?.price ?? null);
    const value = p.quantity > 0 ? valuePosition(p, price) : null;
    return { p, market: marketOf(p), resolved, value, valueTwd: value ? toTwd(value.marketValue, p.currency, usdTwd) : null };
  });
  const totalTwd = holdingRows.reduce((sum, r) => sum + (r.valueTwd ?? 0), 0);
  const openCount = holdingRows.filter((r) => r.p.quantity > 0).length;
  const closedCount = holdingRows.length - openCount;
  const q = search.trim().toUpperCase();
  const visible = holdingRows.filter(
    (r) =>
      (showClosed || r.p.quantity > 0) &&
      (!q || r.p.symbol.toUpperCase().includes(q) || (r.p.name ?? "").toUpperCase().includes(q))
  );
  // 依市場分組；組內持股依市值由大到小，已出清的排在最後
  const groups = (["TW", "US"] as const)
    .map((market) => ({
      market,
      rows: visible
        .filter((r) => r.market === market)
        .sort((a, b) =>
          a.p.quantity > 0 !== b.p.quantity > 0
            ? a.p.quantity > 0
              ? -1
              : 1
            : (b.valueTwd ?? b.p.cost) - (a.valueTwd ?? a.p.cost) || a.p.symbol.localeCompare(b.p.symbol)
        ),
    }))
    .filter((g) => g.rows.length > 0);

  function groupDetail(rows: HoldingRow[]): string | null {
    const open = rows.filter((r) => r.value);
    const currencies = new Set(open.map((r) => r.p.currency));
    if (currencies.size !== 1) return null;
    const currency = [...currencies][0];
    const mv = open.reduce((s, r) => s + r.value!.marketValue, 0);
    const cost = open.reduce((s, r) => s + r.p.cost, 0);
    const unrealized = mv - cost;
    const twd = currency !== "TWD" && usdTwd ? toTwd(mv, currency, usdTwd) : null;
    return [
      `市值 ${currencyPrefix(currency)} ${formatMoney(mv, currency)}${twd != null ? `（≈ NT$ ${formatMoney(twd)}）` : ""}`,
      `未實現 ${formatSignedMoney(unrealized, currency)}（${formatPercent(cost > 0 ? unrealized / cost : null)}）`,
    ].join(" · ");
  }

  async function savePrice(symbol: string) {
    if (!(symbol in priceDrafts)) return;
    const draft = priceDrafts[symbol];
    // 清空＝刪掉手動現價、改回收盤價；輸入和目前顯示的價格不同才存成手動現價
    const shouldDelete = draft == null && quoteBySymbol.has(symbol);
    const shouldSave = draft != null && draft !== resolvedBySymbol.get(symbol)?.price;
    if (shouldDelete || shouldSave) {
      const { error } = shouldDelete
        ? await investDb.from("invest_quotes").delete().eq("symbol", symbol)
        : await investDb.from("invest_quotes").upsert({ symbol, price: draft }, { onConflict: "owner_id,symbol" });
      if (error) {
        toast.error(`儲存現價失敗：${error.message}`);
        return;
      }
      await onReload();
    }
    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {[...warnings.values()].map((w) => (
        <div
          key={`${w.accountId}|${w.symbol}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            {w.symbol} 在 {w.date} 賣出的股數比當時持股多 {formatNumber(w.shortBy)} 股，可能漏記拆股或配股，
            或對帳單起始日之前就有持股。
          </span>
          <Button type="button" variant="outline" onClick={() => onFixWarning(w.accountId, w.symbol)}>
            補登拆股／配股
          </Button>
        </div>
      ))}

      {summaries.length > 0 && (
        <SummaryPanel summaries={summaries} twdTotal={twdTotal} labelOf={labelOf} usdTwd={data.usdTwd} />
      )}

      {holdingRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          目前沒有持股。到「交易紀錄」匯入對帳單後就會出現。
        </div>
      ) : (
        <Panel
          title="持股明細"
          subtitle={`${openCount} 檔持股${closedCount > 0 ? ` · ${closedCount} 檔已出清` : ""}`}
          actions={
            <>
              <SearchInput value={search} onChange={setSearch} className="w-full sm:w-52" />
              {closedCount > 0 && (
                <label className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground sm:min-h-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={showClosed}
                    onChange={(e) => setShowClosed(e.target.checked)}
                  />
                  顯示已出清
                </label>
              )}
            </>
          }
          footer={
            <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
              現價每天自動帶入最近收盤價（台股證交所、美股 Yahoo Finance），盤中可直接改（離開欄位後儲存），有更新的收盤價時自動換回。平均成本含買進手續費；累計股利為已入帳的實收金額。表格往右捲動時「標的」欄固定在左邊。
            </p>
          }
        >
          {visible.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">沒有符合的持股。</div>
          ) : (
            <InvestTable minWidth={920}>
              <thead>
                <tr>
                  <HeadCell sticky className="w-28 sm:w-44">
                    標的
                  </HeadCell>
                  <HeadCell align="right">市值</HeadCell>
                  <HeadCell align="right">未實現損益</HeadCell>
                  <HeadCell align="right">現價</HeadCell>
                  <HeadCell align="right">股數</HeadCell>
                  <HeadCell align="right">平均成本</HeadCell>
                  <HeadCell className="w-28">占比</HeadCell>
                  <HeadCell align="right">已實現損益</HeadCell>
                  <HeadCell align="right">累計股利</HeadCell>
                </tr>
              </thead>
              {groups.map((g) => {
                const groupOpen = g.rows.filter((r) => r.p.quantity > 0).length;
                const groupClosed = g.rows.length - groupOpen;
                return (
                  <tbody key={g.market}>
                    {groups.length > 1 && (
                      <GroupRow
                        colSpan={9}
                        label={
                          <span className="inline-flex items-center gap-2">
                            <span className={cn("h-2.5 w-2.5 rounded-[3px]", MARKET_BAR[g.market])} aria-hidden="true" />
                            {MARKET_LABELS[g.market]} · {groupOpen} 檔{groupClosed > 0 ? `＋${groupClosed} 檔已出清` : ""}
                          </span>
                        }
                        detail={groupDetail(g.rows)}
                      />
                    )}
                    {g.rows.map(({ p, market, resolved, value: v, valueTwd }) => {
                      const open = p.quantity > 0;
                      const price = p.symbol in priceDrafts ? priceDrafts[p.symbol] : (resolved?.price ?? null);
                      const share = open && valueTwd != null && totalTwd > 0 ? valueTwd / totalTwd : null;
                      const dividends = dividendsByPosition.get(`${p.accountId}|${p.symbol}`);
                      const twd = v && p.currency !== "TWD" && usdTwd ? toTwd(v.marketValue, p.currency, usdTwd) : null;
                      const sub = [p.name, showAccount ? accountsById.get(p.accountId)?.name : null].filter(Boolean).join(" · ");
                      return (
                        <Row key={`${p.accountId}|${p.symbol}`}>
                          <Cell sticky className="w-28 max-w-28 sm:w-44 sm:max-w-44">
                            <div className="font-semibold text-foreground">{p.symbol}</div>
                            <div className="truncate text-[11px] text-muted-foreground" title={sub}>
                              {sub}
                            </div>
                          </Cell>
                          <Cell align="right">
                            {v ? formatMoney(v.marketValue, p.currency) : "—"}
                            {twd != null && <div className="text-[11px] text-muted-foreground">≈ NT$ {formatMoney(twd)}</div>}
                          </Cell>
                          <Cell align="right">
                            <div className={cn("font-medium", pnlClass(v?.unrealizedPnl))}>
                              {v ? formatSignedMoney(v.unrealizedPnl, p.currency) : "—"}
                            </div>
                            {v && <div className={cn("text-[11px]", pnlClass(v.returnRate))}>{formatPercent(v.returnRate)}</div>}
                          </Cell>
                          <Cell align="right" className="py-1.5">
                            {open ? (
                              <>
                                <NumericInput
                                  allowDecimal
                                  keepZero
                                  className="ml-auto w-20 text-right"
                                  value={price}
                                  onValueChange={(val) => setPriceDrafts((prev) => ({ ...prev, [p.symbol]: val }))}
                                  onBlur={() => void savePrice(p.symbol)}
                                  aria-label={`${p.symbol} 現價`}
                                />
                                {resolved && !(p.symbol in priceDrafts) && (
                                  <div
                                    className="mt-0.5 text-[11px] text-muted-foreground"
                                    title={resolved.source === "manual" ? "手動輸入；有更新的收盤價時自動換回收盤價" : undefined}
                                  >
                                    {resolved.source === "market" ? `${resolved.date.slice(5).replace("-", "/")} 收盤` : "手動"}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">已出清</span>
                            )}
                          </Cell>
                          <Cell align="right">{formatNumber(p.quantity)}</Cell>
                          <Cell align="right">
                            {p.avgCost == null ? "—" : formatNumber(p.avgCost, 2)}
                            {open && <div className="text-[11px] text-muted-foreground">成本 {formatMoney(p.cost, p.currency)}</div>}
                          </Cell>
                          <Cell>
                            {share == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 min-w-8 flex-1 rounded-full bg-muted">
                                  <div
                                    className={cn("h-1.5 rounded-full", MARKET_BAR[market])}
                                    style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                                  />
                                </div>
                                <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">
                                  {share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`}
                                </span>
                              </div>
                            )}
                          </Cell>
                          <Cell align="right" className={pnlClass(p.realizedPnl)}>
                            {formatSignedMoney(p.realizedPnl, p.currency)}
                          </Cell>
                          <Cell align="right">{dividends == null ? "—" : formatMoney(dividends, p.currency)}</Cell>
                        </Row>
                      );
                    })}
                  </tbody>
                );
              })}
            </InvestTable>
          )}
        </Panel>
      )}
    </div>
  );
}
