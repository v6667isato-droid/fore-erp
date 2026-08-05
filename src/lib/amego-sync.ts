import type { SupabaseClient } from "@supabase/supabase-js";
import { callAmego, getAmegoCredentials, timestampToTaipeiDate, type AmegoCredentials } from "@/lib/amego";

/**
 * 光賀 → ERP 發票同步核心（伺服器端專用）。
 * 由 /api/amego（手動按鈕）與 /api/cron/amego-sync（排程）共用。
 */

interface AmegoListRow {
  invoice_number: string;
  invoice_type: string;
  invoice_date: number | string;
  invoice_time?: string;
  buyer_identifier: string;
  buyer_name: string;
  buyer_email_address?: string;
  sales_amount: number;
  free_tax_sales_amount: number;
  zero_tax_sales_amount: number;
  tax_type: number;
  tax_amount: number;
  total_amount: number;
  print_mark?: string;
  main_remark?: string;
  carrier_type?: string;
  carrier_id1?: string;
  npoban?: string;
  cancel_date: number;
  order_id?: string;
}

export interface AmegoSyncResult {
  checked: number;
  imported: number;
  voided_updated: number;
  conflicts: string[];
  errors: string[];
  environment: AmegoCredentials["environment"];
}

/** YYYYMMDD（數字或字串）→ YYYY-MM-DD */
function ymdToDate(v: number | string): string | null {
  const s = String(v ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** 光賀發票類型是否為作廢／註銷 */
function isVoidedType(row: AmegoListRow): boolean {
  return /0501|0701/.test(row.invoice_type) || (row.cancel_date ?? 0) > 0;
}

/**
 * 把光賀端的發票同步回 ERP：
 * 號碼已存在→只補作廢狀態；不存在→建檔（含 invoice_query 抓明細）。
 * ERP 已作廢但光賀仍開立者列為衝突回報，不自動改。
 * 光賀列表 API 失敗時 throw Error（訊息可直接顯示）。
 */
export async function runAmegoSync(db: SupabaseClient, daysInput: number): Promise<AmegoSyncResult> {
  const creds = getAmegoCredentials();
  const days = Math.min(Math.max(Math.round(daysInput || 60), 1), 180);
  const now = Date.now() / 1000;
  const dateEnd = Number(timestampToTaipeiDate(now).replaceAll("-", ""));
  const dateStart = Number(timestampToTaipeiDate(now - days * 86400).replaceAll("-", ""));

  // 分頁撈回光賀端列表（每頁 500，安全上限 20 頁）
  const amegoRows: AmegoListRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await callAmego(
      "/json/invoice_list",
      { date_select: 1, date_start: dateStart, date_end: dateEnd, limit: 500, page },
      creds,
    );
    if (res.code !== 0) throw new Error(`光賀回應錯誤（代碼 ${res.code}）：${res.msg || "無錯誤訊息"}`);
    amegoRows.push(...((res.data as AmegoListRow[] | undefined) ?? []));
    if (page >= Number(res.page_total ?? 1)) break;
  }

  // 現有發票對照表（含已刪除者，避免測試資料復活）
  const numbers = [...new Set(amegoRows.map((r) => r.invoice_number).filter(Boolean))];
  const existing = new Map<string, { id: string; status: string; deleted_at: string | null }>();
  for (let i = 0; i < numbers.length; i += 400) {
    const { data } = await db
      .from("sales_invoices")
      .select("id, invoice_number, status, deleted_at")
      .in("invoice_number", numbers.slice(i, i + 400));
    for (const r of (data ?? []) as { id: string; invoice_number: string; status: string; deleted_at: string | null }[]) {
      existing.set(r.invoice_number, r);
    }
  }

  let imported = 0;
  let voidedUpdated = 0;
  const conflicts: string[] = [];
  const errors: string[] = [];

  for (const row of amegoRows) {
    const n = row.invoice_number;
    if (!n) continue;
    const voided = isVoidedType(row);
    const ex = existing.get(n);

    if (ex) {
      if (ex.deleted_at) continue;
      if (voided && ex.status === "issued") {
        const { error } = await db
          .from("sales_invoices")
          .update({
            status: "voided",
            void_date: row.cancel_date > 0 ? timestampToTaipeiDate(row.cancel_date) : null,
            void_reason: "光貿端作廢（同步）",
            sync_status: "confirmed",
            synced_at: new Date().toISOString(),
          })
          .eq("id", ex.id);
        if (error) errors.push(`${n} 補作廢失敗：${error.message}`);
        else voidedUpdated++;
      } else if (!voided && ex.status === "voided") {
        conflicts.push(n);
      }
      continue;
    }

    // 新發票：建主檔（金額換算與 calcInvoiceTotals 慣例一致）
    const isB2B = row.buyer_identifier !== "0000000000";
    const inc = Math.round(Number(row.total_amount) * 100) / 100;
    let exTax = inc;
    let tax = 0;
    if (row.tax_type === 1) {
      if (isB2B) {
        exTax = Math.round(Number(row.sales_amount) * 100) / 100;
        tax = Math.round(Number(row.tax_amount) * 100) / 100;
      } else {
        exTax = Math.round(inc / 1.05);
        tax = Math.round((inc - exTax) * 100) / 100;
      }
    }

    const { data: ins, error: insErr } = await db
      .from("sales_invoices")
      .insert({
        invoice_type: isB2B ? "B2B" : "B2C",
        invoice_number: n,
        invoice_date: ymdToDate(row.invoice_date),
        buyer_name: row.buyer_name?.trim() || null,
        buyer_tax_id: isB2B ? row.buyer_identifier : null,
        buyer_email: row.buyer_email_address?.trim() || null,
        carrier_type: !isB2B && row.carrier_type ? row.carrier_type : null,
        carrier_id: !isB2B && row.carrier_type ? row.carrier_id1 || null : null,
        donation_code: !isB2B ? row.npoban || null : null,
        print_flag: row.print_mark === "Y",
        tax_type: row.tax_type,
        amount_ex_tax: exTax,
        tax_amount: tax,
        amount_inc_tax: inc,
        status: voided ? "voided" : "issued",
        issued_at: null,
        void_date: voided && row.cancel_date > 0 ? timestampToTaipeiDate(row.cancel_date) : null,
        void_reason: voided ? "光貿端作廢（同步）" : null,
        sync_status: "confirmed",
        synced_at: new Date().toISOString(),
        external_id: row.order_id || null,
        notes: row.main_remark?.trim() || null,
      })
      .select("id")
      .single();
    if (insErr) {
      errors.push(`${n} 建檔失敗：${insErr.message}`);
      continue;
    }
    imported++;

    // 補品項明細（invoice_query 限 180 天內；失敗不影響主檔）
    try {
      const q = await callAmego("/json/invoice_query", { type: "invoice", invoice_number: n }, creds);
      const items = (q.data as { product_item?: { description: string; quantity: number; unit: string; unit_price: number; amount: number }[] } | undefined)
        ?.product_item;
      if (q.code === 0 && items && items.length > 0) {
        await db.from("sales_invoice_items").insert(
          items.map((it, i) => ({
            invoice_id: (ins as { id: string }).id,
            description: it.description ?? "",
            quantity: it.quantity ?? 1,
            unit: it.unit || null,
            unit_price: it.unit_price ?? null,
            amount: it.amount ?? 0,
            sort_order: i,
          })),
        );
      }
    } catch (e) {
      console.error("[amego] sync 明細補抓失敗:", n, e);
    }
  }

  return {
    checked: amegoRows.length,
    imported,
    voided_updated: voidedUpdated,
    conflicts,
    errors,
    environment: creds.environment,
  };
}
