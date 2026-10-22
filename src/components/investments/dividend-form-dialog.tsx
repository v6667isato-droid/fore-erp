"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NumericInput } from "@/components/ui/numeric-input";
import { investDb } from "@/lib/invest-client";
import { dividendDeductions, estimateDividend } from "@/lib/invest-dividend";
import { holdingBefore } from "@/lib/invest-portfolio";
import type { InvestAccount, InvestCorporateAction, InvestDividend, InvestTrade } from "@/lib/invest-types";
import {
  AccountSelect,
  formatMoney,
  formatNumber,
  InvestDialog,
  inputClass,
  labelClass,
  todayIso,
} from "@/components/investments/invest-ui";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: InvestAccount[];
  defaultAccountId?: string;
  trades: InvestTrade[];
  actions: InvestCorporateAction[];
  /** 編輯既有股利；null＝新增 */
  dividend: InvestDividend | null;
  onSaved: () => Promise<void>;
};

export function DividendFormDialog(props: Props) {
  // 關閉時卸載，下次打開重新帶入初始值
  return props.open ? <DividendForm {...props} /> : null;
}

/** 股數、應收、扣款預設由系統試算（undefined＝自動），手動改過就以手動值為準 */
function DividendForm({ onOpenChange, accounts, defaultAccountId, trades, actions, dividend, onSaved }: Props) {
  const [accountId, setAccountId] = useState(dividend?.account_id ?? defaultAccountId ?? accounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState(dividend?.symbol ?? "");
  const [name, setName] = useState(dividend?.name ?? "");
  const [exDate, setExDate] = useState(dividend?.ex_date ?? "");
  const [payDate, setPayDate] = useState(dividend?.pay_date ?? "");
  const [cashPerShare, setCashPerShare] = useState<number | null>(dividend?.cash_per_share ?? null);
  const [sharesOverride, setSharesOverride] = useState<number | null | undefined>(dividend?.shares);
  const [grossOverride, setGrossOverride] = useState<number | null | undefined>(dividend?.gross_amount);
  const [nhiOverride, setNhiOverride] = useState<number | null | undefined>(dividend?.nhi_premium);
  const [withholdingOverride, setWithholdingOverride] = useState<number | null | undefined>(
    dividend?.withholding_tax
  );
  const [fee, setFee] = useState<number | null>(dividend?.fee ?? null);
  const [received, setReceived] = useState(Boolean(dividend?.received_at));
  const [receivedAt, setReceivedAt] = useState(dividend?.received_at ?? "");
  const [note, setNote] = useState(dividend?.note ?? "");
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const market = account?.market ?? "TW";
  const currency = account?.currency ?? "TWD";
  const sym = symbol.trim().toUpperCase();
  const allowDecimal = currency !== "TWD";

  const accountTrades = trades.filter((t) => t.account_id === accountId);
  const knownSymbols = [...new Map(accountTrades.map((t) => [t.symbol, t.name])).entries()].sort();
  const knownName = knownSymbols.find(([s]) => s === sym)?.[1] ?? null;

  const autoShares = sym && exDate ? holdingBefore(trades, actions, accountId, sym, exDate) : 0;
  const shares = sharesOverride ?? autoShares;
  const gross =
    grossOverride ?? estimateDividend({ market, shares, cashPerShare: cashPerShare ?? 0 }).grossAmount;
  const autoDeductions = dividendDeductions(market, gross);
  const nhi = nhiOverride ?? autoDeductions.nhiPremium;
  const withholding = withholdingOverride ?? autoDeductions.withholdingTax;
  const net = gross - nhi - withholding - (fee ?? 0);

  function resetAuto() {
    setSharesOverride(undefined);
    setGrossOverride(undefined);
    setNhiOverride(undefined);
    setWithholdingOverride(undefined);
  }

  async function handleSave() {
    if (!account) return toast.error("請選擇帳戶");
    if (!sym) return toast.error("請輸入代號");
    if (!exDate) return toast.error("請輸入除息日");
    if (cashPerShare == null) return toast.error("請輸入每股配息");

    const payload = {
      account_id: account.id,
      symbol: sym,
      name: name.trim() || knownName,
      ex_date: exDate,
      pay_date: payDate || null,
      cash_per_share: cashPerShare,
      shares,
      gross_amount: gross,
      nhi_premium: nhi,
      withholding_tax: withholding,
      fee: fee ?? 0,
      currency,
      received_at: received ? receivedAt || payDate || todayIso() : null,
      note: note.trim() || null,
    };
    setSaving(true);
    const { error } = dividend
      ? await investDb.from("invest_dividends").update(payload).eq("id", dividend.id)
      : await investDb.from("invest_dividends").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "這檔股票在這個除息日已經登錄過" : `儲存失敗：${error.message}`);
      return;
    }
    toast.success(dividend ? "已更新股利" : "已新增股利");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <InvestDialog
      open
      onOpenChange={onOpenChange}
      title={dividend ? "編輯股利" : "新增股利"}
      description="輸入除息日和每股配息，系統會依交易紀錄算出除息日前一天的持股與應收金額。"
      footer={
        <>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={labelClass}>帳戶</span>
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>代號</span>
          <input
            className={inputClass}
            list="invest-dividend-symbols"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="例如：0050"
          />
          <datalist id="invest-dividend-symbols">
            {knownSymbols.map(([s, n]) => (
              <option key={s} value={s}>
                {n ?? ""}
              </option>
            ))}
          </datalist>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>名稱</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={knownName ?? ""}
          />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>每股配息</span>
          <NumericInput className="w-full" allowDecimal value={cashPerShare} onValueChange={setCashPerShare} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelClass}>除息日</span>
            <input type="date" className={inputClass} value={exDate} onChange={(e) => setExDate(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>發放日</span>
            <input type="date" className={inputClass} value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className={labelClass}>除息日前持股（股）</span>
          <NumericInput className="w-full" allowDecimal value={shares} onValueChange={(v) => setSharesOverride(v ?? 0)} />
          {sharesOverride !== undefined && sharesOverride !== autoShares && sym && exDate && (
            <span className="text-[11px] text-muted-foreground">交易紀錄推算為 {formatNumber(autoShares)} 股</span>
          )}
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>應收股利</span>
          <NumericInput className="w-full" allowDecimal={allowDecimal} value={gross} onValueChange={(v) => setGrossOverride(v ?? 0)} />
        </label>
        {market === "US" ? (
          <label className="block space-y-1">
            <span className={labelClass}>預扣稅（30%）</span>
            <NumericInput className="w-full" allowDecimal value={withholding} onValueChange={(v) => setWithholdingOverride(v ?? 0)} />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className={labelClass}>二代健保補充保費</span>
            <NumericInput className="w-full" value={nhi} onValueChange={(v) => setNhiOverride(v ?? 0)} />
          </label>
        )}
        <label className="block space-y-1">
          <span className={labelClass}>匯費／其他扣款</span>
          <NumericInput className="w-full" allowDecimal={allowDecimal} value={fee} onValueChange={setFee} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className={labelClass}>備註</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
        <span>
          實收 <span className="font-semibold tabular-nums">{formatMoney(net, currency)}</span>
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />
          已入帳
        </label>
        {received && (
          <input
            type="date"
            className={cn(inputClass, "w-auto")}
            value={receivedAt || payDate}
            onChange={(e) => setReceivedAt(e.target.value)}
            aria-label="入帳日"
          />
        )}
        <Button type="button" variant="ghost" className="ml-auto h-8 px-2 text-xs" onClick={resetAuto}>
          重新試算
        </Button>
      </div>
    </InvestDialog>
  );
}
