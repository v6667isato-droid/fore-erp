import { formatAmortizationLabel } from "@/lib/purchase-amortization";
import type { PurchaseRow } from "@/types/procurement";

export function exportProcurementCsv(records: PurchaseRow[]) {
  const headers = [
    "採購單號",
    "日期",
    "廠商",
    "物料主檔ID",
    "品名",
    "類別",
    "規格（合併）",
    "規格",
    "規格2",
    "數量",
    "單位",
    "輸入單價",
    "輸入為已稅",
    "已稅單價",
    "含稅總價",
    "成本攤提",
  ];
  const rows = records.map((r) => [
    r.po_number ?? "",
    r.purchase_date,
    r.vendor_notes?.trim() ? `${r.vendor_name}（${r.vendor_notes.trim()}）` : r.vendor_name,
    r.material_id ?? "",
    r.item_name,
    r.item_category,
    r.spec,
    r.spec_primary,
    r.spec_secondary,
    String(r.quantity),
    r.unit,
    String(r.unit_price),
    r.unit_price_is_tax_inclusive ? "是" : "否",
    String(r.unit_price_inc_tax),
    String(r.tax_included_amount),
    formatAmortizationLabel(r.amortization_months),
  ]);
  const csv = [headers.join(","), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `採購明細_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
