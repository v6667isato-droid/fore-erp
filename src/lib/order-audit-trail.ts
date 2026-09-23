/**
 * 訂單歷程：把 audit_logs 原始列整理成人看得懂的事件時間軸。
 * 訂單編輯存檔時品項是「全刪再新增」，工單也跟著重建，這裡會把同一次存檔的
 * 刪除＋新增配對成「修改品項」，並只列出真正有變的欄位。
 */

export type JsonRecord = Record<string, unknown>;

export interface AuditRow {
  id: number;
  happened_at: string;
  table_name: string;
  action: string;
  record_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_label: string | null;
  changed_fields: string[] | null;
  old_data: JsonRecord | null;
  new_data: JsonRecord | null;
}

/** 外鍵 ID → 顯示名稱 */
export interface TrailLookups {
  variants: Record<string, string>;
  employees: Record<string, string>;
  customers: Record<string, string>;
}

export interface FieldChange {
  label: string;
  /** undefined 表示這是快照值（新增／刪除時），不是前後比較 */
  from?: string;
  to: string;
}

export type EntryTone = "create" | "update" | "delete";

export interface TrailEntry {
  title: string;
  tone: EntryTone;
  subject?: string;
  changes: FieldChange[];
  notes: string[];
}

export interface TrailEvent {
  key: string;
  at: string;
  actorEmail: string | null;
  actorLabel: string | null;
  entries: TrailEntry[];
  rows: AuditRow[];
}

/** 同一操作者前後兩筆紀錄間隔在此之內，視為同一次存檔 */
const BATCH_GAP_MS = 10_000;

const HIDDEN_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "order_id",
  "order_item_id",
  "return_id",
  "line_order",
]);

const FIELD_LABELS: Record<string, string> = {
  order_number: "訂單編號",
  customer_id: "客戶",
  order_date: "下單日",
  expected_delivery_date: "預計交期",
  total_amount: "總額",
  deposit_amount: "訂金",
  deposit_date: "訂金日",
  final_payment_amount: "尾款",
  final_payment_date: "尾款日",
  payment_status: "付款狀態",
  internal_notes: "內部備註",
  shipping_address: "送貨地址",
  shipping_contact_name: "收件人",
  shipping_contact_phone: "收件電話",
  shipping_has_elevator: "有電梯",
  shipping_fee: "運費",
  invoice_title: "發票抬頭",
  invoice_tax_id: "統編",
  shipped_date: "出貨日",
  tax_extra: "另外加稅",
  tax_extra_amount: "稅額",
  quote_includes_tax: "報價含稅",
  explanation_image_url: "說明圖",
  source: "來源",
  address_label_printed_at: "地址條列印",
  deleted_at: "刪除時間",
  variant_id: "規格",
  custom_name: "品名",
  custom_category: "類別",
  quantity: "數量",
  unit_price: "單價",
  channel_unit_price: "通路單價",
  wood_type: "木種",
  custom_dimension_w: "寬",
  custom_dimension_d: "深",
  custom_dimension_h: "高",
  seat_height_cm: "座高",
  custom_description: "描述",
  custom_notes: "備註",
  image_url: "圖片",
  custom_case_id: "客製案",
  stage: "階段",
  status: "狀態",
  planned_start_date: "預計開工",
  planned_end_date: "預計完工",
  actual_start_date: "實際開工",
  actual_end_date: "實際完工",
  notes: "備註",
  assignee_id: "負責人",
  return_date: "退貨日",
  refund_amount: "退款金額",
  reason: "原因",
  description: "品項",
};

const MONEY_KEYS = new Set([
  "total_amount",
  "deposit_amount",
  "final_payment_amount",
  "shipping_fee",
  "tax_extra_amount",
  "unit_price",
  "channel_unit_price",
  "refund_amount",
]);

const ORDER_CREATE_KEYS = [
  "order_number",
  "customer_id",
  "shipping_contact_name",
  "status",
  "payment_status",
  "order_date",
  "expected_delivery_date",
  "total_amount",
  "shipping_address",
];

