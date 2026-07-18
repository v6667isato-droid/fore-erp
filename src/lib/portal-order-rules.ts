/**
 * 通路下單共用規則：portal 前端與 /api/portal/* routes 都會用到，
 * 抽出成純 lib 以免 server route 引入 client component。
 */

/**
 * 訂單狀態為「生產中」之後（含）即鎖定，與內部訂單流程一致。
 * 此前：報價中、繪圖中、排程中、繪製製作圖 — 通路可編輯／刪除。
 */
export const PORTAL_NO_EDIT_DELETE_STATUSES = new Set([
  "生產中",
  "暫停",
  "已完工",
  "已出貨",
  "結案",
]);

export function canEditOrDelete(status: string | null | undefined): boolean {
  return !PORTAL_NO_EDIT_DELETE_STATUSES.has(String(status ?? "").trim());
}

export function generatePortalOrderNumber(): string {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `ORD-${ymd}-${suffix}`;
}
