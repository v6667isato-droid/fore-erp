"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Download, FileDown, FileText, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchConfirmedInvoices,
  SOURCE_LABELS,
  type AccountingInvoiceRow,
} from "@/lib/accounting-invoice";
import { displayPoNumber } from "@/lib/purchase-order";
import { AccountingInvoiceQueue } from "@/components/accounting/accounting-invoice-queue";
import { AccountingInvoiceReviewDialog } from "@/components/accounting/accounting-invoice-review-dialog";
import { exportAccountingInvoicesCsv } from "@/components/accounting/export-accounting-invoices-csv";
import { ExportTaxMediaDialog } from "@/components/accounting/export-tax-media-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type MatchFilter = "all" | "matched" | "unmatched";

export function AccountingPage() {
  const [invoices, setInvoices] = useState<AccountingInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [editRow, setEditRow] = useState<AccountingInvoiceRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccountingInvoiceRow | null>(null);
  const [mediaExportOpen, setMediaExportOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setInvoices(await fetchConfirmedInvoices());
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
      if (matchFilter === "matched" && !r.purchase_order_id) return false;
      if (matchFilter === "unmatched" && r.purchase_order_id) return false;
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
  }, [invoices, monthFilter, matchFilter, searchText]);

  const totals = useMemo(() => {
    let inc = 0;
    let tax = 0;
    for (const r of filtered) {
      inc += r.amount_inc_tax ?? 0;
      tax += r.tax_amount ?? 0;
    }
    return { inc: Math.round(inc * 100) / 100, tax: Math.round(tax * 100) / 100 };
  }, [filtered]);

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
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜尋發票號碼／賣方／採購單號"
              className="h-8 w-60 rounded-lg border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
          <select
            value={matchFilter}
            onChange={(e) => setMatchFilter(e.target.value as MatchFilter)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依採購單對應狀態篩選"
          >
            <option value="all">全部</option>
            <option value="matched">已對應採購單</option>
            <option value="unmatched">未對應採購單</option>
          </select>
        </div>

        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">載入中…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {invoices.length === 0 ? "尚無已存檔的發票；從上方佇列上傳並審核後會列在這裡。" : "沒有符合篩選條件的發票。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">發票日期</th>
                  <th className="px-2 py-2 font-medium">發票號碼</th>
                  <th className="px-2 py-2 font-medium">賣方</th>
                  <th className="px-2 py-2 text-right font-medium">未稅</th>
                  <th className="px-2 py-2 text-right font-medium">稅額</th>
                  <th className="px-2 py-2 text-right font-medium">含稅金額</th>
                  <th className="px-2 py-2 font-medium">格式</th>
                  <th className="px-2 py-2 font-medium">申報</th>
                  <th className="px-2 py-2 font-medium">來源</th>
                  <th className="px-2 py-2 font-medium">對應採購單</th>
                  <th className="px-2 py-2 font-medium">原稿</th>
                  <th className="px-4 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 tabular-nums text-foreground">{r.invoice_date ?? "—"}</td>
                    <td className="px-2 py-2 font-medium tabular-nums text-foreground">{r.invoice_number ?? "—"}</td>
                    <td className="px-2 py-2 text-foreground">
                      {r.seller_name ?? "—"}
                      {r.seller_tax_id && (
                        <span className="ml-1 text-xs text-muted-foreground tabular-nums">({r.seller_tax_id})</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {r.amount_ex_tax != null ? `$${r.amount_ex_tax.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {r.tax_amount != null ? `$${r.tax_amount.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums text-foreground">
                      {r.amount_inc_tax != null ? `$${r.amount_inc_tax.toLocaleString()}` : "—"}
                    </td>
                    <td
                      className="px-2 py-2 tabular-nums text-muted-foreground"
                      title={`格式代號 ${r.format_code}／課稅別 ${r.tax_type}／扣抵 ${r.deduction_code}`}
                    >
                      {r.format_code}
                    </td>
                    <td className="px-2 py-2">
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
                    <td className="px-2 py-2">
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
                    <td className="px-2 py-2">
                      {r.purchase_orders ? (
                        <span className="inline-flex flex-wrap items-center gap-1 text-xs">
                          <span className="rounded border border-emerald-500/50 px-1.5 py-px font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            {displayPoNumber(r.purchase_orders.po_number)}
                          </span>
                          <span className="text-muted-foreground">
                            {r.purchase_orders.vendor_name ?? ""}
                          </span>
                        </span>
                      ) : (
                        <span className="rounded border border-amber-500/50 px-1.5 py-px text-xs font-medium text-amber-700 dark:text-amber-500">
                          未對應
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <a
                        href={r.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                        title={`開啟發票原稿${r.file_name ? `（${r.file_name}）` : ""}`}
                      >
                        {(r.media_type ?? "") === "application/pdf" || r.file_path.endsWith(".pdf") ? (
                          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted/40">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element -- Supabase 縮圖
                          <img
                            src={r.file_url}
                            alt={`發票 ${r.invoice_number ?? ""} 縮圖`}
                            loading="lazy"
                            className="h-10 w-10 rounded-md border border-border object-cover"
                          />
                        )}
                      </a>
                    </td>
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
