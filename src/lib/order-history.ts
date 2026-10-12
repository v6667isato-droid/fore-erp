/**
 * 訂單履歷時間軸：把訂單狀態歷程、各品項工序歷程、收款、發票、完工照片、出貨、退貨
 * 整理成依時間排序（舊到新）的事件。資料來源都是一般員工可讀的表，不經 audit_logs
 * （欄位層級的「修改紀錄」仍在 order-audit-trail，限管理者）。
 */

export type HistoryEventKind =
  | "created"
  | "status"
  | "stage"
  | "payment"
  | "invoice"
  | "photos"
  | "shipped"
  | "return";

export const HISTORY_KIND_LABELS: Record<HistoryEventKind, string> = {
  created: "建立",
  status: "訂單狀態",
  stage: "工序",
  payment: "收款",
  invoice: "發票",
  photos: "完工照片",
  shipped: "出貨",
  return: "退貨",
};

/** 同一時間點的事件排序 */
const KIND_RANK: Record<HistoryEventKind, number> = {
  created: 0,
  status: 1,
  stage: 2,
  payment: 3,
  invoice: 4,
  photos: 5,
  shipped: 6,
  return: 7,
};

export interface HistoryActor {
  userId?: string | null;
  employeeId?: string | null;
  /** service role 來源標記（portal:<channel_id> 等） */
  label?: string | null;
}

export interface HistoryEvent {
  key: string;
  kind: HistoryEventKind;
  /** 排序用（ms）；只有日期的事件排在當天最後 */
  sortAt: number;
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 本地時間 HH:mm；只有日期的事件為 null */
  time: string | null;
  title: string;
  subject?: string;
  notes: string[];
  actor?: HistoryActor;
  /** kind=photos：照片 id（依上傳順序） */
  photoIds: string[];
}

export interface OrderHistoryInput {
  order: {
    created_at: string | null;
    deposit_amount: number | null;
    deposit_date: string | null;
    final_payment_amount: number | null;
    final_payment_date: string | null;
    shipped_date: string | null;
  };
  /** 目前的品項（label 為顯示名稱） */
  items: { id: string; label: string }[];
  workOrders: { id: string; order_item_id: string }[];
  stageHistory: {
    work_order_id: string;
    old_stage: string | null;
    new_stage: string;
    changed_at: string;
    changed_by_user_id: string | null;
    changed_by_employee_id: string | null;
  }[];
  statusHistory: {
    old_status: string | null;
    new_status: string;
    changed_at: string;
    changed_by_user_id: string | null;
    actor_label: string | null;
  }[];
  photos: {
    id: string;
    order_item_id: string | null;
    taken_on: string | null;
    created_at: string;
    uploaded_by: string | null;
  }[];
  returns: { id: string; return_date: string; refund_amount: number | null; reason: string | null }[];
  invoices: {
    id: string;
    invoice_number: string | null;
    invoice_date: string | null;
    status: string;
    amount_inc_tax: number | null;
    void_date: string | null;
  }[];
}

/** 多個品項在這段時間內被同一人推到同一站別，視為一次操作合併顯示 */
const STAGE_MERGE_WINDOW_MS = 2 * 60 * 1000;
/** 工單在訂單建立後這麼久才出現、且一建立就不是「待排程」→ 舊版編輯訂單時重建的工單 */
const REBUILT_WORK_ORDER_GAP_MS = 10 * 60 * 1000;
const INITIAL_STAGE = "待排程";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** YYYY-MM-DD → 當地當天最後一刻（只有日期的事件排在同日有時間的事件之後） */
function endOfDayMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime();
}

function money(n: number): string {
  return `NT$${n.toLocaleString("en-US")}`;
}

interface Draft {
  key: string;
  kind: HistoryEventKind;
  title: string;
  subject?: string;
  notes?: string[];
  actor?: HistoryActor;
  photoIds?: string[];
}

function atTimestamp(iso: string, draft: Draft): HistoryEvent | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    ...draft,
    notes: draft.notes ?? [],
    photoIds: draft.photoIds ?? [],
    sortAt: d.getTime(),
    date: localDate(d),
    time: localTime(d),
  };
}

