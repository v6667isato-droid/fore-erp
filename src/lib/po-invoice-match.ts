import { supabase } from "@/lib/supabase";
import { invoiceOwnerCategory } from "@/lib/accounting-invoice";

/**
 * 採購單→發票對應狀態（與發票清單的「對應採購單」欄同一套三態，方向相反）：
 * matched=已有發票對應此採購單／candidate=有日期金額相符的未對應發票／none=無對應
 */
export type PoInvoiceMatchState = "matched" | "candidate" | "none";

export const PO_INVOICE_MATCH_LABELS: Record<PoInvoiceMatchState, string> = {
  matched: "已對應",
  candidate: "有相符",
  none: "無對應",
};

export interface PoInvoiceMatch {
  state: PoInvoiceMatchState;
  /** tooltip 用的發票摘要 */
  detail: string;
}

/** 「有相符」的日期容許差（天）：金額相符且發票日期在此範圍內才算找到（與發票清單同值） */
export const PO_INVOICE_CANDIDATE_MAX_DAYS = 7;

/** 對應判斷所需的已存檔發票欄位 */
export interface InvoiceForPoMatch {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  amount_inc_tax: number | null;
  amount_ex_tax: number | null;
  buyer_tax_id: string | null;
  purchase_order_id: string | null;
}

/** 已審核存檔發票（僅對應判斷所需欄位） */
export async function fetchInvoicesForPoMatch(): Promise<InvoiceForPoMatch[]> {
  const { data, error } = await supabase
    .from("accounting_invoices")
    .select("id, invoice_number, invoice_date, seller_name, amount_inc_tax, amount_ex_tax, buyer_tax_id, purchase_order_id")
    .is("deleted_at", null)
    .eq("status", "confirmed");
  if (error) {
    console.error("發票對應狀態讀取失敗:", error.message);
    return [];
  }
  return (data ?? []) as unknown as InvoiceForPoMatch[];
}

function amountExact(a: number | null, b: number): boolean {
  return a != null && a > 0 && b > 0 && Math.abs(a - b) <= 1;
}

function dateDiffDays(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/** 供判斷的採購單摘要（PurchaseOrderGroup 的子集） */
export interface PoForInvoiceMatch {
  key: string;
  purchase_order_id: string | null;
  purchase_date: string;
  total_inc_tax: number;
  total_ex_tax: number;
}

/**
 * 每張採購單的發票對應狀態（key=group.key）。
 * candidate 條件與發票清單一致：金額幾乎一致（±1 元，含稅或未稅任一配對）＋日期 ±7 天內；
 * 只考慮未對應到任何採購單的公司發票（家庭發票不參與），且一張發票只提示給一張採購單。
 */
export function computePoInvoiceMatches(
  groups: PoForInvoiceMatch[],
  invoices: InvoiceForPoMatch[],
): Map<string, PoInvoiceMatch> {
  const map = new Map<string, PoInvoiceMatch>();
  const linkedByPo = new Map<string, InvoiceForPoMatch>();
  for (const inv of invoices) {
    if (inv.purchase_order_id && !linkedByPo.has(inv.purchase_order_id)) linkedByPo.set(inv.purchase_order_id, inv);
  }
  const freeInvoices = invoices.filter(
    (inv) => !inv.purchase_order_id && invoiceOwnerCategory(inv.buyer_tax_id) === "company",
  );
  const suggestedInvoiceIds = new Set<string>();

  // 依採購日期新→舊處理，讓相符發票優先提示給日期較近的採購單
  const ordered = [...groups].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  for (const group of ordered) {
    if (group.purchase_order_id) {
      const linked = linkedByPo.get(group.purchase_order_id);
      if (linked) {
        map.set(group.key, {
          state: "matched",
          detail: `已對應發票 ${linked.invoice_number ?? "（無號碼）"}（${linked.invoice_date ?? "—"}${
            linked.seller_name ? `／${linked.seller_name}` : ""
          }）`,
        });
        continue;
      }
    }
    const hit = freeInvoices.find((inv) => {
      if (suggestedInvoiceIds.has(inv.id)) return false;
      if (!inv.invoice_date) return false;
      const diff = dateDiffDays(inv.invoice_date, group.purchase_date);
      if (diff == null || Math.abs(diff) > PO_INVOICE_CANDIDATE_MAX_DAYS) return false;
      return amountExact(inv.amount_inc_tax, group.total_inc_tax) || amountExact(inv.amount_ex_tax, group.total_ex_tax);
    });
    if (hit) {
      suggestedInvoiceIds.add(hit.id);
      map.set(group.key, {
        state: "candidate",
        detail: `找到日期與金額相符的發票 ${hit.invoice_number ?? "（無號碼）"}（${hit.invoice_date ?? "—"}${
          hit.seller_name ? `／${hit.seller_name}` : ""
        }，含稅 $${(hit.amount_inc_tax ?? 0).toLocaleString()}）；到會計管理編輯該發票即可對應`,
      });
    } else {
      map.set(group.key, { state: "none", detail: "尚無發票對應此採購單" });
    }
  }
  return map;
}
