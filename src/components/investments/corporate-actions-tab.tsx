"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NumericInput } from "@/components/ui/numeric-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { investDb } from "@/lib/invest-client";
import { holdingBefore } from "@/lib/invest-portfolio";
import {
  CORPORATE_ACTION_LABELS,
  type CorporateActionType,
  type InvestCorporateAction,
} from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import {
  AccountSelect,
  formatNumber,
  InvestDialog,
  inputClass,
  labelClass,
} from "@/components/investments/invest-ui";

type Prefill = { accountId: string; symbol: string };

function describeAction(a: Pick<InvestCorporateAction, "type" | "ratio" | "quantity">): string {
  if (a.type === "split") return `1 股 → ${formatNumber(a.ratio ?? 0, 8)} 股`;
  return `配 ${formatNumber(a.quantity ?? 0)} 股`;
}

export function CorporateActionsTab({
  data,
  accountFilter,
  onReload,
  prefill,
}: {
  data: InvestData;
  accountFilter: string;
  onReload: () => Promise<void>;
  /** 從持股警告跳過來時預填（切換頁籤會重新掛載，只在掛載時讀一次） */
  prefill: Prefill | null;
}) {
  const [formOpen, setFormOpen] = useState(prefill !== null);
  const [formPrefill, setFormPrefill] = useState<Prefill | null>(prefill);
  const [editing, setEditing] = useState<InvestCorporateAction | null>(null);
  const [deleting, setDeleting] = useState<InvestCorporateAction | null>(null);

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;
  const rows = data.actions
    .filter((a) => accountFilter === "all" || a.account_id === accountFilter)
    .sort((a, b) => (a.action_date < b.action_date ? 1 : a.action_date > b.action_date ? -1 : 0));
  const nameBySymbol = new Map(data.trades.map((t) => [t.symbol, t.name]));

  async function handleDelete(a: InvestCorporateAction) {
    const { error } = await investDb.from("invest_corporate_actions").delete().eq("id", a.id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    toast.success("已刪除");
    await onReload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          買賣對帳單上不會有拆股、配股，但它們會改變股數。例如 0050 在 2025 年 6 月一拆四，沒補登的話之後賣出會被當成賣超。
        </p>
        <Button
          type="button"
          onClick={() => {
            setEditing(null);
            setFormPrefill(null);
            setFormOpen(true);
          }}
          disabled={data.accounts.length === 0}
        >
          <Plus className="h-4 w-4" />
          新增拆股／配股
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          還沒有拆股或配股紀錄。
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>生效日</TableHead>
                {showAccount && <TableHead>帳戶</TableHead>}
                <TableHead>標的</TableHead>
                <TableHead>類型</TableHead>
                <TableHead>內容</TableHead>
                <TableHead>備註</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="tabular-nums">{a.action_date}</TableCell>
                  {showAccount && <TableCell>{accountsById.get(a.account_id)?.name ?? "—"}</TableCell>}
                  <TableCell>
                    <span className="font-medium">{a.symbol}</span>{" "}
                    <span className="text-xs text-muted-foreground">{nameBySymbol.get(a.symbol) ?? ""}</span>
                  </TableCell>
                  <TableCell>{CORPORATE_ACTION_LABELS[a.type]}</TableCell>
                  <TableCell className="tabular-nums">{describeAction(a)}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{a.note ?? ""}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditing(a);
                          setFormPrefill(null);
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
                        onClick={() => setDeleting(a)}
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

      {formOpen && (
        <CorporateActionForm
          data={data}
          defaultAccountId={formPrefill?.accountId ?? (accountFilter !== "all" ? accountFilter : undefined)}
          defaultSymbol={formPrefill?.symbol}
          action={editing}
          onOpenChange={setFormOpen}
          onSaved={onReload}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="刪除拆股／配股"
        description={
          deleting ? `確定刪除 ${deleting.action_date} ${deleting.symbol} ${CORPORATE_ACTION_LABELS[deleting.type]}？` : ""
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

function CorporateActionForm({
  data,
  defaultAccountId,
  defaultSymbol,
  action,
  onOpenChange,
  onSaved,
}: {
  data: InvestData;
  defaultAccountId?: string;
  defaultSymbol?: string;
  /** 編輯既有紀錄；null＝新增 */
  action: InvestCorporateAction | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(action?.account_id ?? defaultAccountId ?? data.accounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState(action?.symbol ?? defaultSymbol ?? "");
  const [type, setType] = useState<CorporateActionType>(action?.type ?? "split");
  const [actionDate, setActionDate] = useState(action?.action_date ?? "");
  const [ratio, setRatio] = useState<number | null>(action?.ratio ?? null);
  const [quantity, setQuantity] = useState<number | null>(action?.quantity ?? null);
  const [note, setNote] = useState(action?.note ?? "");
  const [saving, setSaving] = useState(false);

  const sym = symbol.trim().toUpperCase();
  const knownSymbols = [
    ...new Map(data.trades.filter((t) => t.account_id === accountId).map((t) => [t.symbol, t.name])).entries(),
  ].sort();
  // 生效前持股：排除正在編輯的這筆
  const before =
    sym && actionDate
      ? holdingBefore(
          data.trades,
          data.actions.filter((a) => a.id !== action?.id),
          accountId,
          sym,
          actionDate
        )
      : null;
  const after =
    before == null ? null : type === "split" ? (ratio ? before * ratio : null) : before + (quantity ?? 0);

  async function handleSave() {
    if (!accountId) return toast.error("請選擇帳戶");
    if (!sym) return toast.error("請輸入代號");
    if (!actionDate) return toast.error("請輸入生效日");
    if (type === "split" && !ratio) return toast.error("請輸入拆股比例");
    if (type === "stock_dividend" && !quantity) return toast.error("請輸入配到的股數");

    const payload = {
      account_id: accountId,
      symbol: sym,
      type,
      action_date: actionDate,
      ratio: type === "split" ? ratio : null,
      quantity: type === "stock_dividend" ? quantity : null,
      note: note.trim() || null,
    };
    setSaving(true);
    const { error } = action
      ? await investDb.from("invest_corporate_actions").update(payload).eq("id", action.id)
      : await investDb.from("invest_corporate_actions").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }
    toast.success("已儲存");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <InvestDialog
      open
      onOpenChange={onOpenChange}
      title={action ? "編輯拆股／配股" : "新增拆股／配股"}
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
          <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>代號</span>
          <input
            className={inputClass}
            list="invest-action-symbols"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
          <datalist id="invest-action-symbols">
            {knownSymbols.map(([s, n]) => (
              <option key={s} value={s}>
                {n ?? ""}
              </option>
            ))}
          </datalist>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>類型</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as CorporateActionType)}>
            <option value="split">拆股（分割／反分割）</option>
            <option value="stock_dividend">配股（股票股利）</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>生效日</span>
          <input type="date" className={inputClass} value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
        </label>
        {type === "split" ? (
          <label className="block space-y-1">
            <span className={labelClass}>1 股變成幾股</span>
            <NumericInput className="w-full" allowDecimal value={ratio} onValueChange={setRatio} placeholder="一拆四填 4" />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className={labelClass}>配到的股數</span>
            <NumericInput className="w-full" allowDecimal value={quantity} onValueChange={setQuantity} />
          </label>
        )}
        <label className="block space-y-1">
          <span className={labelClass}>備註</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {type === "split"
          ? "生效日填拆股後恢復交易的第一天，當天起的交易以新股數計；反分割（二合一）填 0.5。總成本不變，平均成本會等比例下降。"
          : "生效日填除權交易日，股數填實際配到的股數（集保 e存摺或配股通知書上有）。配股不增加成本，平均成本會下降；畸零股發的現金請記在股利。"}
      </p>
      {before != null && (
        <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          生效前持股 <span className="font-medium tabular-nums">{formatNumber(before)}</span> 股
          {after != null && (
            <>
              {" "}
              → 生效後 <span className="font-medium tabular-nums">{formatNumber(after)}</span> 股
            </>
          )}
        </div>
      )}
    </InvestDialog>
  );
}
