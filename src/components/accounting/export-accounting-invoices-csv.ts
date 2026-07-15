import type { AccountingInvoiceRow } from "@/lib/accounting-invoice";
import { displayPoNumber } from "@/lib/purchase-order";

export function exportAccountingInvoicesCsv(records: AccountingInvoiceRow[]) {
  const headers = [
    "發票日期",
    "發票號碼",
    "賣方",
    "賣方統編",
    "買方統編",
    "未稅金額",
    "稅額",
    "含稅金額",
    "格式代號",
    "課稅別",
    "扣抵代號",
    "媒體檔匯出日",
    "對應採購單號",
    "採購單日期",
    "採購單廠商",
    "備註",
  ];
  const rows = records.map((r) => [
    r.invoice_date ?? "",
    r.invoice_number ?? "",
    r.seller_name ?? "",
    r.seller_tax_id ?? "",
    r.buyer_tax_id ?? "",
    r.amount_ex_tax != null ? String(r.amount_ex_tax) : "",
    r.tax_amount != null ? String(r.tax_amount) : "",
    r.amount_inc_tax != null ? String(r.amount_inc_tax) : "",
    r.format_code,
    String(r.tax_type),
    String(r.deduction_code),
    r.exported_at ? r.exported_at.slice(0, 10) : "",
    r.purchase_orders ? displayPoNumber(r.purchase_orders.po_number) : "",
    r.purchase_orders?.purchase_date ?? "",
    r.purchase_orders?.vendor_name ?? "",
    r.notes ?? "",
  ]);
  const csv = [headers.join(","), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `會計發票_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
