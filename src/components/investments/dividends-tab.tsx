"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { investDb } from "@/lib/invest-client";
import { toTwd } from "@/lib/invest-portfolio";
import type { InvestDividend } from "@/lib/invest-types";
import type { InvestData } from "@/components/investments/investments-page";
import { DividendFormDialog, type DividendPrefill } from "@/components/investments/dividend-form-dialog";
import { DividendSuggestions } from "@/components/investments/dividend-suggestions";
import { Cell, GroupRow, HeadCell, InvestTable, Row, ShowMoreFooter } from "@/components/investments/invest-table";
import {
  currencyPrefix,
  formatMoney,
  formatNumber,
  inputClass,
  Panel,
  Segmented,
  Stat,
  todayIso,
} from "@/components/investments/invest-ui";

type StatusFilter = "all" | "pending" | "received";

const PAGE_SIZE = 50;

/** 依幣別加總 */
function sumByCurrency(rows: InvestDividend[], pick: (d: InvestDividend) => number): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of rows) map.set(d.currency, (map.get(d.currency) ?? 0) + pick(d));
  return map;
}

/**
 * 多幣別金額的顯示：只有一種幣別直接顯示；多種幣別時主數字換算台幣（美元以目前匯率），
 * 補充說明列出各幣別。沒有匯率無法換算時改成各幣別相加的文字。
 */