function onDate(ymd: string, draft: Draft): HistoryEvent | null {
  const sortAt = endOfDayMs(ymd);
  if (sortAt == null) return null;
  return {
    ...draft,
    notes: draft.notes ?? [],
    photoIds: draft.photoIds ?? [],
    sortAt,
    date: ymd.slice(0, 10),
    time: null,
  };
}

function itemsSubject(itemIds: string[], input: OrderHistoryInput, labelOf: (id: string) => string): string {
  const unique = [...new Set(itemIds)];
  if (input.items.length > 1 && unique.length === input.items.length) {
    return `全部品項（${unique.length} 項）`;
  }
  return unique.map(labelOf).join("、");
}

export function buildOrderHistory(input: OrderHistoryInput): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const push = (e: HistoryEvent | null) => {
    if (e) events.push(e);
  };

  const itemLabel = new Map(input.items.map((it) => [it.id, it.label]));
  const labelOf = (itemId: string) => itemLabel.get(itemId) ?? "已移除的品項";
  const itemOfWorkOrder = new Map(input.workOrders.map((w) => [w.id, w.order_item_id]));
  const orderCreatedMs = input.order.created_at ? Date.parse(input.order.created_at) : NaN;

  // 建立訂單＋訂單狀態
  const statusRows = [...input.statusHistory].sort(
    (a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at),
  );
  let createdFromStatus = false;
  for (const [i, r] of statusRows.entries()) {
    const actor = { userId: r.changed_by_user_id, label: r.actor_label };
    if (r.old_status == null && !createdFromStatus) {
      createdFromStatus = true;
      push(
        atTimestamp(r.changed_at, {
          key: `status-${i}`,
          kind: "created",
          title: "建立訂單",
          subject: `狀態：${r.new_status}`,
          actor,
        }),
      );
      continue;
    }
    push(
      atTimestamp(r.changed_at, {
        key: `status-${i}`,
        kind: "status",
        title: r.old_status ? `${r.old_status} → ${r.new_status}` : r.new_status,
        actor,
      }),
    );
  }
  if (!createdFromStatus && input.order.created_at) {
    push(atTimestamp(input.order.created_at, { key: "created", kind: "created", title: "建立訂單" }));
  }

  // 工序：同一人、同一站別、時間相近的多個品項合併成一筆
  const stageRows = [...input.stageHistory]
    .filter((r) => !(r.old_stage == null && r.new_stage === INITIAL_STAGE))
    .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
  type StageGroup = { first: (typeof stageRows)[number]; lastMs: number; itemIds: string[]; rebuilt: boolean };
  const groups: StageGroup[] = [];
  for (const r of stageRows) {
    const ms = Date.parse(r.changed_at);
    if (Number.isNaN(ms)) continue;
    const itemId = itemOfWorkOrder.get(r.work_order_id) ?? `wo:${r.work_order_id}`;
    const rebuilt =
      r.old_stage == null &&
      Number.isFinite(orderCreatedMs) &&
      ms - orderCreatedMs > REBUILT_WORK_ORDER_GAP_MS;
    const actorKey = `${r.changed_by_user_id ?? ""}|${r.changed_by_employee_id ?? ""}`;
    const g = groups.find(
      (x) =>
        x.first.new_stage === r.new_stage &&
        `${x.first.changed_by_user_id ?? ""}|${x.first.changed_by_employee_id ?? ""}` === actorKey &&
        x.rebuilt === rebuilt &&
        ms - x.lastMs <= STAGE_MERGE_WINDOW_MS,
    );
    if (g) {
      g.itemIds.push(itemId);
      g.lastMs = ms;
    } else {
      groups.push({ first: r, lastMs: ms, itemIds: [itemId], rebuilt });
    }
  }
  for (const [i, g] of groups.entries()) {
    push(
      atTimestamp(g.first.changed_at, {
        key: `stage-${i}`,
        kind: "stage",
        title: g.first.new_stage,
        subject: itemsSubject(g.itemIds, input, labelOf),
        notes: g.rebuilt ? ["編輯訂單時重建的工單，先前的工序時間未保留"] : [],
        actor: { userId: g.first.changed_by_user_id, employeeId: g.first.changed_by_employee_id },
      }),
    );
  }

  // 收款
  const { deposit_amount, deposit_date, final_payment_amount, final_payment_date } = input.order;
  if (deposit_date) {
    push(
      onDate(deposit_date, {
        key: "deposit",
        kind: "payment",
        title: deposit_amount && deposit_amount > 0 ? `訂金 ${money(deposit_amount)}` : "訂金",
      }),
    );
  }
  if (final_payment_date) {
    push(
      onDate(final_payment_date, {
        key: "final-payment",
        kind: "payment",
        title:
          final_payment_amount && final_payment_amount > 0
            ? `尾款 ${money(final_payment_amount)}`
            : "尾款",
      }),
    );
  }

  // 發票（草稿不列）
  for (const inv of input.invoices) {
    if (inv.status === "draft" || !inv.invoice_date) continue;
    push(
      onDate(inv.invoice_date, {
        key: `invoice-${inv.id}`,
        kind: "invoice",
        title: inv.invoice_number ? `開立 ${inv.invoice_number}` : "開立發票",
        subject: inv.amount_inc_tax != null ? money(inv.amount_inc_tax) : undefined,
        notes: inv.status === "voided" ? [`已作廢${inv.void_date ? `（${inv.void_date}）` : ""}`] : [],
      }),
    );
  }

  // 完工照片：同一品項、同一天合成一筆
  const photoGroups = new Map<string, { itemId: string | null; date: string; photos: OrderHistoryInput["photos"] }>();
  for (const p of input.photos) {
    const created = new Date(p.created_at);
    const date = p.taken_on ?? (Number.isNaN(created.getTime()) ? null : localDate(created));
    if (!date) continue;
    const key = `${p.order_item_id ?? ""}|${date}`;
    const g = photoGroups.get(key) ?? { itemId: p.order_item_id, date, photos: [] };
    g.photos.push(p);
    photoGroups.set(key, g);
  }
  // 同一天依品項在訂單中的順序，已移除的品項、整張訂單排最後
  const itemRank = new Map(input.items.map((it, i) => [it.id, i]));
  const rankOf = (itemId: string | null) =>
    itemId == null ? input.items.length + 1 : (itemRank.get(itemId) ?? input.items.length);
  const sortedPhotoGroups = [...photoGroups].sort(([, a], [, b]) => rankOf(a.itemId) - rankOf(b.itemId));
  for (const [key, g] of sortedPhotoGroups) {
    push(
      onDate(g.date, {
        key: `photos-${key}`,
        kind: "photos",
        title: `${g.photos.length} 張`,
        subject: g.itemId ? labelOf(g.itemId) : "整張訂單",
        actor: { userId: g.photos[0].uploaded_by },
        photoIds: g.photos.map((p) => p.id),
      }),
    );
  }

  // 出貨：狀態歷程已有同日「已出貨」就不重複列
  const shippedDate = input.order.shipped_date?.slice(0, 10);
  if (shippedDate) {
    const statusShippedSameDay = events.some(
      (e) => e.kind === "status" && e.title.endsWith("已出貨") && e.date === shippedDate,
    );
    if (!statusShippedSameDay) {
      push(onDate(shippedDate, { key: "shipped", kind: "shipped", title: "出貨" }));
    }
  }

  // 退貨
  for (const r of input.returns) {
    push(
      onDate(r.return_date, {
        key: `return-${r.id}`,
        kind: "return",
        title: r.refund_amount && r.refund_amount > 0 ? `退款 ${money(r.refund_amount)}` : "退貨",
        subject: r.reason?.trim() || undefined,
      }),
    );
  }

  // 穩定排序：同時間、同類型的事件維持加入順序
  return events.sort((a, b) => a.sortAt - b.sortAt || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** 依日期分組（保持原順序） */
export function groupHistoryByDate(events: HistoryEvent[]): { date: string; events: HistoryEvent[] }[] {
  const groups: { date: string; events: HistoryEvent[] }[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.events.push(e);
    else groups.push({ date: e.date, events: [e] });
  }
  return groups;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 2026-10-12 → 2026/10/12（一） */
export function formatHistoryDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}（${WEEKDAYS[d.getDay()]}）`;
}
