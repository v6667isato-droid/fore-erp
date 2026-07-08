/** 預計完成 vs 交期：晚於交期＝紅、早於交期＝綠、同日或缺日期＝預設色（生產管理／通路端共用） */
export function plannedVsDeliveryTone(
  planned: string | null | undefined,
  delivery: string | null | undefined,
): string {
  const p = planned ? String(planned).trim().slice(0, 10) : "";
  const d = delivery ? String(delivery).trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return "";
  }
  if (p > d) return "text-red-600 dark:text-red-400 font-semibold";
  if (p < d) return "text-emerald-700 dark:text-emerald-400 font-semibold";
  return "";
}
