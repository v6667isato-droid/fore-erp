"use client";

import { useMemo, useState } from "react";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { investDb } from "@/lib/invest-client";
import type { PortfolioResult } from "@/lib/invest-portfolio";
import { SIDE_LABELS, type InvestTrade, type TradeSide } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { TradeFormDialog } from "@/components/investments/trade-form-dialog";
import { TradeImportDialog } from "@/components/investments/trade-import-dialog";
import { Cell, GroupRow, HeadCell, InvestTable, Row, ShowMoreFooter } from "@/components/investments/invest-table";
import {
  currencyPrefix,
  formatMoney,
  formatNumber,
  formatSignedMoney,
  inputClass,
  Panel,
  pnlClass,
  SearchInput,
  Segmented,
  Stat,
} from "@/components/investments/invest-ui";

const PAGE_SIZE = 50;
const CURRENCY_LABELS: Record<string, string> = { TWD: "台幣", USD: "美元" };

type Totals = { count: number; buy: number; sell: number; realized: number; fees: number };

/** 依幣別加總（台幣、美元不能直接相加） */
function totalsByCurrency(trades: InvestTrade[], realizedByTradeId: Map<string, number>): [string, Totals][] {
  const map = new Map<string, Totals>();
  for (const t of trades) {
    let s = map.get(t.currency);
    if (!s) {
      s = { count: 0, buy: 0, sell: 0, realized: 0, fees: 0 };
      map.set(t.currency, s);
    }
    s.count += 1;
    if (t.side === "buy") s.buy += t.net_amount;
    else {
      s.sell += t.net_amount;
      s.realized += realizedByTradeId.get(t.id) ?? 0;
    }
    s.fees += t.fee + t.tax;
  }
  return [...map.entries()].sort(([a], [b]) => (a === "TWD" ? -1 : b === "TWD" ? 1 : a.localeCompare(b)));
}

/** 月份分組列的小計：筆數＋各幣別買進、賣出、已實現 */
function monthDetail(trades: InvestTrade[], realizedByTradeId: Map<string, number>): string {
  const parts = [`${trades.length} 筆`];
  for (const [currency, s] of totalsByCurrency(trades, realizedByTradeId)) {
    const prefix = currency === "TWD" ? "" : `${currencyPrefix(currency)} `;
    if (s.buy) parts.push(`買進 ${prefix}${formatMoney(s.buy, currency)}`);
    if (s.sell) parts.push(`賣出 ${prefix}${formatMoney(s.sell, currency)}`);
    if (s.realized) parts.push(`已實現 ${prefix}${formatSignedMoney(s.realized, currency)}`);
  }
  return parts.join(" · ");
}