const ITEM_SNAPSHOT_KEYS = [
  "variant_id",
  "custom_name",
  "custom_category",
  "quantity",
  "unit_price",
  "channel_unit_price",
  "wood_type",
  "__size",
  "seat_height_cm",
  "custom_description",
  "custom_notes",
  "image_url",
  "custom_case_id",
];

/** 已在品項標題（規格／品名／數量）顯示的欄位，新增／刪除品項時不重複列 */
const ITEM_LABEL_KEYS = new Set(["variant_id", "custom_name", "custom_category", "quantity"]);

const WORK_ORDER_KEYS = [
  "stage",
  "status",
  "assignee_id",
  "planned_start_date",
  "planned_end_date",
  "actual_start_date",
  "actual_end_date",
  "notes",
];

const RETURN_KEYS = ["return_date", "refund_amount", "reason", "notes"];

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 依瀏覽器時區顯示，例如 2026/9/23 10:22 */
export function formatAuditTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** service role 寫入來源標記（audit_logs.actor_label）轉可讀文字 */
export function describeActorLabel(
  label: string,
  channelNames: Record<string, string>,
): string {
  const l = label.trim();
  if (l.startsWith("portal:")) {
    const chName = channelNames[l.slice("portal:".length)];
    return chName ? `通路下單（${chName}）` : "通路下單";
  }
  if (l.startsWith("cron:")) return `排程（${l.slice("cron:".length)}）`;
  if (l.startsWith("user:")) return l.slice("user:".length);
  if (l === "telegram-bot") return "Telegram Bot";
  if (l) return l;
  return "系統";
}

export function formatFieldValue(key: string, v: unknown, lk: TrailLookups): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  if (key === "variant_id") return lk.variants[s] ?? `（規格 ${s.slice(0, 8)}）`;
  if (key === "assignee_id") return lk.employees[s] ?? `（員工 ${s.slice(0, 8)}）`;
  if (key === "customer_id") return lk.customers[s] ?? `（客戶 ${s.slice(0, 8)}）`;
  if (key === "image_url" || key === "explanation_image_url") return "有圖片";
  if (key === "custom_case_id") return "已連結";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (MONEY_KEYS.has(key)) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : s;
  }
  if (key === "seat_height_cm" || key.startsWith("custom_dimension_")) return `${s} cm`;
  if (key.endsWith("_at")) return formatAuditTime(s);
  if (key.endsWith("_date") && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, "/");
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return s;
    }
  }
  return s;
}

function labelOf(key: string): string {
  if (key === "__size") return "尺寸";
  return FIELD_LABELS[key] ?? key;
}

interface ProjectedField {
  key: string;
  raw: string;
  text: string;
}

function sizeText(d: JsonRecord): { raw: string; text: string } | null {
  const w = str(d.custom_dimension_w);
  const dd = str(d.custom_dimension_d);
  const h = str(d.custom_dimension_h);
  if (!w && !dd && !h) return null;
  return { raw: `${w}|${dd}|${h}`, text: `${w ?? "?"}×${dd ?? "?"}×${h ?? "?"} cm` };
}

function project(d: JsonRecord, keys: string[], lk: TrailLookups): ProjectedField[] {
  const out: ProjectedField[] = [];
  for (const key of keys) {
    if (key === "__size") {
      const sz = sizeText(d);
      out.push({ key, raw: sz?.raw ?? "", text: sz?.text ?? "—" });
      continue;
    }
    const v = d[key];
    const empty = v === null || v === undefined || v === "";
    out.push({ key, raw: empty ? "" : JSON.stringify(v), text: formatFieldValue(key, v, lk) });
  }
  return out;
}

