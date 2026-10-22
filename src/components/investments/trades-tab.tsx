"use client";

import { useMemo, useState } from "react";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import type { PortfolioResult } from "@/lib/invest-portfolio";
import { SIDE_LABELS, type InvestTrade } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { TradeFormDialog } from "@/components/investments/trade-form-dialog";
import { TradeImportDialog } from "@/components/investments/trade-import-dialog";
import {
  formatMoney,
  formatNumber,
  inputClass,
  pnlClass,
  SummaryCard,
} from "@/components/investments/invest-ui";

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
      .filter((t) => !q || t.symbol.includes(q) || (t.name ?? "").toUpperCase().includes(q))
      .sort((a, b) => (a.trade_date !== b.trade_date ? (a.trade_date < b.trade_date ? 1 : -1) : 0));
  }, [data.trades, accountFilter, year, search]);

  // 合計依幣別分開（台幣、美元不能直接相加）
  const totals = useMemo(() => {
    const map = new Map<string, { buy: number; sell: number; realized: number; fees: number }>();
    for (const t of rows) {
      let s = map.get(t.currency);
      if (!s) {
        s = { buy: 0, sell: 0, realized: 0, fees: 0 };
        map.set(t.currency, s);
      }
      if (t.side === "buy") s.buy += t.net_amount;
      else {
        s.sell += t.net_amount;
        s.realized += portfolio.realizedByTradeId.get(t.id) ?? 0;
      }
      s.fees += t.fee + t.tax;
    }
    return [...map.entries()];
  }, [rows, portfolio.realizedByTradeId]);

  async function handleDelete(t: InvestTrade) {
    const { error } = await investDb.from("trades").delete().eq("id", t.id);
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
        <input
          className={cn(inputClass, "sm:w-56")}
          placeholder="搜尋代號或名稱"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={cn(inputClass, "w-auto")} value={year} onChange={(e) => setYear(e.target.value)} aria-label="年度">
          <option value="all">全部年度</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button type="button" onClick={() => setImportOpen(true)} disabled={data.accounts.length === 0}>
            <FileUp className="h-4 w-4" />
            匯入對帳單
          </Button>
          <Button
            type="button"
            variant="outline"
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

      {totals.map(([currency, s]) => (
        <div key={currency} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label={`買進合計${totals.length > 1 ? `（${currency}）` : ""}`} value={formatMoney(s.buy, currency)} />
          <SummaryCard label="賣出合計" value={formatMoney(s.sell, currency)} />
          <SummaryCard label="已實現損益" value={formatMoney(s.realized, currency)} valueClassName={pnlClass(s.realized)} />
          <SummaryCard label="手續費＋交易稅" value={formatMoney(s.fees, currency)} />
        </div>
      ))}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {data.trades.length === 0 ? "還沒有交易紀錄，按「匯入對帳單」開始。" : "沒有符合條件的交易。"}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成交日</TableHead>
                {showAccount && <TableHead>帳戶</TableHead>}
                <TableHead>標的</TableHead>
                <TableHead>買賣</TableHead>
                <TableHead className="text-right">數量</TableHead>
                <TableHead className="text-right">成交價</TableHead>
                <TableHead className="text-right">價金</TableHead>
                <TableHead className="text-right">手續費</TableHead>
                <TableHead className="text-right">交易稅</TableHead>
                <TableHead className="text-right">淨收付</TableHead>
                <TableHead className="text-right">已實現損益</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const realized = t.side === "sell" ? portfolio.realizedByTradeId.get(t.id) : undefined;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums">{t.trade_date}</TableCell>
                    {showAccount && <TableCell>{accountsById.get(t.account_id)?.name ?? "—"}</TableCell>}
                    <TableCell>
                      <span className="font-medium">{t.symbol}</span>{" "}
                      <span className="text-xs text-muted-foreground">{t.name ?? ""}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded border px-1.5 py-px text-xs font-medium ${
                          t.side === "buy"
                            ? "border-red-500/40 text-red-700 dark:text-red-400"
                            : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {SIDE_LABELS[t.side]}
                      </span>
                      {t.source === "manual" && <span className="ml-1 text-[11px] text-muted-foreground">手動</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(t.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(t.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.amount, t.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.fee, t.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.tax, t.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.net_amount, t.currency)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${pnlClass(realized)}`}>
                      {realized === undefined ? "" : formatMoney(realized, t.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditing(t);
                            setFormOpen(true);
                          }}
                          aria-label="編輯"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleting(t)}
                          aria-label="刪除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
