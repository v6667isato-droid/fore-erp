import { supabase } from "@/lib/supabase";
import { textSimilarity } from "@/lib/invoice-match";

/** 供發票對應選擇的採購單選項（單頭＋明細金額彙總） */
export interface PoOption {
  id: string;
  po_number: string;
  purchase_date: string;
  vendor_name: string | null;
  total_inc_tax: number;
  total_ex_tax: number;
}

interface PoQueryRow {
  id: string;
  po_number: string;
  purchase_date: string;
  vendor_name: string | null;
  purchases: { tax_included_amount: number | null; amount_ex_tax: number | null; deleted_at: string | null }[];
}

/** 全部採購單（含明細含稅／未稅彙總），日期新→舊 */
export async function fetchPoOptions(): Promise<PoOption[]> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, po_number, purchase_date, vendor_name, purchases (tax_included_amount, amount_ex_tax, deleted_at)")
    .is("deleted_at", null)
    .order("purchase_date", { ascending: false });
  if (error) {
    console.error("採購單清單讀取失敗:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as PoQueryRow[]).map((row) => {
    let inc = 0;
    let ex = 0;
    for (const line of row.purchases ?? []) {
      if (line.deleted_at) continue;
      inc += line.tax_included_amount ?? 0;
      ex += line.amount_ex_tax ?? 0;
    }
    return {
      id: row.id,
      po_number: row.po_number,
      purchase_date: row.purchase_date,
      vendor_name: row.vendor_name,
      total_inc_tax: Math.round(inc * 100) / 100,
      total_ex_tax: Math.round(ex * 100) / 100,
    };
  });
}

export interface PoMatchInput {
  sellerName: string;
  invoiceDate: string;
  amountIncTax: number | null;
  amountExTax: number | null;
}

export interface PoSuggestion {
  po: PoOption;
  score: number;
  /** 金額是否幾乎一致（差 1 元內），列表上特別標示 */
  amountExact: boolean;
}

function amountCloseness(a: number | null, b: number): number {
  if (a == null || a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) <= 1) return 1;
  const rel = Math.abs(a - b) / Math.max(a, b);
  return Math.max(0, 1 - rel * 4); // 差 25% 以上視為不相關
}

function dateCloseness(invoiceDate: string, purchaseDate: string): number {
  const a = Date.parse(invoiceDate);
  const b = Date.parse(purchaseDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const days = Math.abs(a - b) / 86400000;
  return Math.max(0, 1 - days / 60); // 60 天外視為不相關
}

/**
 * 發票→採購單自動對應建議：
 * 廠商名相似度 45%＋金額接近度 40%（含稅對含稅、未稅對未稅取較高者）＋日期接近度 15%
 */
export function suggestPos(input: PoMatchInput, pos: PoOption[], limit = 5): PoSuggestion[] {
  const out: PoSuggestion[] = [];
  for (const po of pos) {
    const vendorScore = input.sellerName && po.vendor_name ? textSimilarity(input.sellerName, po.vendor_name) : 0;
    const amountScore = Math.max(
      amountCloseness(input.amountIncTax, po.total_inc_tax),
      amountCloseness(input.amountExTax, po.total_ex_tax),
    );
    const dateScore = input.invoiceDate ? dateCloseness(input.invoiceDate, po.purchase_date) : 0;
    const score = vendorScore * 0.45 + amountScore * 0.4 + dateScore * 0.15;
    // 至少要有廠商或金額其中一個明確訊號，避免只靠日期亂配
    if (score < 0.3 || (vendorScore < 0.3 && amountScore < 0.6)) continue;
    out.push({
      po,
      score,
      amountExact:
        (input.amountIncTax != null && Math.abs(input.amountIncTax - po.total_inc_tax) <= 1 && po.total_inc_tax > 0) ||
        (input.amountExTax != null && Math.abs(input.amountExTax - po.total_ex_tax) <= 1 && po.total_ex_tax > 0),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