function diffProjected(a: ProjectedField[], b: ProjectedField[]): FieldChange[] {
  const changes: FieldChange[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].raw === b[i].raw) continue;
    const from = a[i].text;
    const to = a[i].text === b[i].text ? `${b[i].text}（已更換）` : b[i].text;
    changes.push({ label: labelOf(a[i].key), from, to });
  }
  return changes;
}

function snapshotChanges(fields: ProjectedField[], skip?: Set<string>): FieldChange[] {
  return fields
    .filter((f) => f.raw !== "" && !skip?.has(f.key))
    .map((f) => ({ label: labelOf(f.key), to: f.text }));
}

export function itemLabel(d: JsonRecord | undefined, lk: TrailLookups): string {
  if (!d) return "品項";
  const variantId = str(d.variant_id);
  const variant = variantId ? formatFieldValue("variant_id", variantId, lk) : null;
  const category = str(d.custom_category);
  const name = variant ?? str(d.custom_name) ?? category ?? "品項";
  const prefix = variant && category ? `${category} · ` : "";
  const qty = str(d.quantity);
  return `${prefix}${name}${qty ? ` × ${qty}` : ""}`;
}

/** 同一筆紀錄在同一次存檔內的多次 UPDATE 合併成淨變動 */
function mergeUpdates(rows: AuditRow[]): { row: AuditRow; old: JsonRecord; next: JsonRecord }[] {
  const byRecord = new Map<string, { row: AuditRow; old: JsonRecord; next: JsonRecord }>();
  for (const r of rows) {
    const k = `${r.table_name}:${r.record_id}`;
    const cur = byRecord.get(k) ?? { row: r, old: {}, next: {} };
    for (const f of r.changed_fields ?? []) {
      if (!(f in cur.old)) cur.old[f] = r.old_data?.[f] ?? null;
      cur.next[f] = r.new_data?.[f] ?? null;
    }
    byRecord.set(k, cur);
  }
  return [...byRecord.values()];
}

function updateChanges(old: JsonRecord, next: JsonRecord, lk: TrailLookups): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of Object.keys(next).sort()) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (JSON.stringify(old[key] ?? null) === JSON.stringify(next[key] ?? null)) continue;
    changes.push({
      label: labelOf(key),
      from: formatFieldValue(key, old[key], lk),
      to: formatFieldValue(key, next[key], lk),
    });
  }
  return changes;
}

function actorKey(r: AuditRow): string {
  return r.actor_email ?? r.actor_label ?? r.actor_id ?? "";
}

