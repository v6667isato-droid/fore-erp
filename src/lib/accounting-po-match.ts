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
  /** 賣方名稱相符（相似度 ≥ 0.8：同名或包含關係） */
  vendorMatch: boolean;
  /** 採購日期 − 發票日期（天；負值＝採購在發票之前）；任一日期缺漏為 null */
  dateDiffDays: number | null;
  /** 採購單金額 − 發票金額（以較接近的含稅或未稅配對計）；無可比金額為 null */
  amountDiff: number | null;
}

/** 賣方名稱視為「相符」的相似度門檻（textSimilarity 同名=1、包含關係≥0.8） */
const VENDOR_MATCH_THRESHOLD = 0.8;

/** 金額接近度：完全一致（±1 元）滿分；非一致最高 0.4，差 25% 以上視為不相關 */
function amountCloseness(a: number | null, b: number): number {
  if (a == null || a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) <= 1) return 1;
  const rel = Math.abs(a - b) / Math.max(a, b);
  return Math.max(0, 0.4 * (1 - rel * 4));
}

/** 日期接近度：同日滿分，±3 天內線性遞減至 0 */
function dateCloseness(invoiceDate: string, purchaseDate: string): number {
  const days = dateDiff(invoiceDate, purchaseDate);
  if (days == null) return 0;
  return Math.max(0, 1 - Math.abs(days) / 3);
}

/** 採購日期 − 發票日期（天）；日期無法解析為 null */
function dateDiff(invoiceDate: string, purchaseDate: string): number | null {
  const a = Date.parse(invoiceDate);
  const b = Date.parse(purchaseDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * 發票→採購單自動對應建議（加權評分）：
 * 金額 50%（完全一致滿分、非一致最高 0.4×50%）＋日期 30%（±3 天線性遞減）＋賣方名稱 20%
 */
export function suggestPos(input: PoMatchInput, pos: PoOption[], limit = 5): PoSuggestion[] {
  const out: PoSuggestion[] = [];
  for (const po of pos) {
    const vendorScore = input.sellerName && po.vendor_name ? textSimilarity(input.sellerName, po.vendor_name) : 0;
    const incDiff =
      input.amountIncTax != null && input.amountIncTax > 0 && po.total_inc_tax > 0
        ? po.total_inc_tax - input.amountIncTax
        : null;
    const exDiff =
      input.amountExTax != null && input.amountExTax > 0 && po.total_ex_tax > 0
        ? po.total_ex_tax - input.amountExTax
        : null;
    const amountScore = Math.max(
      amountCloseness(input.amountIncTax, po.total_inc_tax),
      amountCloseness(input.amountExTax, po.total_ex_tax),
    );
    const amountExact = (incDiff != null && Math.abs(incDiff) <= 1) || (exDiff != null && Math.abs(exDiff) <= 1);
    const dateScore = input.invoiceDate ? dateCloseness(input.invoiceDate, po.purchase_date) : 0;
    const score = amountScore * 0.5 + dateScore * 0.3 + vendorScore * 0.2;
    // 至少要金額幾乎一致或賣方名稱有相似度，避免只靠日期亂配
    if (!amountExact && vendorScore < 0.3) continue;
    if (score < 0.2) continue;
    // 顯示用金額差：取較接近的配對（含稅對含稅優先）
    let amountDiff: number | null = null;
    if (incDiff != null && exDiff != null) amountDiff = Math.abs(incDiff) <= Math.abs(exDiff) ? incDiff : exDiff;
    else amountDiff = incDiff ?? exDiff;
    out.push({
      po,
      score,
      amountExact,
      vendorMatch: vendorScore >= VENDOR_MATCH_THRESHOLD,
      dateDiffDays: input.invoiceDate ? dateDiff(input.invoiceDate, po.purchase_date) : null,
      amountDiff,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