export function TradesTab({
  data,
  portfolio,
  accountFilter,
  onReload,
}: {
  data: InvestData;
  portfolio: PortfolioResult;
  accountFilter: string;
  onReload: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("all");
  const [side, setSide] = useState<"all" | TradeSide>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestTrade | null>(null);
  const [deleting, setDeleting] = useState<InvestTrade | null>(null);

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;

  const years = useMemo(
    () => [...new Set(data.trades.map((t) => t.trade_date.slice(0, 4)))].sort().reverse(),
    [data.trades]
  );

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return data.trades
      .filter((t) => accountFilter === "all" || t.account_id === accountFilter)
      .filter((t) => year === "all" || t.trade_date.startsWith(year))
      .filter((t) => side === "all" || t.side === side)
      .filter((t) => !q || t.symbol.toUpperCase().includes(q) || (t.name ?? "").toUpperCase().includes(q))
      .sort((a, b) => (a.trade_date !== b.trade_date ? (a.trade_date < b.trade_date ? 1 : -1) : 0));
  }, [data.trades, accountFilter, year, side, search]);

  const totals = useMemo(() => totalsByCurrency(rows, portfolio.realizedByTradeId), [rows, portfolio.realizedByTradeId]);

  // 依月份分組（只分顯示中的筆數），小計用該月全部符合條件的交易
  const shown = rows.slice(0, limit);
  const months: { month: string; rows: InvestTrade[]; all: InvestTrade[] }[] = [];
  for (const t of shown) {
    const month = t.trade_date.slice(0, 7);
    const last = months.at(-1);
    if (last?.month === month) last.rows.push(t);
    else months.push({ month, rows: [t], all: rows.filter((r) => r.trade_date.startsWith(month)) });
  }
  const colSpan = 9;

  function changeFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setLimit(PAGE_SIZE);
    };
  }

  async function handleDelete(t: InvestTrade) {
    const { error } = await investDb.from("invest_trades").delete().eq("id", t.id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    toast.success("已刪除交易");
    await onReload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={changeFilter(setSearch)} className="w-full sm:w-60" />
        <select
          className={cn(inputClass, "h-10 w-auto min-w-28 flex-1 sm:h-9 sm:flex-none")}
          value={year}
          onChange={(e) => changeFilter(setYear)(e.target.value)}
          aria-label="年度"
        >
          <option value="all">全部年度</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <Segmented
          label="買賣"
          size="md"
          className="flex-1 sm:flex-none"
          options={[
            { value: "all", label: "全部" },
            { value: "buy", label: "買進" },
            { value: "sell", label: "賣出" },
          ]}
          value={side}
          onChange={changeFilter(setSide)}
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
          <Button type="button" className="h-10 sm:h-9" onClick={() => setImportOpen(true)} disabled={data.accounts.length === 0}>
            <FileUp className="h-4 w-4" />
            匯入對帳單
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 sm:h-9"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            disabled={data.accounts.length === 0}
          >
            <Plus className="h-4 w-4" />
            手動新增
          </Button>
        </div>
      </div>

      {totals.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:px-5" aria-label="篩選結果合計">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">篩選結果</h2>
            <span className="text-xs text-muted-foreground">
              {year === "all" ? "全部年度" : `${year} 年`} · 共 {rows.length.toLocaleString("zh-TW")} 筆
            </span>
          </div>
          {totals.map(([currency, s], i) => (
            <div
              key={currency}
              className={cn(
                "grid grid-cols-2 gap-3 sm:grid-cols-[7rem_repeat(4,minmax(0,1fr))] sm:items-end",
                i > 0 && "border-t border-border/60 pt-3"
              )}
            >
              <div className="col-span-2 text-xs font-semibold text-foreground sm:col-span-1 sm:pb-0.5 sm:text-sm">
                {CURRENCY_LABELS[currency] ?? currency} · {s.count} 筆
              </div>
              <Stat label="買進合計" value={formatMoney(s.buy, currency)} />
              <Stat label="賣出合計" value={formatMoney(s.sell, currency)} />
              <Stat label="已實現損益" value={formatSignedMoney(s.realized, currency)} valueClassName={pnlClass(s.realized)} />
              <Stat label="手續費＋交易稅" value={formatMoney(s.fees, currency)} />
            </div>
          ))}
        </section>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {data.trades.length === 0 ? "還沒有交易紀錄，按「匯入對帳單」開始。" : "沒有符合條件的交易。"}
        </div>
      ) : (
        <Panel
          title="交易明細"
          subtitle="依月份分組，新的在上；表格往右捲動時「標的」欄固定"
          footer={<ShowMoreFooter shown={shown.length} total={rows.length} onShowMore={() => setLimit((n) => n + PAGE_SIZE)} />}
        >
          <InvestTable minWidth={900}>
            <thead>
              <tr>
                <HeadCell sticky className="w-32 sm:w-56">
                  標的／成交日
                </HeadCell>
                <HeadCell align="right">數量</HeadCell>
                <HeadCell align="right">成交價</HeadCell>
                <HeadCell align="right">價金</HeadCell>
                <HeadCell align="right">手續費</HeadCell>
                <HeadCell align="right">交易稅</HeadCell>
                <HeadCell align="right">淨收付</HeadCell>
                <HeadCell align="right">已實現損益</HeadCell>
                <HeadCell className="w-20">
                  <span className="sr-only">操作</span>
                </HeadCell>
              </tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.month}>
                <GroupRow
                  colSpan={colSpan}
                  label={`${m.month.slice(0, 4)} 年 ${Number(m.month.slice(5))} 月`}
                  detail={monthDetail(m.all, portfolio.realizedByTradeId)}
                />
                {m.rows.map((t) => {
                  const realized = t.side === "sell" ? portfolio.realizedByTradeId.get(t.id) : undefined;
                  return (
                    <Row key={t.id}>
                      <Cell sticky className="w-32 max-w-32 py-2 sm:w-56 sm:max-w-56">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                              t.side === "buy"
                                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            )}
                            aria-label={SIDE_LABELS[t.side]}
                          >
                            {t.side === "buy" ? "買" : "賣"}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate">
                              <span className="font-semibold text-foreground">{t.symbol}</span>{" "}
                              <span className="hidden text-xs text-muted-foreground sm:inline">{t.name ?? ""}</span>
                            </div>
                            <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                              {[
                                t.trade_date.slice(5).replace("-", "/"),
                                t.source === "manual" ? "手動" : null,
                                showAccount ? accountsById.get(t.account_id)?.name : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        </div>
                      </Cell>
                      <Cell align="right">{formatNumber(t.quantity)}</Cell>
                      <Cell align="right">{formatNumber(t.price)}</Cell>
                      <Cell align="right">{formatMoney(t.amount, t.currency)}</Cell>
                      <Cell align="right" className="text-muted-foreground">
                        {formatMoney(t.fee, t.currency)}
                      </Cell>
                      <Cell align="right" className="text-muted-foreground">
                        {formatMoney(t.tax, t.currency)}
                      </Cell>
                      <Cell align="right" className="whitespace-nowrap font-medium">
                        {formatMoney(t.net_amount, t.currency)}
                        {t.currency !== "TWD" && (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">{t.currency}</span>
                        )}
                      </Cell>
                      <Cell align="right" className={cn("font-medium", pnlClass(realized))}>
                        {realized === undefined ? "" : formatSignedMoney(realized, t.currency)}
                      </Cell>
                      <Cell className="py-1">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 sm:h-8 sm:w-8"
                            onClick={() => {
                              setEditing(t);
                              setFormOpen(true);
                            }}
                            aria-label={`編輯 ${t.trade_date} ${t.symbol}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-destructive sm:h-8 sm:w-8"
                            onClick={() => setDeleting(t)}
                            aria-label={`刪除 ${t.trade_date} ${t.symbol}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </tbody>
            ))}
          </InvestTable>
        </Panel>
      )}

      <TradeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        accounts={data.accounts}
        defaultAccountId={accountFilter !== "all" ? accountFilter : undefined}
        existingTrades={data.trades}
        onImported={onReload}
      />
      <TradeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        accounts={data.accounts}
        defaultAccountId={accountFilter !== "all" ? accountFilter : undefined}
        trade={editing}
        onSaved={onReload}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="刪除交易"
        description={
          deleting
            ? `確定刪除 ${deleting.trade_date} ${deleting.symbol} ${SIDE_LABELS[deleting.side]} ${formatNumber(deleting.quantity)} 股？${
                deleting.source === "import" ? "（之後重新匯入含這筆的對帳單，會再被加回來）" : ""
              }`
            : ""
        }
        confirmLabel="刪除"
        destructive
        onConfirm={async () => {
          if (deleting) await handleDelete(deleting);
        }}
      />
    </div>
  );
}
