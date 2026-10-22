"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import {
  findDividendSuggestions,
  LIKELY_RECEIVED_AFTER_DAYS,
  type DividendSuggestion,
} from "@/lib/invest-dividend";
import type { InvestData } from "@/components/investments/investments-page";
import type { DividendPrefill } from "@/components/investments/dividend-form-dialog";
import { formatMoney, formatNumber, todayIso } from "@/components/investments/invest-ui";

/** 除權息資料（台股證交所、美股 Yahoo Finance）比對持股後，列出還沒登錄的股利，確認後一鍵加入 */
export function DividendSuggestions({
  data,
  accountFilter,
  onReload,
  onOpenForm,
}: {
  data: InvestData;
  accountFilter: string;
  onReload: () => Promise<void>;
  /** 含配股（沒有每股現金股利）的事件改開表單手動填 */
  onOpenForm: (prefill: DividendPrefill) => void;
}) {
  const [saving, setSaving] = useState(false);
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;

  const suggestions = useMemo(
    () =>
      findDividendSuggestions({
        events: data.dividendEvents,
        accounts: data.accounts,
        trades: data.trades,
        actions: data.actions,
        dividends: data.dividends,
        today: todayIso(),
      }).filter((s) => accountFilter === "all" || s.accountId === accountFilter),
    [data, accountFilter]
  );
  const complete = suggestions.filter((s) => s.estimate);

  if (suggestions.length === 0) return null;

  const currencyOf = (s: DividendSuggestion) => accountsById.get(s.accountId)?.currency ?? "TWD";

  function toRow(s: DividendSuggestion) {
    return {
      account_id: s.accountId,
      symbol: s.symbol,
      name: s.name,
      ex_date: s.exDate,
      pay_date: null,
      cash_per_share: s.cashPerShare,
      shares: s.shares,
      gross_amount: s.estimate?.grossAmount ?? 0,
      nhi_premium: s.estimate?.nhiPremium ?? 0,
      withholding_tax: s.estimate?.withholdingTax ?? 0,
      fee: 0,
      currency: currencyOf(s),
      // 除息很久以前的股利應該早已入帳；入帳日不知道，先記為除息日（可再編輯）
      received_at: s.likelyReceived ? s.exDate : null,
      note: s.market === "US" ? "Yahoo Finance 股利資料自動帶入" : "證交所除權息資料自動帶入",
    };
  }

  async function insert(rows: DividendSuggestion[]) {
    setSaving(true);
    const { error } = await investDb
      .from("invest_dividends")
      .upsert(rows.map(toRow), { onConflict: "owner_id,account_id,symbol,ex_date", ignoreDuplicates: true });
    setSaving(false);
    if (error) {
      toast.error(`加入股利失敗：${error.message}`);
      return;
    }
    toast.success(`已加入 ${rows.length} 筆股利`);
    await onReload();
  }

  function handleAdd(s: DividendSuggestion) {
    if (s.estimate) {
      void insert([s]);
      return;
    }
    toast.info("這筆含配股：請填每股現金股利；配到的股數到「拆股／配股」登錄。");
    onOpenForm({ accountId: s.accountId, symbol: s.symbol, name: s.name, exDate: s.exDate });
  }

  return (
    <div className="space-y-3 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-sky-600" />
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
          除權息資料：找到 {suggestions.length} 筆你有持股、還沒登錄的股利
        </p>
        {complete.length > 0 && (
          <Button type="button" onClick={() => void insert(complete)} disabled={saving}>
            {saving ? "加入中…" : `全部加入（${complete.length} 筆）`}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        持股依除息日前一天的交易紀錄（含拆股）計算；台股扣二代健保補充保費、美股扣 30% 預扣稅，皆為試算，實際以入帳為準、加入後可再編輯。除息日超過 {LIKELY_RECEIVED_AFTER_DAYS.TW}{" "}
        天（台股）／{LIKELY_RECEIVED_AFTER_DAYS.US} 天（美股）的直接記為已入帳（入帳日先記為除息日）。
      </p>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>除息日</TableHead>
              {showAccount && <TableHead>帳戶</TableHead>}
              <TableHead>標的</TableHead>
              <TableHead className="text-right">每股</TableHead>
              <TableHead className="text-right">持股</TableHead>
              <TableHead className="text-right">應收</TableHead>
              <TableHead className="text-right">補充保費／預扣稅</TableHead>
              <TableHead>加入後</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {suggestions.map((s) => (
              <TableRow key={`${s.accountId}|${s.symbol}|${s.exDate}`}>
                <TableCell className="tabular-nums">{s.exDate}</TableCell>
                {showAccount && <TableCell>{accountsById.get(s.accountId)?.name ?? "—"}</TableCell>}
                <TableCell>
                  <span className="font-medium">{s.symbol}</span>{" "}
                  <span className="text-xs text-muted-foreground">{s.name ?? ""}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.cashPerShare == null ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400">含配股（{s.rightsType}）</span>
                  ) : (
                    formatNumber(s.cashPerShare, 6)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(s.shares)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.estimate ? formatMoney(s.estimate.grossAmount, currencyOf(s)) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.estimate
                    ? formatMoney(s.estimate.nhiPremium + s.estimate.withholdingTax, currencyOf(s))
                    : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.likelyReceived ? "已入帳" : "待入帳"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3"
                    onClick={() => handleAdd(s)}
                    disabled={saving}
                  >
                    {s.estimate ? "加入" : "填寫"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
