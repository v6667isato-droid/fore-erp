"use client";

import { useId, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { investDb } from "@/lib/invest-client";
import {
  findDividendSuggestions,
  LIKELY_RECEIVED_AFTER_DAYS,
  type DividendSuggestion,
} from "@/lib/invest-dividend";
import type { InvestData } from "@/components/investments/investments-page";
import type { DividendPrefill } from "@/components/investments/dividend-form-dialog";
import { Cell, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
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
  const titleId = useId();
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
    <section aria-labelledby={titleId} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            偵測到 {suggestions.length} 筆還沒登錄的股利
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            依除息日前一天的持股（含拆股）試算；台股扣二代健保補充保費、美股扣 30% 預扣稅，實際以入帳為準、加入後可再編輯。除息超過{" "}
            {LIKELY_RECEIVED_AFTER_DAYS.TW} 天（台股）／{LIKELY_RECEIVED_AFTER_DAYS.US} 天（美股）的直接記為已入帳（入帳日先記為除息日）。
          </p>
        </div>
        {complete.length > 0 && (
          <Button type="button" className="h-10 w-full sm:h-9 sm:w-auto" onClick={() => void insert(complete)} disabled={saving}>
            {saving ? "加入中…" : `全部加入（${complete.length} 筆）`}
          </Button>
        )}
      </div>
      <div className="border-t border-border">
        <InvestTable minWidth={760} className="max-h-96">
          <thead>
            <tr>
              <HeadCell sticky className="w-32 sm:w-56">
                標的／除息日
              </HeadCell>
              <HeadCell align="right">每股</HeadCell>
              <HeadCell align="right">持股</HeadCell>
              <HeadCell align="right">應收</HeadCell>
              <HeadCell align="right">補充保費／預扣稅</HeadCell>
              <HeadCell>加入後</HeadCell>
              <HeadCell className="w-24">
                <span className="sr-only">操作</span>
              </HeadCell>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s) => (
              <Row key={`${s.accountId}|${s.symbol}|${s.exDate}`}>
                <Cell sticky className="w-32 max-w-32 py-2 sm:w-56 sm:max-w-56">
                  <div className="truncate">
                    <span className="font-semibold text-foreground">{s.symbol}</span>{" "}
                    <span className="hidden text-xs text-muted-foreground sm:inline">{s.name !== s.symbol ? (s.name ?? "") : ""}</span>
                  </div>
                  <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                    除息 {s.exDate.replaceAll("-", "/")}
                    {showAccount && ` · ${accountsById.get(s.accountId)?.name ?? ""}`}
                  </div>
                </Cell>
                <Cell align="right">
                  {s.cashPerShare == null ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400">含配股（{s.rightsType}）</span>
                  ) : (
                    formatNumber(s.cashPerShare, 6)
                  )}
                </Cell>
                <Cell align="right">{formatNumber(s.shares)}</Cell>
                <Cell align="right">{s.estimate ? formatMoney(s.estimate.grossAmount, currencyOf(s)) : "—"}</Cell>
                <Cell align="right">
                  {s.estimate ? formatMoney(s.estimate.nhiPremium + s.estimate.withholdingTax, currencyOf(s)) : "—"}
                </Cell>
                <Cell className="text-xs text-muted-foreground">{s.likelyReceived ? "已入帳" : "待入帳"}</Cell>
                <Cell align="right" className="py-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 px-3 sm:h-8"
                    onClick={() => handleAdd(s)}
                    disabled={saving}
                  >
                    {s.estimate ? "加入" : "填寫"}
                  </Button>
                </Cell>
              </Row>
            ))}
          </tbody>
        </InvestTable>
      </div>
    </section>
  );
}
