"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import {
  resolvePrice,
  valuePosition,
  type PortfolioResult,
  type Position,
  type ResolvedPrice,
} from "@/lib/invest-portfolio";
import type { InvestData } from "@/components/investments/investments-page";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  pnlClass,
  SummaryCard,
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
      s = { currency, cost: 0, marketValue: 0, unrealized: 0, unpriced: 0, realized: 0, dividends: 0 };
      map.set(currency, s);
    }
    return s;
  };
  for (const p of positions) {
    const s = get(p.currency);
    s.realized += p.realizedPnl;
    if (p.quantity <= 0) continue;
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
  /** 現價輸入中的值（失焦才存檔）；undefined＝沒有編輯中 */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number | null>>({});

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const quoteBySymbol = new Map(data.quotes.map((q) => [q.symbol, q]));
  const marketBySymbol = new Map(data.marketPrices.map((m) => [m.symbol, m]));
  const resolvedBySymbol = new Map<string, ResolvedPrice>();
  for (const p of portfolio.positions) {
    const r = resolvePrice(quoteBySymbol.get(p.symbol), marketBySymbol.get(p.symbol));
    if (r) resolvedBySymbol.set(p.symbol, r);
  }
  const priceBySymbol = new Map([...resolvedBySymbol].map(([symbol, r]) => [symbol, r.price]));
  const inFilter = (accountId: string) => accountFilter === "all" || accountId === accountFilter;
  const positions = portfolio.positions.filter((p) => inFilter(p.accountId));
  const shown = showClosed ? positions : positions.filter((p) => p.quantity !== 0);
  const showAccount = accountFilter === "all" && data.accounts.length > 1;
  const summaries = summarize(
    positions,
    priceBySymbol,
    data.dividends.filter((d) => inFilter(d.account_id))
  );

  // 同一檔只提示第一次賣超的日期
  const warnings = new Map<string, PortfolioResult["warnings"][number]>();
  for (const w of portfolio.warnings) {
    if (!inFilter(w.accountId)) continue;
    const key = `${w.accountId}|${w.symbol}`;
    if (!warnings.has(key)) warnings.set(key, w);
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

      {summaries.map((s) => (
        <div key={s.currency} className="space-y-2">
          {summaries.length > 1 && <div className="text-xs font-medium text-muted-foreground">{s.currency}</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="持股成本" value={formatMoney(s.cost, s.currency)} />
            <SummaryCard
              label="市值"
              value={formatMoney(s.marketValue, s.currency)}
              hint={s.unpriced > 0 ? `${s.unpriced} 檔未填現價` : undefined}
            />
            <SummaryCard
              label="未實現損益"
              value={formatMoney(s.unrealized, s.currency)}
              valueClassName={pnlClass(s.unrealized)}
              hint={s.unpriced > 0 ? "不含未填現價的持股" : undefined}
            />
            <SummaryCard
              label="已實現損益"
              value={formatMoney(s.realized, s.currency)}
              valueClassName={pnlClass(s.realized)}
            />
            <SummaryCard label="已入帳股利" value={formatMoney(s.dividends, s.currency)} />
            <SummaryCard
              label="總損益"
              value={formatMoney(s.unrealized + s.realized + s.dividends, s.currency)}
              valueClassName={pnlClass(s.unrealized + s.realized + s.dividends)}
              hint="未實現＋已實現＋股利"
            />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          現價自動帶入最近收盤價；盤中可手動改（離開欄位後儲存），有更新的收盤價時自動換回。沒有收盤價的標的（如美股）請手動輸入。平均成本含買進手續費。
        </p>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          顯示已出清
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          目前沒有持股。到「交易紀錄」匯入對帳單後就會出現。
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>標的</TableHead>
                {showAccount && <TableHead>帳戶</TableHead>}
                <TableHead className="text-right">股數</TableHead>
                <TableHead className="text-right">平均成本</TableHead>
                <TableHead className="text-right">持股成本</TableHead>
                <TableHead className="text-right">現價</TableHead>
                <TableHead className="text-right">市值</TableHead>
                <TableHead className="text-right">未實現損益</TableHead>
                <TableHead className="text-right">報酬率</TableHead>
                <TableHead className="text-right">已實現損益</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => {
                const resolved = resolvedBySymbol.get(p.symbol);
                const price = p.symbol in priceDrafts ? priceDrafts[p.symbol] : (resolved?.price ?? null);
                const v = p.quantity > 0 ? valuePosition(p, price) : null;
                return (
                  <TableRow key={`${p.accountId}|${p.symbol}`}>
                    <TableCell>
                      <div className="font-medium">{p.symbol}</div>
                      <div className="text-xs text-muted-foreground">{p.name ?? ""}</div>
                    </TableCell>
                    {showAccount && <TableCell>{accountsById.get(p.accountId)?.name ?? "—"}</TableCell>}
                    <TableCell className="text-right tabular-nums">{formatNumber(p.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.avgCost == null ? "—" : formatNumber(p.avgCost, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.quantity > 0 ? formatMoney(p.cost, p.currency) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.quantity > 0 ? (
                        <NumericInput
                          allowDecimal
                          keepZero
                          className="ml-auto w-24 text-right"
                          value={price}
                          onValueChange={(val) => setPriceDrafts((prev) => ({ ...prev, [p.symbol]: val }))}
                          onBlur={() => void savePrice(p.symbol)}
                          aria-label={`${p.symbol} 現價`}
                        />
                      ) : (
                        "—"
                      )}
                      {p.quantity > 0 && resolved && !(p.symbol in priceDrafts) && (
                        <div
                          className="mt-0.5 text-[11px] text-muted-foreground"
                          title={resolved.source === "manual" ? "手動輸入；有更新的收盤價時自動換回收盤價" : undefined}
                        >
                          {resolved.source === "market" ? `${resolved.date.slice(5).replace("-", "/")} 收盤` : "手動"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v ? formatMoney(v.marketValue, p.currency) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${pnlClass(v?.unrealizedPnl)}`}>
                      {v ? formatMoney(v.unrealizedPnl, p.currency) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${pnlClass(v?.returnRate)}`}>
                      {v ? formatPercent(v.returnRate) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${pnlClass(p.realizedPnl)}`}>
                      {formatMoney(p.realizedPnl, p.currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
