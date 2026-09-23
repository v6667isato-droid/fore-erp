import {
  CONTACT_METHOD_OPTIONS,
  CUSTOMER_SOURCE_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
} from "@/lib/customer-options";

/**
 * 貼上建立客戶／訂單：AI 解析結果的型別、清理，以及「是否已有此客戶」的比對。
 * 比對只靠程式規則（電話、統編、LINE、IG、名稱、地址），不交給 AI，結果可預期、可測試。
 */

/** AI 解析出的客戶欄位（對應 customers 表；空字串一律正規化為 null） */
export interface IntakeCustomer {
  name: string | null;
  contact_person: string | null;
  phone: string | null;
  delivery_address: string | null;
  has_elevator: boolean | null;
  company: string | null;
  tax_id: string | null;
  brand_name: string | null;
  line_id: string | null;
  ig_account: string | null;
  source: string | null;
  customer_type: string | null;
  contact_method: string | null;
  notes: string | null;
}

/** 客製品項類別（與訂單表單「客製家具」下拉一致） */
export const INTAKE_ITEM_CATEGORIES = ["桌", "椅", "凳", "櫃", "層架", "其他"] as const;

/** AI 解析出的訂購品項（帶入訂單時為「客製家具」品項） */
export interface IntakeOrderItem {
  name: string;
  category: string | null;
  quantity: number;
  wood_type: string | null;
  /** 寬／長（cm） */
  dimension_w: number | null;
  /** 深（cm） */
  dimension_d: number | null;
  /** 高（cm） */
  dimension_h: number | null;
  notes: string | null;
}

export interface IntakeOrder {
  items: IntakeOrderItem[];
  /** 希望交期 YYYY-MM-DD */
  expected_delivery_date: string | null;
  notes: string | null;
}

export interface IntakeResult {
  customer: IntakeCustomer;
  order: IntakeOrder;
}

/** 單次貼上的文字上限（避免誤貼整份對話紀錄耗掉 AI 額度） */
export const INTAKE_TEXT_MAX_LENGTH = 8000;
const MAX_ITEMS = 30;

