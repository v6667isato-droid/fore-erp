import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 工單工序站別（與 DB `work_orders.stage` 一致）。
 * 順序：待排程 → 備料中 → 零部件製作中 → … → 已出貨；「暫停」為特殊狀態。
 * 兩段組裝／塗裝以 (一)(二) 區分（… → 塗裝中(二) → 塗裝後製程(組配、編織) → 包裝管理）。
 */
export const WORK_ORDER_STAGES = [
  "待排程",
  "備料中",
  "零部件製作中",
  "砂磨中",
  "組裝中(一)",
  "塗裝中",
  "組裝中(二)",
  "塗裝中(二)",
  "塗裝後製程(組配、編織)",
  "包裝管理",
  "待出貨",
  "已出貨",
  "暫停",
] as const;

export type WorkOrderStage = (typeof WORK_ORDER_STAGES)[number];

export const DEFAULT_WORK_ORDER_STAGE: WorkOrderStage = "待排程";

/**
 * 新建工單時將訂單交期寫入 `work_orders.planned_end_date`（Postgres `date` 用 YYYY-MM-DD）。
 * 無交期則為 null，生產管理可再手動調整。
 */
export function plannedEndDateFromOrderDelivery(
  expectedDelivery: string | null | undefined
): string | null {
  if (expectedDelivery == null) return null;
  const s = String(expectedDelivery).trim();
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** 訂單狀態為「生產中」或「暫停」時，主檔狀態不可手動更改（請改生產工單工序） */
export function isOrderStatusLockedForManualEdit(orderStatus: string): boolean {
  const s = (orderStatus ?? "").trim();
  return s === "生產中" || s === "暫停";
}

/** 舊資料／手動輸入之站別字串 → 現行站別 */
const LEGACY_STAGE_MAP: Record<string, WorkOrderStage> = {
  開料中: "備料中",
  組裝中: "組裝中(一)",
  製作中: "零部件製作中",
  品檢中: "包裝管理",
  包裝檢查: "包裝管理",
  /** 舊簡稱（migration 可能曾寫入） */
  塗裝後製程: "塗裝後製程(組配、編織)",
  成品: "待出貨",
};

export function normalizeWorkOrderStage(raw: string | null | undefined): WorkOrderStage {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_WORK_ORDER_STAGE;
  if (isWorkOrderStage(s)) return s;
  return LEGACY_STAGE_MAP[s] ?? DEFAULT_WORK_ORDER_STAGE;
}

export function isWorkOrderStage(value: string): value is WorkOrderStage {
  return (WORK_ORDER_STAGES as readonly string[]).includes(value);
}

/** 列表／排序用：未知字串排在最後 */
export function workOrderStageSortIndex(stage: string): number {
  const i = WORK_ORDER_STAGES.indexOf(stage as WorkOrderStage);
  return i >= 0 ? i : 999;
}

export function stageStyleClassName(stage: WorkOrderStage): string {
  switch (stage) {
    case "待排程":
      return "bg-muted text-foreground border-border";
    case "備料中":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "零部件製作中":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "砂磨中":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "組裝中(一)":
    case "組裝中(二)":
      return "bg-indigo-100 text-indigo-900 border-indigo-200";
    case "塗裝中":
    case "塗裝中(二)":
      return "bg-rose-100 text-rose-900 border-rose-200";
    case "塗裝後製程(組配、編織)":
    case "包裝管理":
      return "bg-cyan-100 text-cyan-900 border-cyan-200";
    case "待出貨":
      return "bg-teal-100 text-teal-900 border-teal-200";
    case "暫停":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "已出貨":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    default:
      return "bg-muted text-foreground border-border";
  }
}

/** 全部品項為此兩站之一（可混合）時，訂單自動為「已完工」 */
const STAGES_IMPLY_ORDER_DONE: readonly WorkOrderStage[] = [
  "包裝管理",
  "待出貨",
];
const STAGES_IMPLY_ORDER_DONE_SET = new Set<WorkOrderStage>(
  STAGES_IMPLY_ORDER_DONE
);

/**
 * 訂單改為「生產中」時：將仍為「待排程」之工單改為「備料中」。
 * 訂單「已出貨」或「結案」：非暫停之工單改為「已出貨」。
 * （「已完工／已出貨」改由 syncOrderStatusFromWorkOrders 依工序推進，不在此函式帶出。）
 */
export async function syncWorkOrdersToOrderStatus(
  client: SupabaseClient,
  orderId: string,
  orderStatus: string,
): Promise<{ ok: boolean; error?: string }> {
  const s = (orderStatus ?? "").trim();

  const { data: items, error: itemsErr } = await client
    .from("order_items")
    .select("id")
    .eq("order_id", orderId);
  if (itemsErr) {
    return { ok: false, error: itemsErr.message };
  }
  const itemIds = (items ?? []).map((r: { id: string }) => r.id);
  if (itemIds.length === 0) {
    return { ok: true };
  }

  const { data: rows, error: woErr } = await client
    .from("work_orders")
    .select("id, stage")
    .in("order_item_id", itemIds);
  if (woErr) {
    return { ok: false, error: woErr.message };
  }

  const updates: { id: string; stage: WorkOrderStage }[] = [];

  for (const row of (rows ?? []) as { id: string; stage: string | null }[]) {
    const cur = normalizeWorkOrderStage(row.stage);
    if (cur === "暫停") continue;

    let next: WorkOrderStage | null = null;
    if (s === "生產中" && cur === "待排程") {
      next = "備料中";
    } else if (s === "已出貨" || s === "結案") {
      next = "已出貨";
    }

    if (next != null && next !== cur) {
      updates.push({ id: row.id, stage: next });
    }
  }

  for (const u of updates) {
    const { error } = await client.from("work_orders").update({ stage: u.stage }).eq("id", u.id);
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  return { ok: true };
}

/**
 * 依工單工序回寫訂單狀態：
 * - 任一品項為「暫停」→ 訂單「暫停」
 * - 全部為「已出貨」→ 訂單「已出貨」
 * - 全部為「包裝管理」或「待出貨」（可混合）→ 訂單「已完工」
 * - 全部為「待排程」且訂單已進入生產（生產中／暫停／已完工）→ 退回「排程中」
 *   （零件扣帳不自動回沖，訂單刪除或重啟時以出貨複查／盤點回歸零件數量）
 * - 自「暫停」復原（已無暫停）且不符合上列 →「生產中」
 * - 「已完工」但已不符合上列 → 退回「生產中」
 * 已出貨／結案之訂單不自動變更狀態。
 */
export async function syncOrderStatusFromWorkOrders(
  client: SupabaseClient,
  orderId: string,
): Promise<{ ok: boolean; error?: string; nextOrderStatus?: string }> {
  const { data: ord, error: ordErr } = await client
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (ordErr) {
    return { ok: false, error: ordErr.message };
  }
  const orderStatus = String((ord as { status?: string } | null)?.status ?? "").trim();

  if (orderStatus === "已出貨" || orderStatus === "結案") {
    return { ok: true };
  }

  const { data: items, error: itemsErr } = await client
    .from("order_items")
    .select("id")
    .eq("order_id", orderId);
  if (itemsErr) {
    return { ok: false, error: itemsErr.message };
  }
  const itemIds = (items ?? []).map((r: { id: string }) => r.id);
  if (itemIds.length === 0) {
    return { ok: true };
  }

  const { data: rows, error: woErr } = await client
    .from("work_orders")
    .select("id, stage")
    .in("order_item_id", itemIds);
  if (woErr) {
    return { ok: false, error: woErr.message };
  }

  const list = (rows ?? []) as { id: string; stage: string | null }[];
  const stages = list.map((r) => normalizeWorkOrderStage(r.stage));

  if (stages.length === 0) {
    return { ok: true };
  }

  let nextOrderStatus: string | null = null;

  if (stages.some((st) => st === "暫停")) {
    if (orderStatus !== "暫停") {
      nextOrderStatus = "暫停";
    }
  } else if (stages.every((st) => st === "已出貨")) {
    if (orderStatus !== "已出貨") {
      nextOrderStatus = "已出貨";
    }
  } else if (stages.every((st) => STAGES_IMPLY_ORDER_DONE_SET.has(st))) {
    if (orderStatus !== "已完工") {
      nextOrderStatus = "已完工";
    }
  } else if (stages.every((st) => st === "待排程")) {
    if (
      orderStatus === "生產中" ||
      orderStatus === "暫停" ||
      orderStatus === "已完工"
    ) {
      nextOrderStatus = "排程中";
    }
  } else {
    if (orderStatus === "暫停") {
      nextOrderStatus = "生產中";
    } else if (orderStatus === "已完工") {
      nextOrderStatus = "生產中";
    }
  }

  if (nextOrderStatus == null) {
    return { ok: true };
  }

  const { error: upErr } = await client
    .from("orders")
    .update({ status: nextOrderStatus })
    .eq("id", orderId);
  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  return { ok: true, nextOrderStatus };
}