function moneySummary(byCurrency: Map<string, number>, usdTwd: number | null): { main: string; parts: string | null } {
  const entries = [...byCurrency].sort(([a], [b]) => (a === "TWD" ? -1 : b === "TWD" ? 1 : a.localeCompare(b)));
  const parts = entries.map(([c, v]) => `${currencyPrefix(c)} ${formatMoney(v, c)}`);
  if (entries.length === 0) return { main: "NT$ 0", parts: null };
  if (entries.length === 1) return { main: parts[0], parts: null };
  let total = 0;
  for (const [c, v] of entries) {
    const twd = toTwd(v, c, usdTwd);
    if (twd == null) return { main: parts.join(" ＋ "), parts: null };
    total += twd;
  }
  return { main: `NT$ ${formatMoney(total)}`, parts: parts.join(" ＋ ") };
}

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
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestDividend | null>(null);
  const [prefill, setPrefill] = useState<DividendPrefill | null>(null);
  const [deleting, setDeleting] = useState<InvestDividend | null>(null);

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const showAccount = accountFilter === "all" && data.accounts.length > 1;
  const usdTwd = data.usdTwd?.rate ?? null;

  const years = useMemo(
    () => [...new Set(data.dividends.map((d) => d.ex_date.slice(0, 4)))].sort().reverse(),
    [data.dividends]
  );
  const inAccount = useMemo(
    () => data.dividends.filter((d) => accountFilter === "all" || d.account_id === accountFilter),
    [data.dividends, accountFilter]
  );
  const rows = useMemo(
    () =>
      inAccount
        .filter((d) => year === "all" || d.ex_date.startsWith(year))
        .filter((d) => status === "all" || (status === "pending" ? !d.received_at : Boolean(d.received_at)))
        .sort((a, b) => (a.ex_date < b.ex_date ? 1 : a.ex_date > b.ex_date ? -1 : 0)),
    [inAccount, year, status]
  );

  // 摘要不受年度／狀態篩選影響（只看帳戶）
  const thisYear = todayIso().slice(0, 4);
  const received = inAccount.filter((d) => d.received_at);
  const pending = inAccount.filter((d) => !d.received_at);
  const yearSummary = moneySummary(
    sumByCurrency(
      received.filter((d) => d.ex_date.startsWith(thisYear)),
      (d) => d.net_amount
    ),
    usdTwd
  );
  const receivedSummary = moneySummary(sumByCurrency(received, (d) => d.net_amount), usdTwd);
  const pendingSummary = moneySummary(sumByCurrency(pending, (d) => d.net_amount), usdTwd);
  const deductionSummary = moneySummary(
    sumByCurrency(inAccount, (d) => d.nhi_premium + d.withholding_tax + d.fee),
    usdTwd
  );
  const hasForeign = inAccount.some((d) => d.currency !== "TWD");

  const shown = rows.slice(0, limit);
  const groups: { year: string; rows: InvestDividend[]; all: InvestDividend[] }[] = [];
  for (const d of shown) {
    const y = d.ex_date.slice(0, 4);
    const last = groups.at(-1);
    if (last?.year === y) last.rows.push(d);
    else groups.push({ year: y, rows: [d], all: rows.filter((r) => r.ex_date.startsWith(y)) });
  }
  const colSpan = 9;

  function changeFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setLimit(PAGE_SIZE);
    };
  }

  async function markReceived(d: InvestDividend) {
    const { error } = await investDb
      .from("invest_dividends")
      .update({ received_at: d.pay_date ?? todayIso() })
      .eq("id", d.id);
    if (error) {
      toast.error(`更新失敗：${error.message}`);
      return;
    }
    await onReload();
  }

  async function handleDelete(d: InvestDividend) {
    const { error } = await investDb.from("invest_dividends").delete().eq("id", d.id);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    toast.success("已刪除股利");
    await onReload();
  }

  return (
    <div className="space-y-4">
      <DividendSuggestions
        data={data}
        accountFilter={accountFilter}
        onReload={onReload}
        onOpenForm={(p) => {
          setEditing(null);
          setPrefill(p);
          setFormOpen(true);
        }}
      />

      {inAccount.length > 0 && (
        <section
          className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:px-5 lg:grid-cols-4"
          aria-label="股利摘要"
        >
          <Stat label={`今年已入帳（${thisYear}）`} value={yearSummary.main} sub={yearSummary.parts} size="lg" />
          <Stat
            label="累計已入帳"
            value={receivedSummary.main}
            sub={`${received.length} 筆${receivedSummary.parts && hasForeign ? " · 美元以目前匯率換算" : ""}`}
            size="lg"
          />
          <Stat
            label="待入帳"
            value={`${pending.length} 筆`}
            sub={pending.length > 0 ? `約 ${pendingSummary.main}` : "除息後還沒入帳的股利"}
            size="lg"
          />
          <Stat
            label="補充保費＋稅＋匯費（累計）"
            value={deductionSummary.main}
            sub={deductionSummary.parts}
            size="lg"
          />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
          label="入帳狀態"
          size="md"
          className="flex-1 sm:flex-none"
          options={[
            { value: "all", label: "全部" },
            { value: "pending", label: "待入帳" },
            { value: "received", label: "已入帳" },
          ]}
          value={status}
          onChange={changeFilter(setStatus)}
        />
        <Button
          type="button"
          className="h-10 w-full sm:ml-auto sm:h-9 sm:w-auto"
          onClick={() => {
            setEditing(null);
            setPrefill(null);
            setFormOpen(true);
          }}
          disabled={data.accounts.length === 0}
        >
          <Plus className="h-4 w-4" />
          新增股利
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {data.dividends.length === 0
            ? "還沒有股利紀錄。台股股利會從證交所除權息資料自動偵測（列在上方），也可以按「新增股利」手動輸入。"
            : status === "pending"
              ? "沒有待入帳的股利。"
              : "沒有符合條件的股利。"}
        </div>
      ) : (
        <Panel
          title="股利明細"
          subtitle="依年度分組；表格往右捲動時「標的」欄固定"
          footer={<ShowMoreFooter shown={shown.length} total={rows.length} onShowMore={() => setLimit((n) => n + PAGE_SIZE)} />}
        >
          <InvestTable minWidth={920}>
            <thead>
              <tr>
                <HeadCell sticky className="w-32 sm:w-56">
                  標的／除息日
                </HeadCell>
                <HeadCell align="right">每股</HeadCell>
                <HeadCell align="right">股數</HeadCell>
                <HeadCell align="right">應收</HeadCell>
                <HeadCell align="right">扣款</HeadCell>
                <HeadCell align="right">實收</HeadCell>
                <HeadCell>發放日</HeadCell>
                <HeadCell>狀態</HeadCell>
                <HeadCell className="w-20">
                  <span className="sr-only">操作</span>
                </HeadCell>
              </tr>
            </thead>
            {groups.map((g) => {
              const net = moneySummary(sumByCurrency(g.all, (d) => d.net_amount), usdTwd);
              return (
                <tbody key={g.year}>
                  <GroupRow
                    colSpan={colSpan}
                    label={`${g.year} 年 · ${g.all.length} 筆`}
                    detail={`實收 ${net.parts ? `${net.parts}（≈ ${net.main}）` : net.main}`}
                  />
                  {g.rows.map((d) => (
                    <Row key={d.id}>
                      <Cell sticky className="w-32 max-w-32 py-2 sm:w-56 sm:max-w-56">
                        <div className="truncate">
                          <span className="font-semibold text-foreground">{d.symbol}</span>{" "}
                          <span className="hidden text-xs text-muted-foreground sm:inline">{d.name !== d.symbol ? (d.name ?? "") : ""}</span>
                        </div>
                        <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                          除息 {d.ex_date.replaceAll("-", "/")}
                          {showAccount && ` · ${accountsById.get(d.account_id)?.name ?? ""}`}
                        </div>
                      </Cell>
                      <Cell align="right">{formatNumber(d.cash_per_share, 6)}</Cell>
                      <Cell align="right">{formatNumber(d.shares)}</Cell>
                      <Cell align="right">{formatMoney(d.gross_amount, d.currency)}</Cell>
                      <Cell
                        align="right"
                        className="text-muted-foreground"
                        title={`補充保費 ${d.nhi_premium}／預扣稅 ${d.withholding_tax}／匯費 ${d.fee}`}
                      >
                        {formatMoney(d.nhi_premium + d.withholding_tax + d.fee, d.currency)}
                      </Cell>
                      <Cell align="right" className="whitespace-nowrap font-semibold">
                        {formatMoney(d.net_amount, d.currency)}
                        {d.currency !== "TWD" && (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">{d.currency}</span>
                        )}
                      </Cell>
                      <Cell className="tabular-nums text-muted-foreground">{d.pay_date?.replaceAll("-", "/") ?? "—"}</Cell>
                      <Cell className="py-1.5">
                        {d.received_at ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                            <Check className="h-3 w-3" aria-hidden="true" />
                            已入帳 {d.received_at.slice(5).replace("-", "/")}
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 border-amber-500/50 px-2.5 text-xs text-amber-700 sm:h-7 dark:text-amber-400"
                            onClick={() => void markReceived(d)}
                          >
                            標記已入帳
                          </Button>
                        )}
                      </Cell>
                      <Cell className="py-1">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 sm:h-8 sm:w-8"
                            onClick={() => {
                              setEditing(d);
                              setFormOpen(true);
                            }}
                            aria-label={`編輯 ${d.ex_date} ${d.symbol}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-destructive sm:h-8 sm:w-8"
                            onClick={() => setDeleting(d)}
                            aria-label={`刪除 ${d.ex_date} ${d.symbol}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Cell>
                    </Row>
                  ))}
                </tbody>
              );
            })}
          </InvestTable>
        </Panel>
      )}

      <DividendFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        accounts={data.accounts}
        defaultAccountId={accountFilter !== "all" ? accountFilter : undefined}
        trades={data.trades}
        actions={data.actions}
        dividend={editing}
        prefill={prefill}
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