// ---------------------------------------------------------------------------
// AI 輸出清理
// ---------------------------------------------------------------------------

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function cleanPositiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanDate(v: unknown): string | null {
  const s = cleanString(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  // 排除 2026-02-30 這類不存在的日期（Date 會自動進位成下個月）
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

function cleanOption(v: unknown, options: readonly string[]): string | null {
  const s = cleanString(v);
  return s && options.includes(s) ? s : null;
}

function cleanContactMethod(v: unknown): string | null {
  const s = cleanString(v)?.toLowerCase();
  if (!s) return null;
  return CONTACT_METHOD_OPTIONS.find((o) => o.value.toLowerCase() === s)?.value ?? null;
}

function cleanTaxId(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  const digits = s.normalize("NFKC").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 把 AI 回傳的 JSON 清成可信的型別：選項外的值、格式不符的統編／日期一律改 null，數量至少 1 */
export function sanitizeIntakeResult(raw: unknown): IntakeResult {
  const root = asRecord(raw);
  const c = asRecord(root.customer);
  const o = asRecord(root.order);

  const customer: IntakeCustomer = {
    name: cleanString(c.name),
    contact_person: cleanString(c.contact_person),
    phone: cleanString(c.phone),
    delivery_address: cleanString(c.delivery_address),
    has_elevator: typeof c.has_elevator === "boolean" ? c.has_elevator : null,
    company: cleanString(c.company),
    tax_id: cleanTaxId(c.tax_id),
    brand_name: cleanString(c.brand_name),
    line_id: cleanString(c.line_id),
    ig_account: cleanString(c.ig_account),
    source: cleanOption(c.source, CUSTOMER_SOURCE_OPTIONS),
    customer_type: cleanOption(c.customer_type, CUSTOMER_TYPE_OPTIONS),
    contact_method: cleanContactMethod(c.contact_method),
    notes: cleanString(c.notes),
  };

  const rawItems = Array.isArray(o.items) ? o.items : [];
  const items: IntakeOrderItem[] = [];
  for (const entry of rawItems) {
    const it = asRecord(entry);
    const name = cleanString(it.name);
    if (!name) continue;
    const qty = cleanPositiveNumber(it.quantity);
    items.push({
      name,
      category: cleanOption(it.category, INTAKE_ITEM_CATEGORIES),
      quantity: qty != null ? Math.max(1, Math.round(qty)) : 1,
      wood_type: cleanString(it.wood_type),
      dimension_w: cleanPositiveNumber(it.dimension_w),
      dimension_d: cleanPositiveNumber(it.dimension_d),
      dimension_h: cleanPositiveNumber(it.dimension_h),
      notes: cleanString(it.notes),
    });
    if (items.length >= MAX_ITEMS) break;
  }

  return {
    customer,
    order: {
      items,
      expected_delivery_date: cleanDate(o.expected_delivery_date),
      notes: cleanString(o.notes),
    },
  };
}

// ---------------------------------------------------------------------------
// 正規化（比對用）
// ---------------------------------------------------------------------------

/** 全形轉半形、轉小寫、臺→台、去掉空白與常見標點 */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/臺/g, "台")
    .replace(/[\s\-_.,，。、・·()（）「」『』"'`~!！?？:：;；/\\|]/g, "");
}

/** 名稱比對鍵：去掉結尾的稱謂與公司型態（「陳小姐」→「陳」、「木木有限公司」→「木木」） */
export function normalizeNameKey(raw: string | null | undefined): string {
  const s = normalizeText(raw);
  const stripped = s.replace(/(股份有限公司|有限公司|企業社|工作室|商行|公司|先生|小姐|女士|太太)$/, "");
  return stripped || s;
}

/** LINE ID／IG 比對鍵：去掉開頭 @ 與 IG 網址前綴 */
export function normalizeHandle(raw: string | null | undefined): string {
  return normalizeText(
    (raw ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/^@+/, "")
  );
}

/** 地址比對鍵：去掉郵遞區號與「台灣」前綴 */
export function normalizeAddress(raw: string | null | undefined): string {
  return normalizeText(raw)
    .replace(/^\d{3,6}/, "")
    .replace(/^(台灣省?|taiwan)/, "")
    .replace(/^\d{3,6}/, "");
}

/**
 * 電話比對鍵（可能多支）：只留數字、+886 換回 0，取末 9 碼。
 * 0912-345-678、+886 912 345 678、0912345678 都得到 912345678；06-2345678 得到 062345678。
 */
export function phoneKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const text = raw
    .normalize("NFKC")
    // 去掉分機（#123、分機123、轉123、ext 123）
    .replace(/(#|分機|轉|ext\.?)\s*\d+/gi, "");
  const keys = new Set<string>();
  const addDigits = (digits: string) => {
    let d = digits;
    if (d.startsWith("886") && (d.length === 11 || d.length === 12)) d = `0${d.slice(3)}`;
    if (d.length >= 8 && d.length <= 10) keys.add(d.slice(-9));
  };
  for (const run of text.match(/\+?[\d()\-\s]{7,}/g) ?? []) {
    const digits = run.replace(/\D/g, "");
    if (digits.length <= 12) {
      addDigits(digits);
    } else {
      // 兩支號碼只用空白隔開時會黏成一串，改逐段判斷
      for (const piece of run.split(/\s+/)) addDigits(piece.replace(/\D/g, ""));
    }
  }
  return [...keys];
}

function taxIdKey(raw: string | null | undefined): string {
  const digits = (raw ?? "").normalize("NFKC").replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

// ---------------------------------------------------------------------------
// 既有客戶比對
// ---------------------------------------------------------------------------

/** 比對所需的客戶主檔欄位 */
export interface MatchableCustomer {
  id: string;
  name: string;
  alias?: string | null;
  contact_person?: string | null;
  brand_name?: string | null;
  company?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  line_id?: string | null;
  ig_account?: string | null;
  delivery_address?: string | null;
}

export type MatchReason =
  | "phone"
  | "tax_id"
  | "line_id"
  | "ig_account"
  | "name"
  | "address"
  | "name_partial";

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  phone: "電話相同",
  tax_id: "統編相同",
  line_id: "LINE 相同",
  ig_account: "IG 相同",
  name: "名稱相同",
  address: "地址相同",
  name_partial: "名稱相近",
};

const MATCH_REASON_SCORES: Record<MatchReason, number> = {
  phone: 100,
  tax_id: 100,
  line_id: 80,
  ig_account: 80,
  name: 50,
  address: 40,
  name_partial: 20,
};

/** 任一命中即視為「確定是同一人」；名稱／地址只算「可能相同」 */
const STRONG_REASONS: ReadonlySet<MatchReason> = new Set(["phone", "tax_id", "line_id", "ig_account"]);

export interface CustomerMatch<T extends MatchableCustomer> {
  customer: T;
  reasons: MatchReason[];
  /** 電話／統編／LINE／IG 任一相同 */
  strong: boolean;
  score: number;
}

type MatchInput = Pick<
  IntakeCustomer,
  | "name"
  | "contact_person"
  | "company"
  | "brand_name"
  | "phone"
  | "tax_id"
  | "line_id"
  | "ig_account"
  | "delivery_address"
>;

/** 名稱鍵至少 2 字才比對，避免「陳小姐」→「陳」配到所有姓陳的客戶 */
function nameKeys(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map(normalizeNameKey).filter((k) => k.length >= 2))];
}

/** 找出可能是同一位的既有客戶，依相似度排序（最多 limit 筆） */
export function findCustomerMatches<T extends MatchableCustomer>(
  input: Partial<MatchInput>,
  customers: T[],
  limit = 5
): CustomerMatch<T>[] {
  const inPhones = new Set(phoneKeys(input.phone));
  const inTaxId = taxIdKey(input.tax_id);
  const inLine = normalizeHandle(input.line_id);
  const inIg = normalizeHandle(input.ig_account);
  const inNames = nameKeys([input.name, input.contact_person, input.company, input.brand_name]);
  const inAddress = normalizeAddress(input.delivery_address);

  const matches: CustomerMatch<T>[] = [];
  for (const c of customers) {
    const reasons: MatchReason[] = [];
    if (inPhones.size > 0 && phoneKeys(c.phone).some((k) => inPhones.has(k))) reasons.push("phone");
    if (inTaxId && taxIdKey(c.tax_id) === inTaxId) reasons.push("tax_id");
    if (inLine && normalizeHandle(c.line_id) === inLine) reasons.push("line_id");
    if (inIg && normalizeHandle(c.ig_account) === inIg) reasons.push("ig_account");

    if (inNames.length > 0) {
      const cNames = nameKeys([c.name, c.alias, c.contact_person, c.company, c.brand_name]);
      if (cNames.some((k) => inNames.includes(k))) {
        reasons.push("name");
      } else if (
        cNames.some((ck) =>
          inNames.some((ik) => (ck.length < ik.length ? ik.includes(ck) : ck.includes(ik)))
        )
      ) {
        reasons.push("name_partial");
      }
    }

    // 地址太短（只有縣市區）不算
    if (inAddress.length >= 8 && normalizeAddress(c.delivery_address) === inAddress) {
      reasons.push("address");
    }

    if (reasons.length === 0) continue;
    matches.push({
      customer: c,
      reasons,
      strong: reasons.some((r) => STRONG_REASONS.has(r)),
      score: reasons.reduce((sum, r) => sum + MATCH_REASON_SCORES[r], 0),
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 既有客戶：可補上／可更新的欄位
// ---------------------------------------------------------------------------

/** 選既有客戶時可寫回主檔的欄位（不含客戶名稱：不改既有客戶的名字） */
export type IntakeUpdatableField =
  | "contact_person"
  | "phone"
  | "delivery_address"
  | "has_elevator"
  | "company"
  | "tax_id"
  | "brand_name"
  | "line_id"
  | "ig_account"
  | "source"
  | "customer_type"
  | "contact_method"
  | "notes";

export const INTAKE_FIELD_LABELS: Record<IntakeUpdatableField, string> = {
  contact_person: "聯絡人",
  phone: "電話",
  delivery_address: "地址",
  has_elevator: "電梯",
  company: "公司抬頭",
  tax_id: "統一編號",
  brand_name: "品牌名稱",
  line_id: "LINE ID",
  ig_account: "IG 帳號",
  source: "客戶來源",
  customer_type: "客戶種類",
  contact_method: "聯絡方式",
  notes: "客情備註",
};

export type ExistingCustomerFields = Partial<Record<IntakeUpdatableField, string | boolean | null>>;

export interface FieldUpdate {
  field: IntakeUpdatableField;
  /** fill＝主檔空白直接補上；change＝主檔已有不同值（預設不勾）；append＝客情備註附加在後 */
  kind: "fill" | "change" | "append";
  current: string | boolean | null;
  /** 勾選後寫回主檔的值 */
  next: string | boolean;
}

/** AI 推斷的欄位（來源／種類／聯絡方式）只在主檔空白時補，不建議覆蓋既有值 */
const GUESSED_FIELDS: ReadonlySet<IntakeUpdatableField> = new Set([
  "source",
  "customer_type",
  "contact_method",
]);

const UPDATE_ORDER: IntakeUpdatableField[] = [
  "contact_person",
  "phone",
  "delivery_address",
  "has_elevator",
  "company",
  "tax_id",
  "brand_name",
  "line_id",
  "ig_account",
  "source",
  "customer_type",
  "contact_method",
  "notes",
];

function sameValue(field: IntakeUpdatableField, a: string, b: string): boolean {
  switch (field) {
    case "phone": {
      const ka = phoneKeys(a);
      const kb = new Set(phoneKeys(b));
      // 新號碼全部已在主檔內＝相同（主檔可能記了多支）
      return ka.length > 0 ? ka.every((k) => kb.has(k)) : normalizeText(a) === normalizeText(b);
    }
    case "tax_id":
      return taxIdKey(a) === taxIdKey(b);
    case "line_id":
    case "ig_account":
      return normalizeHandle(a) === normalizeHandle(b);
    case "delivery_address":
      return normalizeAddress(a) === normalizeAddress(b);
    case "notes":
      return normalizeText(b).includes(normalizeText(a));
    default:
      return normalizeText(a) === normalizeText(b);
  }
}

/** 比較解析結果與既有客戶主檔，列出可補上或可更新的欄位 */
export function diffCustomerFields(
  existing: ExistingCustomerFields,
  parsed: Partial<Record<IntakeUpdatableField, string | boolean | null>>
): FieldUpdate[] {
  const updates: FieldUpdate[] = [];
  for (const field of UPDATE_ORDER) {
    const next = parsed[field];
    const current = existing[field] ?? null;

    if (field === "has_elevator") {
      // 主檔 has_elevator 為 NOT NULL DEFAULT false，false 分不出「無電梯」或「未填」，只把 true 當已填
      if (typeof next !== "boolean") continue;
      if (current === true) {
        if (!next) updates.push({ field, kind: "change", current, next });
      } else if (next) {
        updates.push({ field, kind: "fill", current: null, next });
      }
      continue;
    }

    const nextText = typeof next === "string" ? next.trim() : "";
    if (!nextText) continue;
    const currentText = typeof current === "string" ? current.trim() : "";
    if (!currentText) {
      updates.push({ field, kind: "fill", current: null, next: nextText });
      continue;
    }
    if (sameValue(field, nextText, currentText) || GUESSED_FIELDS.has(field)) continue;
    if (field === "notes") {
      updates.push({ field, kind: "append", current: currentText, next: `${currentText}\n${nextText}` });
    } else {
      updates.push({ field, kind: "change", current: currentText, next: nextText });
    }
  }
  return updates;
}
