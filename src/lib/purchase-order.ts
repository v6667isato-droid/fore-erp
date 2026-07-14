import type { InvoiceFile, PurchaseRow } from "@/types/procurement";

/** 採購單編號（比照訂單 ORD- 格式）；轉檔舊資料為 3 碼流水，新單為 4 碼時間戳尾碼 */
export function generatePoNumber(): string {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `PO-${ymd}-${suffix}`;
}

/** 顯示用：去掉 PO- 前綴 */
export function displayPoNumber(poNumber: string | null | undefined): string {
  if (!poNumber) return "—";
  return poNumber.replace(/^PO-/i, "");
}

export function parseInvoiceFiles(raw: unknown): InvoiceFile[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceFile[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.url !== "string" || !o.url) continue;
    out.push({
      url: o.url,
      path: typeof o.path === "string" ? o.path : "",
      name: typeof o.name === "string" ? o.name : "請款單",
      uploaded_at: typeof o.uploaded_at === "string" ? o.uploaded_at : "",
    });
  }
  return out;
}

/** 採購單（單頭＋品項明細）；由 purchases 明細列依 purchase_order_id 聚合 */
export interface PurchaseOrderGroup {
  /** 分組 key：purchase_order_id；未遷移舊列則以明細 id 各自成組 */
  key: string;
  purchase_order_id: string | null;
  po_number: string | null;
  po_notes: string | null;
  invoice_files: InvoiceFile[];
  purchase_date: string;
  vendor_name: string;
  vendor_notes: string | null;
  lines: PurchaseRow[];
  total_inc_tax: number;
  total_ex_tax: number;
}

export function groupPurchaseRows(rows: PurchaseRow[]): PurchaseOrderGroup[] {
  const map = new Map<string, PurchaseOrderGroup>();
  for (const row of rows) {
    const key = row.purchase_order_id ?? `line-${row.id}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        purchase_order_id: row.purchase_order_id ?? null,
        po_number: row.po_number ?? null,
        po_notes: row.po_notes ?? null,
        invoice_files: row.po_invoice_files ?? [],
        purchase_date: row.purchase_date,
        vendor_name: row.vendor_name,
        vendor_notes: row.vendor_notes ?? null,
        lines: [],
        total_inc_tax: 0,
        total_ex_tax: 0,
      };
      map.set(key, group);
    }
    group.lines.push(row);
    group.total_inc_tax += row.tax_included_amount;
    group.total_ex_tax += row.amount_ex_tax;
    // 單頭顯示日期取明細中最新者（同單原則上相同）
    if (row.purchase_date > group.purchase_date) group.purchase_date = row.purchase_date;
    if (group.vendor_name === "—" && row.vendor_name !== "—") {
      group.vendor_name = row.vendor_name;
      group.vendor_notes = row.vendor_notes ?? null;
    }
  }
  return [...map.values()];
}
