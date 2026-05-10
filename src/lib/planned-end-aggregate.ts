/**
 * 訂單層級「預計完成日」：取該訂單底下所有工單 planned_end_date 中最晚一日（YYYY-MM-DD 字串可比較大小）。
 */

export function maxPlannedEndDate(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const raw of values) {
    const d = raw != null && String(raw).trim() ? String(raw).slice(0, 10) : null;
    if (!d) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

/** Supabase：work_orders 巢狀 order_items(order_id) 查詢結果列 */
export type WorkOrderPlannedWithOrderId = {
  planned_end_date: string | null;
  order_items: { order_id: string } | { order_id: string }[] | null;
};

/**
 * 將 work_orders 列彙總為每張訂單「最晚」planned_end_date。
 */
export function plannedEndLatestByOrderIdFromWorkOrderRows(
  rows: WorkOrderPlannedWithOrderId[]
): Map<string, string | null> {
  const byOrder = new Map<string, string | null>();

  for (const r of rows) {
    const oi = r.order_items;
    let oid: string | null = null;
    if (oi == null) oid = null;
    else if (Array.isArray(oi)) oid = oi[0]?.order_id != null ? String(oi[0].order_id) : null;
    else oid = oi.order_id != null ? String(oi.order_id) : null;
    if (!oid) continue;

    const raw = r.planned_end_date;
    const d = raw != null && String(raw).trim() ? String(raw).slice(0, 10) : null;
    const prev = byOrder.get(oid) ?? null;
    if (!d) {
      if (!byOrder.has(oid)) byOrder.set(oid, null);
      continue;
    }
    if (!prev || d > prev) byOrder.set(oid, d);
  }
  return byOrder;
}
