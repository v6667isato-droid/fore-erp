"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Ban, Eye, FileDown, FileMinus, FileText, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { normalizeInvoiceNumber } from "@/lib/accounting-invoice";
import {
  amegoCreateAllowance,
  amegoDownloadInvoicePdf,
  amegoSyncInvoices,
  amegoVoidInvoice,
  fetchSalesInvoices,
  SALES_STATUS_LABELS,
  SYNC_STATUS_LABELS,
  type SalesInvoiceRow,
} from "@/lib/sales-invoice";

/** 這張發票是否由光賀開立（作廢／折讓需同步到光賀） */
function isAmegoSynced(r: SalesInvoiceRow): boolean {
  return r.sync_status === "confirmed" || r.sync_status === "sent";
}
import { SalesInvoiceDialog } from "@/components/accounting/sales-invoice-dialog";
import { ExportSalesTaxMediaDialog } from "@/components/accounting/export-sales-tax-media-dialog";
import { OrderPeekDialog } from "@/components/orders/order-peek-dialog";

type StatusFilter = "all" | "draft" | "issued" | "voided";
type TypeFilter = "all" | "B2B" | "B2C";

const STATUS_BADGE_CLS: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  issued: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  voided: "border-destructive/50 text-destructive",
};

export function SalesInvoicesPage() {
  const [invoices, setInvoices] = useState<SalesInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchText, setSearchText] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [viewRow, setViewRow] = useState<SalesInvoiceRow | null>(null);
  const [editRow, setEditRow] = useState<SalesInvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<SalesInvoiceRow | null>(null);
  const [allowanceTarget, setAllowanceTarget] = useState<SalesInvoiceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalesInvoiceRow | null>(null);
  const [mediaExportOpen, setMediaExportOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setInvoices(await fetchSalesInvoices());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of invoices) {
      if (r.invoice_date) set.add(r.invoice_date.slice(0, 7));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return invoices.filter((r) => {
      if (monthFilter && (r.invoice_date ?? "").slice(0, 7) !== monthFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.invoice_type !== typeFilter) return false;
      if (q) {
        const haystack = [
          r.invoice_number ?? "",
          r.buyer_name ?? "",
          r.buyer_tax_id ?? "",
          r.orders?.order_number ?? "",
          r.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, monthFilter, statusFilter, typeFilter, searchText]);

  // 合計僅計已開立（草稿未定案、作廢不計）
  const totals = useMemo(() => {
    let inc = 0;
    let tax = 0;
    for (const r of filtered) {
      if (r.status !== "issued") continue;
      inc += r.amount_inc_tax ?? 0;
      tax += r.tax_amount ?? 0;
    }
    return { inc: Math.round(inc * 100) / 100, tax: Math.round(tax * 100) / 100 };
  }, [filtered]);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** 點來源訂單標籤 → 快速檢視訂單內容 */
  const [peekOrder, setPeekOrder] = useState<{ id: string; order_number: string } | null>(null);

  /** 從光貿撈回發票：新增 ERP 缺漏的、補作廢狀態；衝突（ERP作廢/光貿開立）僅回報 */
  async function syncFromAmego() {
    setSyncing(true);
    const res = await amegoSyncInvoices();
    setSyncing(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const parts = [`檢查 ${res.checked} 張`, `新增 ${res.imported} 張`];
    if (res.voided_updated > 0) parts.push(`補作廢 ${res.voided_updated} 張`);
    if (res.conflicts.length > 0) parts.push(`狀態衝突 ${res.conflicts.length} 張（${res.conflicts.join("、")}）`);
    if (res.errors.length > 0) {
      toast.error(`同步部分失敗：${res.errors.join("；")}`);
    }
    toast.success(`光貿同步完成：${parts.join("、")}${res.environment === "test" ? "（測試環境）" : ""}`);
    await refresh();
  }

  /** 下載光賀發票 PDF（存為 買方_發票號碼.pdf）；載具發票依規定中獎後才可下載 */
  async function openInvoicePdf(row: SalesInvoiceRow) {
    setDownloadingId(row.id);
    const res = await amegoDownloadInvoicePdf(row);
    setDownloadingId(null);
    if (!res.ok) toast.error(res.error);
  }

  async function performDelete() {
    const row = deleteTarget;
    setDeleteTarget(null);
    if (!row) return;
    const { error } = await supabase
      .from("sales_invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success(`已刪除發票${row.invoice_number ? ` ${row.invoice_number}` : "（草稿）"}`);
    await refresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">銷項發票</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {filtered.length} 張
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              已開立含稅 ${totals.inc.toLocaleString()}｜稅額 ${totals.tax.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              title="把光貿平台上開立的發票撈回系統（近 60 天）"
              disabled={syncing}
              onClick={() => void syncFromAmego()}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "同步中…" : "從光貿同步"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => setMediaExportOpen(true)}
              disabled={invoices.length === 0}
            >
              <FileDown className="mr-1 h-3.5 w-3.5" />
              匯出報稅媒體檔
            </Button>
            <Button type="button" className="h-8 px-3 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              開立發票
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜尋發票號碼／買方／訂單號"
              className="h-8 w-60 rounded-lg border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="搜尋銷項發票"
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
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依狀態篩選"
          >
            <option value="all">全部狀態</option>
            <option value="draft">草稿</option>
            <option value="issued">已開立</option>
            <option value="voided">已作廢</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依類型篩選"
          >
            <option value="all">B2B＋B2C</option>
            <option value="B2B">B2B</option>
            <option value="B2C">B2C</option>
          </select>
        </div>

        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">載入中…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {invoices.length === 0
              ? "尚未開立任何發票；可從訂單列表按「開立發票」，或按右上角按鈕手動開立。"
              : "沒有符合篩選條件的發票。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">發票日期</th>
                  <th className="px-2 py-2 font-medium">發票號碼</th>
                  <th className="px-2 py-2 font-medium">買方</th>
                  <th className="px-2 py-2 font-medium">類型</th>
                  <th className="px-2 py-2 text-right font-medium">未稅</th>
                  <th className="px-2 py-2 text-right font-medium">稅額</th>
                  <th className="px-2 py-2 text-right font-medium">含稅金額</th>
                  <th className="px-2 py-2 font-medium">狀態</th>
                  <th className="px-2 py-2 font-medium">光賀</th>
                  <th className="px-2 py-2 font-medium">來源訂單</th>
                  <th className="px-4 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const allowances = r.sales_allowances ?? [];
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-foreground">{r.invoice_date ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-medium tabular-nums text-foreground">
                        {r.invoice_number ?? <span className="text-muted-foreground">（草稿未取號）</span>}
                        {allowances.length > 0 && (
                          <span
                            className="ml-1 rounded border border-amber-500/50 px-1 py-px text-xs font-medium text-amber-700 dark:text-amber-500"
                            title={allowances
                              .map((a) => `折讓 ${a.allowance_number ?? "（無單號）"}｜${a.allowance_date ?? ""}｜含稅 $${(a.amount_inc_tax ?? 0).toLocaleString()}`)
                              .join("\n")}
                          >
                            折讓×{allowances.length}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        {r.buyer_name ?? "—"}
                        {r.buyer_tax_id && (
                          <span className="ml-1 text-xs text-muted-foreground tabular-nums">({r.buyer_tax_id})</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{r.invoice_type}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.amount_ex_tax != null ? `$${r.amount_ex_tax.toLocaleString()}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.tax_amount != null ? `$${r.tax_amount.toLocaleString()}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums text-foreground">
                        {r.amount_inc_tax != null ? `$${r.amount_inc_tax.toLocaleString()}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span
                          className={`whitespace-nowrap rounded border px-1.5 py-px text-xs font-medium ${STATUS_BADGE_CLS[r.status] ?? ""}`}
                          title={r.status === "voided" ? `${r.void_date ?? ""} ${r.void_reason ?? ""}`.trim() : undefined}
                        >
                          {SALES_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span
                          className="whitespace-nowrap rounded border border-border px-1.5 py-px text-xs text-muted-foreground"
                          title={r.sync_error ?? undefined}
                        >
                          {SYNC_STATUS_LABELS[r.sync_status] ?? r.sync_status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {(() => {
                          const links = (r.sales_invoice_orders ?? [])
                            .map((l) => l.orders)
                            .filter((o): o is NonNullable<typeof o> => o != null);
                          const shown = links.length > 0 ? links : r.orders ? [r.orders] : [];
                          if (shown.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
                          return (
                            <span className="inline-flex flex-wrap gap-1">
                              {shown.map((o) => (
                                <button
                                  key={o.id}
                                  type="button"
                                  title="檢視訂單內容"
                                  className="whitespace-nowrap rounded border border-border px-1.5 py-px text-xs tabular-nums text-muted-foreground hover:border-primary hover:text-foreground"
                                  onClick={() => setPeekOrder({ id: o.id, order_number: o.order_number })}
                                >
                                  {o.order_number.replace(/^ORD-/i, "")}
                                </button>
                              ))}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-center justify-end gap-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="檢視"
                            aria-label={`檢視發票 ${r.invoice_number ?? ""}`}
                            onClick={() => setViewRow(r)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="編輯"
                            aria-label={`編輯發票 ${r.invoice_number ?? ""}`}
                            onClick={() => setEditRow(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {r.status === "issued" && isAmegoSynced(r) && r.invoice_number && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="下載發票 PDF（光賀）"
                              aria-label={`下載發票 ${r.invoice_number} PDF`}
                              disabled={downloadingId === r.id}
                              onClick={() => void openInvoicePdf(r)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                          {r.status === "issued" && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="作廢（限當期；跨期請開折讓）"
                                aria-label={`作廢發票 ${r.invoice_number ?? ""}`}
                                onClick={() => setVoidTarget(r)}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="開立折讓單"
                                aria-label={`為發票 ${r.invoice_number ?? ""} 開立折讓單`}
                                onClick={() => setAllowanceTarget(r)}
                              >
                                <FileMinus className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {r.status !== "issued" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="刪除"
                              aria-label={`刪除發票 ${r.invoice_number ?? ""}`}
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExportSalesTaxMediaDialog
        invoices={invoices}
        open={mediaExportOpen}
        onOpenChange={setMediaExportOpen}
        onExported={() => void refresh()}
      />

      <SalesInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => void refresh()}
      />

      <SalesInvoiceDialog
        invoice={viewRow}
        readOnly
        open={viewRow != null}
        onOpenChange={(o) => {
          if (!o) setViewRow(null);
        }}
        onSaved={() => void refresh()}
      />

      <SalesInvoiceDialog
        invoice={editRow}
        open={editRow != null}
        onOpenChange={(o) => {
          if (!o) setEditRow(null);
        }}
        onSaved={() => void refresh()}
      />

      <VoidInvoiceDialog
        invoice={voidTarget}
        open={voidTarget != null}
        onOpenChange={(o) => {
          if (!o) setVoidTarget(null);
        }}
        onSaved={() => void refresh()}
      />

      <AllowanceDialog
        invoice={allowanceTarget}
        open={allowanceTarget != null}
        onOpenChange={(o) => {
          if (!o) setAllowanceTarget(null);
        }}
        onSaved={() => void refresh()}
      />

      <OrderPeekDialog
        orderId={peekOrder?.id ?? null}
        orderNumber={peekOrder?.order_number}
        open={peekOrder != null}
        onOpenChange={(open) => {
          if (!open) setPeekOrder(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="是否刪除此張發票？"
        description={
          deleteTarget ? (
            <>
              <p className="font-medium text-foreground">
                {deleteTarget.invoice_number ?? "（草稿未取號）"}｜{deleteTarget.buyer_name ?? "（無買方）"}｜含稅 $
                {(deleteTarget.amount_inc_tax ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-muted-foreground">
                僅草稿或作廢的發票可刪除；已開立的發票請先作廢。
              </p>
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

/** 作廢發票：填作廢日期與原因（限當期作廢；跨期應改開折讓單） */
function VoidInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
}: {
  invoice: SalesInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [voidDate, setVoidDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVoidDate(new Date().toISOString().slice(0, 10));
    setReason("");
    setSaving(false);
  }, [open]);

  async function onVoid() {
    if (!invoice) return;
    if (!reason.trim()) {
      toast.error("請輸入作廢原因");
      return;
    }
    setSaving(true);
    if (isAmegoSynced(invoice)) {
      // 光賀開立的發票：由伺服器端呼叫光賀作廢並回寫
      const res = await amegoVoidInvoice(invoice.id, voidDate, reason.trim());
      setSaving(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `發票 ${invoice.invoice_number ?? ""} 已於光賀作廢${res.environment === "test" ? "（測試環境）" : ""}`,
      );
      onOpenChange(false);
      onSaved();
      return;
    }
    const { error } = await supabase
      .from("sales_invoices")
      .update({ status: "voided", void_date: voidDate || null, void_reason: reason.trim() })
      .eq("id", invoice.id);
    setSaving(false);
    if (error) {
      toast.error(error.message || "作廢失敗");
      return;
    }
    toast.success(`發票 ${invoice.invoice_number ?? ""} 已作廢`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          aria-describedby="void-invoice-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              作廢發票 {invoice?.invoice_number ?? ""}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <p id="void-invoice-desc" className="mt-1 text-sm text-muted-foreground">
            作廢限發票當期（同一申報期）；跨期請改開折讓單。
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="void-date">作廢日期</label>
              <input
                id="void-date"
                type="date"
                value={voidDate}
                onChange={(e) => setVoidDate(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="void-reason">作廢原因（必填）</label>
              <input
                id="void-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：品項有誤重開"
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" className="h-8 px-3 text-sm">取消</Button>
            </Dialog.Close>
            <Button
              type="button"
              className="h-8 bg-destructive px-3 text-sm text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
              onClick={() => void onVoid()}
            >
              {saving ? "作廢中…" : "確定作廢"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 開立折讓單：輸入折讓含稅金額，依發票課稅別自動回推未稅與稅額 */
function AllowanceDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
}: {
  invoice: SalesInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [allowanceNumber, setAllowanceNumber] = useState("");
  const [allowanceDate, setAllowanceDate] = useState("");
  const [amountIncTax, setAmountIncTax] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAllowanceNumber("");
    setAllowanceDate(new Date().toISOString().slice(0, 10));
    setAmountIncTax("");
    setReason("");
    setSaving(false);
  }, [open]);

  async function onSave() {
    if (!invoice) return;
    const inc = Number(amountIncTax);
    if (Number.isNaN(inc) || inc <= 0) {
      toast.error("請輸入折讓含稅金額");
      return;
    }
    if (invoice.amount_inc_tax != null && inc > invoice.amount_inc_tax) {
      toast.error("折讓金額不可大於發票含稅金額");
      return;
    }
    setSaving(true);
    if (isAmegoSynced(invoice)) {
      // 光賀開立的發票：由伺服器端呼叫光賀開折讓（單號自動編）並寫入折讓單
      const res = await amegoCreateAllowance(invoice.id, inc, allowanceDate, reason.trim());
      setSaving(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `已於光賀開立折讓 ${res.allowance_number}（$${inc.toLocaleString()}）${res.environment === "test" ? "（測試環境）" : ""}`,
      );
      onOpenChange(false);
      onSaved();
      return;
    }
    // 應稅以 5% 內含回推；零稅率／免稅稅額為 0
    const ex = invoice.tax_type === 1 ? Math.round(inc / 1.05) : inc;
    const tax = Math.round((inc - ex) * 100) / 100;
    const { error } = await supabase.from("sales_allowances").insert({
      invoice_id: invoice.id,
      allowance_number: allowanceNumber.trim() ? normalizeInvoiceNumber(allowanceNumber) : null,
      allowance_date: allowanceDate || null,
      amount_ex_tax: ex,
      tax_amount: tax,
      amount_inc_tax: inc,
      reason: reason.trim() || null,
      status: "issued",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || "折讓單建立失敗");
      return;
    }
    toast.success(`已為發票 ${invoice.invoice_number ?? ""} 開立折讓 $${inc.toLocaleString()}`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          aria-describedby="allowance-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              開立折讓單：{invoice?.invoice_number ?? ""}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <p id="allowance-desc" className="mt-1 text-sm text-muted-foreground">
            發票含稅 ${(invoice?.amount_inc_tax ?? 0).toLocaleString()}；折讓金額依課稅別自動回推未稅與稅額。
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="al-number">
                {invoice != null && isAmegoSynced(invoice) ? "折讓單號（光賀自動編）" : "折讓單號（選填）"}
              </label>
              <input
                id="al-number"
                type="text"
                value={allowanceNumber}
                onChange={(e) => setAllowanceNumber(e.target.value)}
                disabled={invoice != null && isAmegoSynced(invoice)}
                placeholder={invoice != null && isAmegoSynced(invoice) ? "自動產生" : undefined}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="al-date">折讓日期</label>
              <input
                id="al-date"
                type="date"
                value={allowanceDate}
                onChange={(e) => setAllowanceDate(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="al-amount">折讓含稅金額</label>
              <input
                id="al-amount"
                type="number"
                value={amountIncTax}
                onChange={(e) => setAmountIncTax(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="al-reason">原因</label>
              <input
                id="al-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：瑕疵折讓"
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" className="h-8 px-3 text-sm">取消</Button>
            </Dialog.Close>
            <Button type="button" className="h-8 px-3 text-sm" disabled={saving} onClick={() => void onSave()}>
              {saving ? "建立中…" : "開立折讓"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
