"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FileText, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  amegoDownloadInvoicePdf,
  fetchSalesInvoicesByOrder,
  SALES_STATUS_LABELS,
  SYNC_STATUS_LABELS,
  type SalesInvoiceRow,
} from "@/lib/sales-invoice";
import {
  SalesInvoiceDialog,
  type SalesInvoiceOrderContext,
} from "@/components/accounting/sales-invoice-dialog";

/** 訂單已開立的發票列表：檢視、下載 PDF，並可續開新發票 */
export function OrderInvoicesDialog({
  order,
  open,
  onOpenChange,
  onIssueNew,
}: {
  order: SalesInvoiceOrderContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 按「開立發票」時呼叫（父層開啟開票 Dialog） */
  onIssueNew: (order: SalesInvoiceOrderContext) => void;
}) {
  const [rows, setRows] = useState<SalesInvoiceRow[] | null>(null);
  const [viewRow, setViewRow] = useState<SalesInvoiceRow | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !order) return;
    setRows(null);
    void fetchSalesInvoicesByOrder(order.id).then(setRows);
  }, [open, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadPdf(row: SalesInvoiceRow) {
    setDownloadingId(row.id);
    const res = await amegoDownloadInvoicePdf(row);
    setDownloadingId(null);
    if (!res.ok) toast.error(res.error);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
            aria-describedby="order-invoices-desc"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  訂單發票：{order?.order_number ?? ""}
                </Dialog.Title>
                <p id="order-invoices-desc" className="mt-1 text-sm text-muted-foreground">
                  此訂單開立過的發票；點列可檢視內容，光賀開立的可下載 PDF。
                </p>
              </div>
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

            {rows == null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">載入中…</p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">此訂單尚未開立發票。</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">日期</th>
                      <th className="px-2 py-2 font-medium">發票號碼</th>
                      <th className="px-2 py-2 text-right font-medium">含稅金額</th>
                      <th className="px-2 py-2 font-medium">狀態</th>
                      <th className="px-2 py-2 font-medium">光賀</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/20"
                        onClick={() => setViewRow(r)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-foreground">
                          {r.invoice_date ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium tabular-nums text-foreground">
                          {r.invoice_number ?? <span className="text-muted-foreground">（草稿）</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-foreground">
                          {r.amount_inc_tax != null ? `$${r.amount_inc_tax.toLocaleString()}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <span className="rounded border border-border px-1.5 py-px text-xs text-muted-foreground">
                            {SALES_STATUS_LABELS[r.status] ?? r.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <span className="rounded border border-border px-1.5 py-px text-xs text-muted-foreground">
                            {SYNC_STATUS_LABELS[r.sync_status] ?? r.sync_status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {(r.sync_status === "confirmed" || r.sync_status === "sent") && r.invoice_number && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="下載發票 PDF"
                              aria-label={`下載發票 ${r.invoice_number} PDF`}
                              disabled={downloadingId === r.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void downloadPdf(r);
                              }}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="h-8 px-3 text-sm">關閉</Button>
              </Dialog.Close>
              <Button
                type="button"
                className="h-8 px-3 text-sm"
                onClick={() => {
                  if (!order) return;
                  onOpenChange(false);
                  onIssueNew(order);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                開立發票
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <SalesInvoiceDialog
        invoice={viewRow}
        readOnly
        open={viewRow != null}
        onOpenChange={(o) => {
          if (!o) setViewRow(null);
        }}
        onSaved={() => {
          if (order) void fetchSalesInvoicesByOrder(order.id).then(setRows);
        }}
      />
    </>
  );
}