function splitBatches(rows: AuditRow[]): AuditRow[][] {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(a.happened_at) - Date.parse(b.happened_at) || a.id - b.id,
  );
  const batches: AuditRow[][] = [];
  let cur: AuditRow[] = [];
  for (const r of sorted) {
    const prev = cur[cur.length - 1];
    if (
      prev &&
      actorKey(prev) === actorKey(r) &&
      Date.parse(r.happened_at) - Date.parse(prev.happened_at) <= BATCH_GAP_MS
    ) {
      cur.push(r);
    } else {
      if (cur.length) batches.push(cur);
      cur = [r];
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

interface TrailContext {
  lk: TrailLookups;
  /** 品項 ID → 最近一次完整快照 */
  items: Map<string, JsonRecord>;
  /** 工單 ID → 品項 ID */
  workOrderItem: Map<string, string>;
}

function buildContext(rows: AuditRow[], lk: TrailLookups): TrailContext {
  const items = new Map<string, JsonRecord>();
  const workOrderItem = new Map<string, string>();
  for (const r of rows) {
    const snap = r.new_data && r.action === "INSERT" ? r.new_data : r.action === "DELETE" ? r.old_data : null;
    if (!snap || !r.record_id) continue;
    if (r.table_name === "order_items") items.set(r.record_id, snap);
    if (r.table_name === "work_orders") {
      const itemId = str(snap.order_item_id);
      if (itemId) workOrderItem.set(r.record_id, itemId);
    }
  }
  return { lk, items, workOrderItem };
}

/** 刪除＋新增的品項配對：內容完全相同 → 同規格／品名 → 同排序位置 */
function pairItems(
  deleted: AuditRow[],
  inserted: AuditRow[],
  lk: TrailLookups,
): { pairs: [AuditRow, AuditRow][]; removed: AuditRow[]; added: AuditRow[] } {
  const leftDel = [...deleted];
  const leftIns = [...inserted];
  const pairs: [AuditRow, AuditRow][] = [];
  const contentKey = (d: JsonRecord | null) =>
    JSON.stringify(project(d ?? {}, ITEM_SNAPSHOT_KEYS, lk).map((f) => f.raw));
  const identityKey = (d: JsonRecord | null) =>
    str(d?.variant_id) ?? `${str(d?.custom_category) ?? ""}|${str(d?.custom_name) ?? ""}`;
  const lineKey = (d: JsonRecord | null) => String(d?.line_order ?? "");

  const matchers: ((del: AuditRow, ins: AuditRow) => boolean)[] = [
    (del, ins) => contentKey(del.old_data) === contentKey(ins.new_data),
    (del, ins) => identityKey(del.old_data) === identityKey(ins.new_data),
    (del, ins) => lineKey(del.old_data) === lineKey(ins.new_data),
  ];
  for (const match of matchers) {
    for (let i = 0; i < leftDel.length; ) {
      const j = leftIns.findIndex((ins) => match(leftDel[i], ins));
      if (j >= 0) {
        pairs.push([leftDel[i], leftIns[j]]);
        leftDel.splice(i, 1);
        leftIns.splice(j, 1);
      } else {
        i++;
      }
    }
  }
  return { pairs, removed: leftDel, added: leftIns };
}

function buildEntries(batch: AuditRow[], ctx: TrailContext): TrailEntry[] {
  const { lk } = ctx;
  const orderEntries: TrailEntry[] = [];
  const itemEntries: TrailEntry[] = [];
  const workOrderEntries: TrailEntry[] = [];
  const returnEntries: TrailEntry[] = [];

  const of = (table: string, action: string) =>
    batch.filter((r) => r.table_name === table && r.action === action);

  // 訂單
  for (const r of of("orders", "INSERT")) {
    const fields = project(r.new_data ?? {}, ORDER_CREATE_KEYS, lk);
    orderEntries.push({ title: "建立訂單", tone: "create", changes: snapshotChanges(fields), notes: [] });
  }
  for (const u of mergeUpdates(of("orders", "UPDATE"))) {
    const next = { ...u.next };
    const old = { ...u.old };
    if ("deleted_at" in next) {
      const wasDeleted = old.deleted_at != null;
      const isDeleted = next.deleted_at != null;
      if (!wasDeleted && isDeleted) {
        orderEntries.push({ title: "刪除訂單", tone: "delete", changes: [], notes: [] });
      } else if (wasDeleted && !isDeleted) {
        orderEntries.push({ title: "還原訂單", tone: "create", changes: [], notes: [] });
      }
      delete next.deleted_at;
      delete old.deleted_at;
    }
    const changes = updateChanges(old, next, lk);
    if (changes.length) orderEntries.push({ title: "修改訂單", tone: "update", changes, notes: [] });
  }
  for (const r of of("orders", "DELETE")) {
    orderEntries.push({
      title: "永久刪除訂單",
      tone: "delete",
      subject: str(r.old_data?.order_number) ?? undefined,
      changes: [],
      notes: [],
    });
  }

  // 工單（先依品項分組，給品項配對使用）
  const woInserted = of("work_orders", "INSERT");
  const woDeleted = of("work_orders", "DELETE");
  const woUsed = new Set<number>();
  const woByItem = (rows: AuditRow[], itemId: string | null) =>
    rows.find(
      (w) => !woUsed.has(w.id) && str((w.new_data ?? w.old_data)?.order_item_id) === itemId,
    );
  const woStage = (w: AuditRow) => str((w.new_data ?? w.old_data)?.stage) ?? "—";

  // 品項
  const { pairs, removed, added } = pairItems(of("order_items", "DELETE"), of("order_items", "INSERT"), lk);
  for (const [del, ins] of pairs) {
    const before = project(del.old_data ?? {}, ITEM_SNAPSHOT_KEYS, lk);
    const after = project(ins.new_data ?? {}, ITEM_SNAPSHOT_KEYS, lk);
    const itemChanges = diffProjected(before, after);

    const wDel = woByItem(woDeleted, del.record_id);
    const wIns = woByItem(woInserted, ins.record_id);
    let woChanges: FieldChange[] = [];
    const notes: string[] = [];
    if (wDel && wIns) {
      woUsed.add(wDel.id);
      woUsed.add(wIns.id);
      woChanges = diffProjected(
        project(wDel.old_data ?? {}, WORK_ORDER_KEYS, lk),
        project(wIns.new_data ?? {}, WORK_ORDER_KEYS, lk),
      );
      if (!woChanges.length) notes.push(`工單隨品項重建（階段保留：${woStage(wIns)}）`);
    } else if (wDel) {
      woUsed.add(wDel.id);
      notes.push(`原工單已刪除（原階段：${woStage(wDel)}）`);
    } else if (wIns) {
      woUsed.add(wIns.id);
      notes.push(`建立工單（${woStage(wIns)}）`);
    }

    const subject = itemLabel(ins.new_data ?? undefined, lk);
    const onlyRebuilt = notes.length === 1 && notes[0].startsWith("工單隨品項重建");
    if (itemChanges.length || (!woChanges.length && notes.length && !onlyRebuilt)) {
      itemEntries.push({ title: "修改品項", tone: "update", subject, changes: itemChanges, notes });
    }
    if (woChanges.length) {
      workOrderEntries.push({
        title: "工單異動",
        tone: "update",
        subject,
        changes: woChanges,
        notes: ["工單隨品項重建"],
      });
    }
  }
  for (const ins of added) {
    const fields = project(ins.new_data ?? {}, ITEM_SNAPSHOT_KEYS, lk);
    const notes: string[] = [];
    const w = woByItem(woInserted, ins.record_id);
    if (w) {
      woUsed.add(w.id);
      notes.push(`建立工單（${woStage(w)}）`);
    }
    itemEntries.push({
      title: "新增品項",
      tone: "create",
      subject: itemLabel(ins.new_data ?? undefined, lk),
      changes: snapshotChanges(fields, ITEM_LABEL_KEYS),
      notes,
    });
  }
  for (const del of removed) {
    const notes: string[] = [];
    const w = woByItem(woDeleted, del.record_id);
    if (w) {
      woUsed.add(w.id);
      notes.push(`工單一併刪除（原階段：${woStage(w)}）`);
    }
    itemEntries.push({
      title: "刪除品項",
      tone: "delete",
      subject: itemLabel(del.old_data ?? undefined, lk),
      changes: [],
      notes,
    });
  }
  for (const u of mergeUpdates(of("order_items", "UPDATE"))) {
    const changes = updateChanges(u.old, u.next, lk);
    if (!changes.length) continue;
    itemEntries.push({
      title: "修改品項",
      tone: "update",
      subject: itemLabel(ctx.items.get(u.row.record_id ?? ""), lk),
      changes,
      notes: [],
    });
  }

  // 其餘工單異動
  const woSubject = (woId: string | null) => {
    const itemId = woId ? ctx.workOrderItem.get(woId) : undefined;
    return itemId ? itemLabel(ctx.items.get(itemId), lk) : undefined;
  };
  for (const u of mergeUpdates(of("work_orders", "UPDATE"))) {
    const changes = updateChanges(u.old, u.next, lk);
    if (!changes.length) continue;
    workOrderEntries.push({
      title: "工單異動",
      tone: "update",
      subject: woSubject(u.row.record_id),
      changes,
      notes: [],
    });
  }
  for (const w of woInserted) {
    if (woUsed.has(w.id)) continue;
    workOrderEntries.push({
      title: "建立工單",
      tone: "create",
      subject: woSubject(w.record_id),
      changes: snapshotChanges(project(w.new_data ?? {}, WORK_ORDER_KEYS, lk)),
      notes: [],
    });
  }
  for (const w of woDeleted) {
    if (woUsed.has(w.id)) continue;
    workOrderEntries.push({
      title: "刪除工單",
      tone: "delete",
      subject: woSubject(w.record_id),
      changes: [],
      notes: [`原階段：${woStage(w)}`],
    });
  }

  // 退貨
  for (const r of of("order_returns", "INSERT")) {
    returnEntries.push({
      title: "建立退貨",
      tone: "create",
      changes: snapshotChanges(project(r.new_data ?? {}, RETURN_KEYS, lk)),
      notes: [],
    });
  }
  for (const u of mergeUpdates(of("order_returns", "UPDATE"))) {
    const changes = updateChanges(u.old, u.next, lk);
    if (changes.length) returnEntries.push({ title: "修改退貨", tone: "update", changes, notes: [] });
  }
  if (of("order_returns", "DELETE").length) {
    returnEntries.push({ title: "刪除退貨", tone: "delete", changes: [], notes: [] });
  }
  const returnItemLabel = (d: JsonRecord | null) =>
    `${str(d?.description) ?? "品項"}${str(d?.quantity) ? ` × ${str(d?.quantity)}` : ""}`;
  for (const r of of("order_return_items", "INSERT")) {
    returnEntries.push({
      title: "退貨品項",
      tone: "create",
      subject: returnItemLabel(r.new_data),
      changes: [],
      notes: [],
    });
  }
  for (const u of mergeUpdates(of("order_return_items", "UPDATE"))) {
    const changes = updateChanges(u.old, u.next, lk);
    if (changes.length) {
      returnEntries.push({ title: "修改退貨品項", tone: "update", changes, notes: [] });
    }
  }
  for (const r of of("order_return_items", "DELETE")) {
    returnEntries.push({
      title: "移除退貨品項",
      tone: "delete",
      subject: returnItemLabel(r.old_data),
      changes: [],
      notes: [],
    });
  }

  return [...orderEntries, ...itemEntries, ...workOrderEntries, ...returnEntries];
}

/** 整理成時間軸事件（新到舊）；沒有實質變動的存檔（例如品項原樣重建）不列出 */
export function buildOrderTrail(rows: AuditRow[], lookups: TrailLookups): TrailEvent[] {
  const ctx = buildContext(rows, lookups);
  const events: TrailEvent[] = [];
  for (const batch of splitBatches(rows)) {
    const entries = buildEntries(batch, ctx);
    if (!entries.length) continue;
    const first = batch[0];
    events.push({
      key: `${first.id}`,
      at: first.happened_at,
      actorEmail: first.actor_email,
      actorLabel: first.actor_label,
      entries,
      rows: batch,
    });
  }
  return events.reverse();
}

/** 需要查名稱的外鍵 ID */
export function collectReferenceIds(rows: AuditRow[]): {
  variantIds: string[];
  employeeIds: string[];
  customerIds: string[];
} {
  const variantIds = new Set<string>();
  const employeeIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const r of rows) {
    for (const d of [r.old_data, r.new_data]) {
      if (!d) continue;
      const v = str(d.variant_id);
      if (v && r.table_name === "order_items") variantIds.add(v);
      const a = str(d.assignee_id);
      if (a && r.table_name === "work_orders") employeeIds.add(a);
      const c = str(d.customer_id);
      if (c && r.table_name === "orders") customerIds.add(c);
    }
  }
  return {
    variantIds: [...variantIds],
    employeeIds: [...employeeIds],
    customerIds: [...customerIds],
  };
}
