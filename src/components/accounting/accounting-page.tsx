"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Download, FileDown, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchConfirmedInvoices,
  invoiceOwnerCategory,
  OWNER_CATEGORY_LABELS,
  SOURCE_LABELS,
  type AccountingInvoiceRow,
  type InvoiceOwnerCategory,
} from "@/lib/accounting-invoice";
import { fetchPoOptions, suggestPos, type PoOption } from "@/lib/accounting-po-match";
import {
  evaluateInvoiceLottery,
  lotteryPeriodLabel,
  type InvoiceLotteryDraw,
  type LotteryOutcome,
} from "@/lib/invoice-lottery";
import { fetchLotteryDraws, missingAnnouncedPeriods, syncLotteryDraws } from "@/lib/invoice-lottery-data";
import { displayPoNumber } from "@/lib/purchase-order";
import { AccountingInvoiceQueue } from "@/components/accounting/accounting-invoice-queue";
import { AccountingInvoiceReviewDialog } from "@/components/accounting/accounting-invoice-review-dialog";
import { exportAccountingInvoicesCsv } from "@/components/accounting/export-accounting-invoices-csv";
import { ExportTaxMediaDialog } from "@/components/accounting/export-tax-media-dialog";
import { SalesInvoicesPage } from "@/components/accounting/sales-invoices-page";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type AccountingTab = "input" | "sales";

/** 採購單對應狀態：已對應／有日期金額相符但尚未對應／無對應 */
type PoMatchState = "matched" | "candidate" | "none";
type MatchFilter = "all" | PoMatchState;

/** 「有相符」的日期容許差（天）：金額相符且採購日期在此範圍內才算找到 */
const PO_CANDIDATE_MAX_DAYS = 7;

const PO_MATCH_LABELS: Record<PoMatchState, string> = {
  matched: "已對應",
  candidate: "有相符",
  none: "無對應",
};

/** 今天（本地時區）YYYY-MM-DD，用來判斷各期是否已開獎 */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 對應採購單狀態徽章：已對應／有相符（尚未對應）／無對應；詳細採購單資訊放 tooltip */
function PoMatchBadge({ match }: { match?: { state: PoMatchState; detail: string } }) {
  const state = match?.state ?? "none";
  const tone =
    state === "matched"
      ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
      : state === "candidate"
        ? "border-sky-500/50 text-sky-700 dark:text-sky-400"
        : "border-border text-muted-foreground";
  return (
    <span
      className={`rounded border px-1.5 py-px text-xs font-medium ${tone}`}
      title={match?.detail || undefined}
    >
      {PO_MATCH_LABELS[state]}
    </span>
  );
}

/** 家庭發票兌獎徽章：中獎（獎項＋獎金）／未中獎／未開獎 */
function LotteryBadge({ outcome }: { outcome?: LotteryOutcome }) {
  if (!outcome || outcome.state === "unknown") {
    return <span className="text-xs text-muted-foreground">無法對獎</span>;
  }
  if (outcome.state === "won") {
    return (
      <span
        className="rounded border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-px text-xs font-semibold text-emerald-700 dark:text-emerald-400"
        title={`${lotteryPeriodLabel(outcome.period)} ${outcome.prize.label}，中獎號碼 ${outcome.prize.matched}`}
      >
        中獎 · {outcome.prize.label} ${outcome.prize.amount.toLocaleString()}
      </span>
    );
  }
  if (outcome.state === "lost") {
    return (
      <span
        className="rounded border border-border px-1.5 py-px text-xs text-muted-foreground"
        title={`${lotteryPeriodLabel(outcome.period)}已開獎，未中獎`}
      >
        未中獎
      </span>
    );
  }
  if (outcome.state === "pending") {
    return (
      <span
        className="rounded border border-border px-1.5 py-px text-xs text-muted-foreground"
        title={`${lotteryPeriodLabel(outcome.period)}尚未開獎${outcome.drawDate ? `（${outcome.drawDate} 開獎）` : ""}`}
      >
        未開獎
      </span>
    );
  }
  return (
    <span
      className="rounded border border-amber-500/50 px-1.5 py-px text-xs font-medium text-amber-700 dark:text-amber-500"
      title={`本機尚無 ${lotteryPeriodLabel(outcome.period)} 的中獎號碼，請按「更新中獎號碼」`}
    >
      缺號碼
    </span>
  );
}

