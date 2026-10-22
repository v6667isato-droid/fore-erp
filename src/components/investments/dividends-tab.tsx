"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import type { InvestDividend } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { DividendFormDialog } from "@/components/investments/dividend-form-dialog";
import {
  formatMoney,
  formatNumber,
  inputClass,
  SummaryCard,
  todayIso,
} from "@/components/investments/invest-ui";

type StatusFilter = "all" | "pending" | "received";

export function DividendsTab({
  data,
  accountFilter,
  onReload,
}: {
  data: InvestData;
  accountFilter: string;
  onReload: () => Promise<void>;
}) {
  const [year, setYear] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestDividend | null>(null);
  const [deleting, setDeleting] = useState<InvestDividend | null>(null);

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;

  const years = useMemo(
    () => [...new Set(data.dividends.map((d) => d.ex_date.slice(0, 4)))].sort().reverse(),
    [data.dividends]
  );

  const rows = useMemo(
    () =>
      data.dividends
        .filter((d) => accountFilter === "all" || d.account_id === accountFilter)
        .filter((d) => year === "all" || d.ex_date.startsWith(year))
        .filter((d) => status === "all" || (status === "pending" ? !d.received_at : Boolean(d.received_at)))
        .sort((a, b) => (a.ex_date < b.ex_date ? 1 : a.ex_date > b.ex_date ? -1 : 0)),
    [data.dividends, accountFilter, year, status]
  );

  const totals = useMemo(() => {
    const map = new Map<string, { gross: number; deductions: number; received: number; pending: number }>();
    for (const d of rows) {
      let s = map.get(d.currency);
      if (!s) {
        s = { gross: 0, deductions: 0, received: 0, pending: 0 };
        map.set(d.currency, s);
      }
      s.gross += d.gross_amount;
      s.deductions += d.nhi_premium + d.withholding_tax + d.fee;
      if (d.received_at) s.received += d.net_amount;
      else s.pending += d.net_amount;
    }
    return [...map.entries()];
  }, [rows]);

  async function markReceived(d: InvestDividend) {
    const { error } = await investDb
      .from("dividends")
      .update({ received_at: d.pay_date ?? todayIso() })
      .eq("id", d.id);
    if (error) {
      toast.error(`更新失敗：${error.message}`);
      return;
    }
    await onReload();
  }

  async function handleDelete(d: InvestDividend) {
    const { error } = await investDb.from("dividends").delete().eq("id", d.id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    toast.success("已刪除股利");
    await onReload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(inputClass, "w-auto")} value={year} onChange={(e) => setYear(e.target.value)} aria-label="年度">
          <option value="all">全部年度</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <select
          className={cn(inputClass, "w-auto")}
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="入帳狀態"
        >
          <option value="all">全部狀態</option>
          <option value="pending">待入帳</option>
          <option value="received">已入帳</option>
        </select>
        <Button
          type="button"
          className="sm:ml-auto"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          disabled={data.accounts.length === 0}
        >
          <Plus className="h-4 w-4" />
          新增股利
        </Button>
      </div>

      {totals.map(([currency, s]) => (
        <div key={currency} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label={`應收股利${totals.length > 1 ? `（${currency}）` : ""}`} value={formatMoney(s.gross, currency)} />
          <SummaryCard label="補充保費＋稅＋匯費" value={formatMoney(s.deductions, currency)} />
          <SummaryCard label="已入帳" value={formatMoney(s.received, currency)} />
          <SummaryCard label="待入帳" value={formatMoney(s.pending, currency)} />
        </div>
      ))}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {data.dividends.length === 0
            ? "還沒有股利紀錄。股利不在買賣對帳單上，請按「新增股利」輸入除息日與每股配息。"
            : "沒有符合條件的股利。"}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>除息日</TableHead>
                {showAccount && <TableHead>帳戶</TableHead>}
                <TableHead>標的</TableHead>
                <TableHead className="text-right">每股</TableHead>
                <TableHead className="text-right">股數</TableHead>
                <TableHead className="text-right">應收</TableHead>
                <TableHead className="text-right">扣款</TableHead>
                <TableHead className="text-right">實收</TableHead>
                <TableHead>發放日</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="tabular-nums">{d.ex_date}</TableCell>
                  {showAccount && <TableCell>{accountsById.get(d.account_id)?.name ?? "—"}</TableCell>}
                  <TableCell>
                    <span className="font-medium">{d.symbol}</span>{" "}
                    <span className="text-xs text-muted-foreground">{d.name ?? ""}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.cash_per_share, 6)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.shares)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(d.gross_amount, d.currency)}</TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={`補充保費 ${d.nhi_premium}／預扣稅 ${d.withholding_tax}／匯費 ${d.fee}`}
                  >
                    {formatMoney(d.nhi_premium + d.withholding_tax + d.fee, d.currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(d.net_amount, d.currency)}
                  </TableCell>
                  <TableCell className="tabular-nums">{d.pay_date ?? "—"}</TableCell>
                  <TableCell>
                    {d.received_at ? (
                      <span className="text-xs text-muted-foreground">{d.received_at} 入帳</span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 border-amber-500/50 px-2 text-xs text-amber-700 dark:text-amber-400"
                        onClick={() => void markReceived(d)}
                        title="標記為已入帳"
                      >
                        待入帳 → 已入帳
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditing(d);
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
                        onClick={() => setDeleting(d)}
                        aria-label="刪除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DividendFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        accounts={data.accounts}
        defaultAccountId={accountFilter !== "all" ? accountFilter : undefined}
        trades={data.trades}
        actions={data.actions}
        dividend={editing}
        onSaved={onReload}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="刪除股利"
        description={deleting ? `確定刪除 ${deleting.ex_date} ${deleting.symbol} 的股利紀錄？` : ""}
        confirmLabel="刪除"
        destructive
        onConfirm={async () => {
          if (deleting) await handleDelete(deleting);
        }}
      />
    </div>
  );
}
