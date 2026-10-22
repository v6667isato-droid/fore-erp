"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import { parseStatementRows, type StatementParseResult } from "@/lib/invest-statement-import";
import { SIDE_LABELS, type InvestAccount, type InvestTrade } from "@/lib/invest-types";
import {
  AccountSelect,
  formatMoney,
  formatNumber,
  InvestDialog,
  inputClass,
  labelClass,
} from "@/components/investments/invest-ui";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: InvestAccount[];
  defaultAccountId?: string;
  existingTrades: InvestTrade[];
  onImported: () => Promise<void>;
};

const INSERT_CHUNK = 500;
const MAX_ERRORS_SHOWN = 20;

async function readRows(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    return Papa.parse<unknown[]>(text, { skipEmptyLines: true }).data;
  }
  // universal 版本不開 Web Worker，在 Next／Cloudflare 打包最單純；對帳單檔案小，同步解析即可
  const { readSheet } = await import("read-excel-file/universal");
  return (await readSheet(await file.arrayBuffer())) as unknown[][];
}

export function TradeImportDialog(props: Props) {
  // 關閉時卸載，下次打開是乾淨的狀態
  return props.open ? <TradeImport {...props} /> : null;
}

function TradeImport({ onOpenChange, accounts, defaultAccountId, existingTrades, onImported }: Props) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const existingKeys = new Set(
    existingTrades.filter((t) => t.account_id === accountId && t.dedupe_key).map((t) => t.dedupe_key!)
  );
  const fresh = parsed ? parsed.trades.filter((t) => !existingKeys.has(t.dedupe_key)) : [];
  const skipped = parsed ? parsed.trades.length - fresh.length : 0;
  const dates = parsed?.trades.map((t) => t.trade_date).sort() ?? [];
  const otherCurrencies = account ? [...new Set(fresh.map((t) => t.currency))].filter((c) => c !== account.currency) : [];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setReading(true);
    try {
      setParsed(parseStatementRows(await readRows(file)));
    } catch (e) {
      toast.error(`讀取檔案失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  }

  async function handleImport() {
    if (!account || fresh.length === 0) return;
    setSaving(true);
    for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
      const chunk = fresh.slice(i, i + INSERT_CHUNK).map((t) => ({
        account_id: account.id,
        trade_date: t.trade_date,
        symbol: t.symbol,
        name: t.name,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        amount: t.amount,
        fee: t.fee,
        tax: t.tax,
        net_amount: t.net_amount,
        currency: t.currency,
        order_no: t.order_no,
        dedupe_key: t.dedupe_key,
        source: "import" as const,
      }));
      // 已存在的（例如同時開兩個視窗重複匯入）由資料庫唯一鍵略過
      const { error } = await investDb
        .from("invest_trades")
        .upsert(chunk, { onConflict: "owner_id,account_id,dedupe_key", ignoreDuplicates: true });
      if (error) {
        setSaving(false);
        toast.error(`匯入失敗（已匯入 ${i} 筆）：${error.message}`);
        await onImported();
        return;
      }
    }
    setSaving(false);
    toast.success(`已匯入 ${fresh.length} 筆交易`);
    onOpenChange(false);
    await onImported();
  }

  return (
    <InvestDialog
      open
      onOpenChange={onOpenChange}
      wide
      title="匯入買賣對帳單"
      description="台股買賣對帳單、複委託對帳單都可以（Excel .xlsx 或 CSV）。已匯入過的交易（同成交日、委託單號、代號、數量、價格）會自動略過，可以放心重複匯入。"
      footer={
        <>
          <Button type="button" onClick={() => void handleImport()} disabled={saving || fresh.length === 0 || otherCurrencies.length > 0}>
            {saving ? "匯入中…" : `匯入 ${fresh.length} 筆`}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={labelClass}>匯入到帳戶</span>
            <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>對帳單檔案</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              className={cn(inputClass, "py-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-sm")}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </label>
        </div>

        {reading && <p className="text-sm text-muted-foreground">讀取 {fileName} 中…</p>}

        {parsed && !parsed.headerFound && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            找不到對帳單的標題列。需要有「成交日、商品、買賣、數量、成交價」等欄位；如果是不同券商的格式，請把檔案傳給我調整。
          </p>
        )}

        {parsed?.headerFound && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span>
                共 <b>{parsed.trades.length}</b> 筆
                {dates.length > 0 && `（${dates[0]} ～ ${dates[dates.length - 1]}）`}
              </span>
              <span>
                新交易 <b className="text-foreground">{fresh.length}</b> 筆
              </span>
              <span className="text-muted-foreground">已匯入過 {skipped} 筆（略過）</span>
              {parsed.errors.length > 0 && <span className="text-destructive">無法辨識 {parsed.errors.length} 列</span>}
            </div>

            {otherCurrencies.length > 0 && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                對帳單幣別（{otherCurrencies.join("、")}）與帳戶幣別（{account?.currency}）不同，不能匯入：請改選幣別相同的帳戶，
                或先關閉視窗按「新增帳戶」建立{otherCurrencies.includes("USD") ? "美股" : "對應的"}帳戶。
              </p>
            )}

            {parsed.errors.length > 0 && (
              <ul className="space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {parsed.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => (
                  <li key={e.row}>
                    第 {e.row} 列：{e.message}
                  </li>
                ))}
                {parsed.errors.length > MAX_ERRORS_SHOWN && <li>…另有 {parsed.errors.length - MAX_ERRORS_SHOWN} 列</li>}
              </ul>
            )}

            {fresh.length > 0 && (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>成交日</TableHead>
                      <TableHead>標的</TableHead>
                      <TableHead>買賣</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">成交價</TableHead>
                      <TableHead className="text-right">淨收付</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fresh.map((t) => (
                      <TableRow key={t.dedupe_key}>
                        <TableCell className="tabular-nums">{t.trade_date}</TableCell>
                        <TableCell>
                          {t.symbol} <span className="text-xs text-muted-foreground">{t.name ?? ""}</span>
                        </TableCell>
                        <TableCell>{SIDE_LABELS[t.side]}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(t.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(t.price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(t.net_amount, t.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </InvestDialog>
  );
}
