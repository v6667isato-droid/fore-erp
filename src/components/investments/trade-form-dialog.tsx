"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { investDb } from "@/lib/invest-client";
import type { InvestAccount, InvestTrade, TradeSide } from "@/lib/invest-types";
import {
  AccountSelect,
  formatMoney,
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
  /** 編輯既有交易；null＝新增 */
  trade: InvestTrade | null;
  onSaved: () => Promise<void>;
};

/** 對帳單沒有的交易（或要修正的匯入交易）手動新增／編輯 */
export function TradeFormDialog(props: Props) {
  // 關閉時卸載，下次打開重新帶入初始值
  return props.open ? <TradeForm {...props} /> : null;
}

/** 台幣價金到元（零股如 50 × 154.75 = 7737.5，券商以 7737 計），外幣到分 */
function computeAmount(quantity: number, price: number, currency: string): number {
  const raw = quantity * price;
  return currency === "TWD" ? Math.floor(raw + 1e-6) : Math.round(raw * 100 + 1e-7) / 100;
}

function TradeForm({ onOpenChange, accounts, defaultAccountId, trade, onSaved }: Props) {
  const [accountId, setAccountId] = useState(trade?.account_id ?? defaultAccountId ?? accounts[0]?.id ?? "");
  const [tradeDate, setTradeDate] = useState(trade?.trade_date ?? todayIso());
  const [symbol, setSymbol] = useState(trade?.symbol ?? "");
  const [name, setName] = useState(trade?.name ?? "");
  const [side, setSide] = useState<TradeSide>(trade?.side ?? "buy");
  const [quantity, setQuantity] = useState<number | null>(trade?.quantity ?? null);
  const [price, setPrice] = useState<number | null>(trade?.price ?? null);
  const [fee, setFee] = useState<number | null>(trade?.fee ?? null);
  const [tax, setTax] = useState<number | null>(trade?.tax ?? null);
  const [note, setNote] = useState(trade?.note ?? "");
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "TWD";
  const amount = quantity && price != null ? computeAmount(quantity, price, currency) : 0;
  const netAmount = side === "buy" ? amount + (fee ?? 0) + (tax ?? 0) : amount - (fee ?? 0) - (tax ?? 0);

  async function handleSave() {
    if (!account) return toast.error("請選擇帳戶");
    if (!tradeDate) return toast.error("請輸入成交日");
    if (!symbol.trim()) return toast.error("請輸入代號");
    if (!quantity || quantity <= 0) return toast.error("請輸入數量");
    if (price == null) return toast.error("請輸入成交價");

    const payload = {
      account_id: account.id,
      trade_date: tradeDate,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || null,
      side,
      quantity,
      price,
      amount,
      fee: fee ?? 0,
      tax: tax ?? 0,
      net_amount: netAmount,
      currency,
      note: note.trim() || null,
    };
    setSaving(true);
    const { error } = trade
      ? await investDb.from("invest_trades").update(payload).eq("id", trade.id)
      : await investDb.from("invest_trades").insert({ ...payload, source: "manual" });
    setSaving(false);
    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }
    toast.success(trade ? "已更新交易" : "已新增交易");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <InvestDialog
      open
      onOpenChange={onOpenChange}
      title={trade ? "編輯交易" : "手動新增交易"}
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
          <span className={labelClass}>成交日</span>
          <input type="date" className={inputClass} value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>代號</span>
          <input
            className={inputClass}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="例如：0050、VOO"
          />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>名稱</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>買賣</span>
          <select className={inputClass} value={side} onChange={(e) => setSide(e.target.value as TradeSide)}>
            <option value="buy">買進</option>
            <option value="sell">賣出</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelClass}>數量（股）</span>
            <NumericInput className="w-full" allowDecimal value={quantity} onValueChange={setQuantity} />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>成交價</span>
            <NumericInput className="w-full" allowDecimal value={price} onValueChange={setPrice} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelClass}>手續費</span>
            <NumericInput className="w-full" allowDecimal={currency !== "TWD"} value={fee} onValueChange={setFee} />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>交易稅</span>
            <NumericInput className="w-full" allowDecimal={currency !== "TWD"} value={tax} onValueChange={setTax} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className={labelClass}>備註</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
        <span>
          價金 <span className="font-medium tabular-nums">{formatMoney(amount, currency)}</span>
        </span>
        <span>
          {side === "buy" ? "應付" : "應收"}{" "}
          <span className="font-medium tabular-nums">{formatMoney(netAmount, currency)}</span>
        </span>
      </div>
    </InvestDialog>
  );
}