/** 會計管理：進項（採購發票歸檔）／銷項（開立發票）兩個頁籤 */
export function AccountingPage() {
  const [tab, setTab] = useState<AccountingTab>("input");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit" role="tablist" aria-label="會計管理頁籤">
        {(
          [
            { id: "input", label: "進項發票（採購）" },
            { id: "sales", label: "銷項發票（開立）" },
          ] as { id: AccountingTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
              tab === t.id
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "input" ? <InputInvoicesTab /> : <SalesInvoicesPage />}
    </div>
  );
}

/** 進項發票（原會計頁內容）：批次上傳→AI 辨識→審核歸檔→401 媒體檔 */
function InputInvoicesTab() {
  const [invoices, setInvoices] = useState<AccountingInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<InvoiceOwnerCategory>("company");
  const [monthFilter, setMonthFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [editRow, setEditRow] = useState<AccountingInvoiceRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccountingInvoiceRow | null>(null);
  const [mediaExportOpen, setMediaExportOpen] = useState(false);
  const [poOptions, setPoOptions] = useState<PoOption[]>([]);
  const [draws, setDraws] = useState<Map<string, InvoiceLotteryDraw>>(new Map());
  const [lotterySyncing, setLotterySyncing] = useState(false);
  /** 自動同步中獎號碼每次進頁只做一次，避免財政部服務異常時反覆重打 */
  const autoSyncedRef = useRef(false);
  const today = useMemo(() => todayIso(), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [rows, pos, lottery] = await Promise.all([fetchConfirmedInvoices(), fetchPoOptions(), fetchLotteryDraws()]);
    setInvoices(rows);
    setPoOptions(pos);
    setDraws(lottery);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 手動更新中獎號碼（篩選列按鈕） */
  const runLotterySync = useCallback(async () => {
    setLotterySyncing(true);
    const result = await syncLotteryDraws();
    if (result.ok) {
      setDraws(await fetchLotteryDraws());
      toast.success(`中獎號碼已更新（最新 ${result.latest ?? ""}）`);
    } else {
      toast.error(result.error || "中獎號碼更新失敗");
    }
    setLotterySyncing(false);
  }, []);

  // 家庭發票所屬期別已開獎卻沒號碼 → 自動（靜默）抓一次財政部中獎號碼
  useEffect(() => {
    if (loading || autoSyncedRef.current) return;
    const familyDates = invoices
      .filter((r) => invoiceOwnerCategory(r.buyer_tax_id) === "family")
      .map((r) => r.invoice_date);
    if (familyDates.length === 0) return;
    if (missingAnnouncedPeriods(familyDates, draws, today).length === 0) return;
    autoSyncedRef.current = true;
    void (async () => {
      const result = await syncLotteryDraws();
      if (result.ok) setDraws(await fetchLotteryDraws());
      else console.warn("中獎號碼自動更新失敗:", result.error);
    })();
  }, [loading, invoices, draws, today]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of invoices) {
      if (r.invoice_date) set.add(r.invoice_date.slice(0, 7));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [invoices]);

  /**
   * 每張發票的採購單對應狀態。未對應時再找「日期與金額相符」的採購單（排除已被其他
   * 發票對應掉的），供清單上以「有相符」提示可直接進去確認。
   */
  const poMatches = useMemo(() => {
    const usedPoIds = new Set(invoices.map((r) => r.purchase_order_id).filter((v): v is string => Boolean(v)));
    const map = new Map<string, { state: PoMatchState; detail: string }>();
    for (const r of invoices) {
      if (r.purchase_orders) {
        map.set(r.id, {
          state: "matched",
          detail: `已對應採購單 ${displayPoNumber(r.purchase_orders.po_number)}（${r.purchase_orders.purchase_date}${
            r.purchase_orders.vendor_name ? `／${r.purchase_orders.vendor_name}` : ""
          }）`,
        });
        continue;
      }
      // 家庭發票不對應採購單
      if (invoiceOwnerCategory(r.buyer_tax_id) === "family" || poOptions.length === 0) {
        map.set(r.id, { state: "none", detail: "尚未對應採購單" });
        continue;
      }
      const hit = suggestPos(
        {
          sellerName: r.seller_name ?? "",
          invoiceDate: r.invoice_date ?? "",
          amountIncTax: r.amount_inc_tax,
          amountExTax: r.amount_ex_tax,
        },
        poOptions,
        5,
      ).find(
        (s) =>
          s.amountExact &&
          s.dateDiffDays != null &&
          Math.abs(s.dateDiffDays) <= PO_CANDIDATE_MAX_DAYS &&
          !usedPoIds.has(s.po.id),
      );
      map.set(
        r.id,
        hit
          ? {
              state: "candidate",
              detail: `找到日期與金額相符的採購單 ${displayPoNumber(hit.po.po_number)}（${hit.po.purchase_date}${
                hit.po.vendor_name ? `／${hit.po.vendor_name}` : ""
              }，含稅 $${hit.po.total_inc_tax.toLocaleString()}）；點編輯即可確認對應`,
            }
          : { state: "none", detail: "找不到日期與金額相符的採購單" },
      );
    }
    return map;
  }, [invoices, poOptions]);

  /** 家庭發票的對獎結果 */
  const lotteryResults = useMemo(() => {
    const map = new Map<string, LotteryOutcome>();
    for (const r of invoices) {
      if (invoiceOwnerCategory(r.buyer_tax_id) !== "family") continue;
      map.set(r.id, evaluateInvoiceLottery(r.invoice_number, r.invoice_date, draws, today));
    }
    return map;
  }, [invoices, draws, today]);

  /** 月份＋搜尋條件下的結果（分類數量以此為基準） */
  const baseFiltered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return invoices.filter((r) => {
      if (monthFilter && (r.invoice_date ?? "").slice(0, 7) !== monthFilter) return false;
      if (q) {
        const haystack = [
          r.invoice_number ?? "",
          r.seller_name ?? "",
          r.seller_tax_id ?? "",
          r.purchase_orders?.po_number ?? "",
          r.purchase_orders?.vendor_name ?? "",
          r.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, monthFilter, searchText]);

  const ownerCounts = useMemo(() => {
    let company = 0;
    let family = 0;
    for (const r of baseFiltered) {
      if (invoiceOwnerCategory(r.buyer_tax_id) === "family") family += 1;
      else company += 1;
    }
    return { company, family };
  }, [baseFiltered]);

  const filtered = useMemo(
    () =>
      baseFiltered.filter((r) => {
        if (invoiceOwnerCategory(r.buyer_tax_id) !== ownerFilter) return false;
        if (ownerFilter === "company" && matchFilter !== "all") {
          if ((poMatches.get(r.id)?.state ?? "none") !== matchFilter) return false;
        }
        return true;
      }),
    [baseFiltered, ownerFilter, matchFilter, poMatches],
  );

  const totals = useMemo(() => {
    let inc = 0;
    let tax = 0;
    let wonCount = 0;
    let wonAmount = 0;
    for (const r of filtered) {
      inc += r.amount_inc_tax ?? 0;
      tax += r.tax_amount ?? 0;
      const lottery = lotteryResults.get(r.id);
      if (lottery?.state === "won") {
        wonCount += 1;
        wonAmount += lottery.prize.amount;
      }
    }
    return { inc: Math.round(inc * 100) / 100, tax: Math.round(tax * 100) / 100, wonCount, wonAmount };
  }, [filtered, lotteryResults]);

  /** 中獎號碼最後同步時間（顯示於家庭發票篩選列） */
  const lotterySyncedAt = useMemo(() => {
    let latest = "";
    for (const d of draws.values()) {
      if (d.synced_at && d.synced_at > latest) latest = d.synced_at;
    }
    return latest ? latest.slice(0, 10) : null;
  }, [draws]);

  async function performDelete() {
    const row = deleteTarget;
    setDeleteTarget(null);
    if (!row) return;
    const { error } = await supabase
      .from("accounting_invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success(`已刪除發票 ${row.invoice_number ?? ""}（照片仍保留於歸檔）`);
    await refresh();
  }

  return (
    <div className="space-y-5">
      {/* 批次上傳＋AI 辨識佇列 */}
      <AccountingInvoiceQueue onConfirmed={() => void refresh()} />

      {/* 已存檔發票 */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">已存檔發票</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {filtered.length} 張
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              含稅總額 ${totals.inc.toLocaleString()}｜稅額 ${totals.tax.toLocaleString()}
            </span>
            {ownerFilter === "family" && (
              <span className="text-xs font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                中獎 {totals.wonCount} 張｜獎金 ${totals.wonAmount.toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => setMediaExportOpen(true)}
              disabled={invoices.length === 0}
            >
              <FileDown className="h-3.5 w-3.5 mr-1" />
              匯出報稅媒體檔
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => exportAccountingInvoicesCsv(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              匯出 CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {/* 公司發票（有買方統編）／家庭發票（無買方統編，可對獎） */}
          <div
            className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5"
            role="tablist"
            aria-label="發票歸類"
          >
            {(["company", "family"] as InvoiceOwnerCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={ownerFilter === c}
                onClick={() => setOwnerFilter(c)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  ownerFilter === c
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {OWNER_CATEGORY_LABELS[c]}
                <span className="ml-1 tabular-nums text-muted-foreground">{ownerCounts[c]}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-40 flex-1 sm:max-w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜尋發票號碼／賣方／採購單號"
              className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="搜尋發票"
            />
          </div>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依發票月份篩選"
          >
            <option value="">全部月份</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {ownerFilter === "company" ? (
            <select
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value as MatchFilter)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="依採購單對應狀態篩選"
            >
              <option value="all">全部對應狀態</option>
              <option value="matched">已對應</option>
              <option value="candidate">有相符</option>
              <option value="none">無對應</option>
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                onClick={() => void runLotterySync()}
                disabled={lotterySyncing}
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${lotterySyncing ? "animate-spin" : ""}`} />
                更新中獎號碼
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {lotterySyncedAt ? `號碼更新於 ${lotterySyncedAt}` : "尚未取得中獎號碼"}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">載入中…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {invoices.length === 0 ? "尚無已存檔的發票；從上方佇列上傳並審核後會列在這裡。" : "沒有符合篩選條件的發票。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* 除賣方外一律單行（whitespace-nowrap）；賣方限寬並可折兩行 */}
            <table className={`w-full text-sm ${ownerFilter === "company" ? "min-w-[900px]" : "min-w-[760px]"}`}>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground [&>th]:whitespace-nowrap">
                  <th className="px-4 py-2 font-medium">發票日期</th>
                  <th className="px-3 py-2 font-medium">發票號碼</th>
                  <th className="px-3 py-2 font-medium">賣方</th>
                  <th className="px-3 py-2 text-right font-medium">未稅</th>
                  <th className="px-3 py-2 text-right font-medium">稅額</th>
                  <th className="px-3 py-2 text-right font-medium">含稅金額</th>
                  {ownerFilter === "company" && <th className="px-3 py-2 font-medium">格式</th>}
                  {ownerFilter === "company" && <th className="px-3 py-2 font-medium">申報</th>}
                  <th className="px-3 py-2 font-medium">來源</th>
                  {ownerFilter === "company" ? (
                    <th className="px-3 py-2 font-medium">對應採購單</th>
                  ) : (
                    <th className="px-3 py-2 font-medium">兌獎</th>
                  )}
                  <th className="px-4 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20 [&>td]:whitespace-nowrap">
                    <td className="px-4 py-2 tabular-nums text-foreground">{r.invoice_date ?? "—"}</td>
                    <td className="px-3 py-2 font-medium tabular-nums text-foreground">{r.invoice_number ?? "—"}</td>
                    <td className="px-3 py-2 text-foreground">
                      <span
                        className="line-clamp-2 block max-w-[13rem] break-words whitespace-normal"
                        title={[r.seller_name, r.seller_tax_id].filter(Boolean).join(" ") || undefined}
                      >
                        {r.seller_name ?? "—"}
                        {r.seller_tax_id && (
                          <span className="ml-1 text-xs text-muted-foreground tabular-nums">({r.seller_tax_id})</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.amount_ex_tax != null ? `$${r.amount_ex_tax.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.tax_amount != null ? `$${r.tax_amount.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                      {r.amount_inc_tax != null ? `$${r.amount_inc_tax.toLocaleString()}` : "—"}
                    </td>
                    {ownerFilter === "company" && (
                      <td
                        className="px-3 py-2 tabular-nums text-muted-foreground"
                        title={`格式代號 ${r.format_code}／課稅別 ${r.tax_type}／扣抵 ${r.deduction_code}`}
                      >
                        {r.format_code}
                      </td>
                    )}
                    {ownerFilter === "company" && (
                      <td className="px-3 py-2">
                        {r.exported_at ? (
                          <span
                            className="rounded border border-emerald-500/50 px-1.5 py-px text-xs font-medium text-emerald-700 dark:text-emerald-400"
                            title={`媒體檔匯出於 ${r.exported_at.slice(0, 10)}`}
                          >
                            已匯出
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">未匯出</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span
                        className="rounded border border-border px-1.5 py-px text-xs text-muted-foreground"
                        title={
                          r.source === "gmail"
                            ? [r.gmail_subject, r.gmail_from, r.gmail_account && `信箱：${r.gmail_account}`]
                                .filter(Boolean)
                                .join("\n") || undefined
                            : undefined
                        }
                      >
                        {SOURCE_LABELS[r.source] ?? r.source}
                      </span>
                    </td>
                    {ownerFilter === "company" ? (
                      <td className="px-3 py-2">
                        <PoMatchBadge match={poMatches.get(r.id)} />
                      </td>
                    ) : (
                      <td className="px-3 py-2">
                        <LotteryBadge outcome={lotteryResults.get(r.id)} />
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="檢視／編輯"
                          aria-label={`檢視或編輯發票 ${r.invoice_number ?? ""}`}
                          onClick={() => {
                            setEditRow(r);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="刪除"
                          aria-label={`刪除發票 ${r.invoice_number ?? ""}`}
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExportTaxMediaDialog
        invoices={invoices}
        open={mediaExportOpen}
        onOpenChange={setMediaExportOpen}
        onExported={() => void refresh()}
      />

      <AccountingInvoiceReviewDialog
        invoice={editRow}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditRow(null);
        }}
        onSaved={() => void refresh()}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="是否刪除此張發票？"
        description={
          deleteTarget ? (
            <>
              <p className="font-medium text-foreground">
                {deleteTarget.invoice_number ?? "（無號碼）"}｜{deleteTarget.seller_name ?? "（無賣方）"}｜含稅 $
                {(deleteTarget.amount_inc_tax ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-muted-foreground">發票紀錄將自清單移除（照片仍保留於歸檔資料夾）。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
