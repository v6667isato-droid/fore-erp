/**
 * 通路下單共用規則：portal 前端與 /api/portal/* routes 都會用到，
 * 抽出成純 lib 以免 server route 引入 client component。
 */

/**
 * 訂單狀態為「生產中」之後（含）即鎖定，與內部訂單流程一致。
 * 此前：報價中、繪圖中、客戶圖面確認、排程中、繪製製作圖 — 通路可編輯／刪除。
 */
export const PORTAL_NO_EDIT_DELETE_STATUSES = new Set([
  "生產中",
  "暫停",
  "已完工",
  "已出貨",
  "結案",
  "已退貨",
]);

export function canEditOrDelete(status: string | null | undefined): boolean {
  return !PORTAL_NO_EDIT_DELETE_STATUSES.has(String(status ?? "").trim());
}

/** 客製家具（手填品項）類別：ERP 開單「客製家具」與通路「訂製品」共用 */
export const CUSTOM_ITEM_CATEGORIES = ["桌", "椅", "凳", "櫃", "層架", "其他"] as const;

/** 有座高的客製類別（通路訂製品才顯示座高欄） */
export const CUSTOM_ITEM_SEAT_CATEGORIES: ReadonlySet<string> = new Set(["椅", "凳"]);

/** 含待報價訂製品的通路訂單狀態；報完價由內部改為後續狀態 */
export const PORTAL_QUOTE_STATUS = "報價中";

/** 通路下單（僅規格品）建立後的狀態 */
export const PORTAL_DEFAULT_STATUS = "排程中";

export function generatePortalOrderNumber(): string {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `ORD-${ymd}-${suffix}`;
}
