import {
  normalizeAddress,
  normalizeHandle,
  normalizeText,
  phoneKeys,
  type IntakeCustomer,
} from "@/lib/customer-intake";

/**
 * 貼上建立：員工修正 AI 解析結果後的「學習」。
 *
 * 省用量的做法：
 * - 不保存、不重送整段範例；修正當下由 AI 濃縮成一句通用規則，之後解析只帶規則清單（已學會的範例不再使用）
 * - 只把「訊息裡看得到」的修正送去學（員工另外補充的電話、議價改價等不是解析錯誤，程式先濾掉，不呼叫 AI）
 * - AI 判斷既有規則已涵蓋就不新增；解析時最多帶 MAX_PROMPT_RULES 條（新→舊）
 */

/** 解析時最多帶入幾條規則（每條一句話，約數十 token） */
export const MAX_PROMPT_RULES = 40;

/** 一筆修正：欄位、AI（或自動帶入）的值 → 員工最後的值；null＝空白 */
export interface IntakeDiff {
  field: string;
  before: string | null;
  after: string | null;
}

function textValue(v: string | number | boolean | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "是" : "否";
  const s = String(v).trim();
  return s ? s : null;
}

/** 值是否出現在原始訊息中（文字比對忽略全半形、空白與標點；數字比對忽略千分位） */
export function mentionedInText(value: string, text: string): boolean {
  const plain = value.normalize("NFKC").replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(plain)) {
    // 數字要整段相同（「95%」裡的 5、「45」裡的 5 都不算）
    const runs: string[] = text.normalize("NFKC").replace(/,/g, "").match(/\d+(\.\d+)?/g) ?? [];
    return runs.includes(plain);
  }
  const v = normalizeText(value);
  return v !== "" && normalizeText(text).includes(v);
}

/**
 * 推斷型欄位（值不會原樣出現在訊息中）：AI 有填但填錯一定學；AI 留白、員工補上時，
 * 訊息裡要有相關字眼才學（否則是員工例行補資料，例如新客戶必填的客戶種類，不是解析錯誤）。
 * hint 為 true＝不需字眼（例如客戶來源常以「展覽」「朋友介紹」等出現）。
 */
type BlankHint = true | ((text: string) => boolean);

const keywordHint =
  (pattern: RegExp): BlankHint =>
  (text) =>
    pattern.test(text.normalize("NFKC"));

/** 訊息裡有提到這個日期（12/30、12月30、12.30…） */
function dateHint(date: string | null): BlankHint {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return () => false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return keywordHint(new RegExp(`(^|\\D)0?${month}\\s*[/月.\\-]\\s*0?${day}(?!\\d)`));
}

/**
 * 修正是否值得學：
 * - 推斷型欄位（inferred）：AI 填錯就學；AI 留白則看 blankHint
 * - 其他欄位：清空（AI 多抓）或新值出現在訊息中才算；新值訊息裡沒有＝員工另外補充，不是解析錯誤
 */
function worthLearning(
  before: string | null,
  after: string | null,
  text: string,
  inferred: false | { blankHint?: BlankHint }
): boolean {
  if (inferred) {
    if (before != null) return true;
    const hint = inferred.blankHint;
    return hint === true || (typeof hint === "function" && hint(text));
  }
  return after == null || mentionedInText(after, text);
}

// ---------------------------------------------------------------------------
// 客戶欄位
// ---------------------------------------------------------------------------

type CustomerField = Exclude<keyof IntakeCustomer, "notes">;

const CUSTOMER_FIELDS: { key: CustomerField; label: string; inferred?: { blankHint?: BlankHint } }[] = [
  { key: "name", label: "客戶名稱" },
  { key: "contact_person", label: "聯絡人" },
  { key: "phone", label: "電話" },
  { key: "delivery_address", label: "地址" },
  { key: "has_elevator", label: "有電梯", inferred: { blankHint: keywordHint(/電梯|樓梯/) } },
  { key: "company", label: "公司抬頭" },
  { key: "tax_id", label: "統一編號" },
  { key: "brand_name", label: "品牌名稱" },
  { key: "line_id", label: "LINE ID" },
  { key: "ig_account", label: "IG 帳號" },
  { key: "source", label: "客戶來源", inferred: { blankHint: true } },
  {
    key: "customer_type",
    label: "客戶種類",
    inferred: { blankHint: keywordHint(/設計|建築|餐廳|咖啡|政府|機關|學校|工廠|代工|通路|經銷/) },
  },
  {
    key: "contact_method",
    label: "聯絡方式",
    inferred: { blankHint: keywordHint(/line|ig|instagram|fb|facebook|臉書|email|e-mail|信箱|私訊/i) },
  },
];

function sameCustomerValue(key: CustomerField, a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  switch (key) {
    case "phone": {
      const ka = phoneKeys(a);
      const kb = phoneKeys(b);
      return ka.length > 0 && ka.length === kb.length ? ka.every((k) => kb.includes(k)) : normalizeText(a) === normalizeText(b);
    }
    case "delivery_address":
      return normalizeAddress(a) === normalizeAddress(b);
    case "line_id":
    case "ig_account":
      return normalizeHandle(a) === normalizeHandle(b);
    default:
      return normalizeText(a) === normalizeText(b);
  }
}

/** 確認畫面中，員工改過 AI 解析的客戶欄位（客情備註屬自由描述，不列入） */
export function diffIntakeCustomer(text: string, ai: IntakeCustomer, final: IntakeCustomer): IntakeDiff[] {
  const diffs: IntakeDiff[] = [];
  for (const { key, label, inferred } of CUSTOMER_FIELDS) {
    const before = textValue(ai[key]);
    const after = textValue(final[key]);
    if (sameCustomerValue(key, before, after)) continue;
    if (!worthLearning(before, after, text, inferred ?? false)) continue;
    diffs.push({ field: label, before, after });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// 訂單內容
// ---------------------------------------------------------------------------

/** 訂單品項快照（自動帶入當下與儲存當下各拍一次，比對員工改了什麼） */
export interface IntakeSnapshotItem {
  /** 訂單表單品項 id（同一品項兩次快照相同） */
  ref: string;
  /** 規格產品編號／「系列：XX（未選規格）」／客製品名 */
  product: string | null;
  quantity: number;
  /** 結算單價（通路價格優先，否則牌價） */
  unit_price: number | null;
  wood_type: string | null;
  /** 「W×D×H」 */
  dimensions: string | null;
  notes: string | null;
}

export interface IntakeOrderSnapshot {
  items: IntakeSnapshotItem[];
  expected_delivery_date: string | null;
  discount_percent: number | null;
  /** 訂金占折扣後金額的比例（%，四捨五入）；未帶入訂金為 null */
  deposit_percent: number | null;
  shipping_fee: number | null;
  notes: string | null;
}

export function formatDimensions(
  w: number | null | undefined,
  d: number | null | undefined,
  h: number | null | undefined
): string | null {
  const dims = [w, d, h];
  return dims.some((x) => x != null && Number(x) > 0) ? dims.map((x) => (x != null && Number(x) > 0 ? x : "—")).join("×") : null;
}

function sameText(a: string | null, b: string | null): boolean {
  return normalizeText(a) === normalizeText(b);
}

/** 自動帶入的訂單 vs 員工儲存的訂單，列出值得學的差異 */
export function diffIntakeOrder(text: string, draft: IntakeOrderSnapshot, final: IntakeOrderSnapshot): IntakeDiff[] {
  const diffs: IntakeDiff[] = [];
  const push = (
    field: string,
    before: string | null,
    after: string | null,
    inferred: false | { blankHint?: BlankHint }
  ) => {
    if (before === after) return;
    if (worthLearning(before, after, text, inferred)) diffs.push({ field, before, after });
  };
  const always = { blankHint: true } as const;

  const finalByRef = new Map(final.items.map((it) => [it.ref, it]));
  draft.items.forEach((d, i) => {
    const label = `品項${i + 1}（${d.product ?? "未命名"}）`;
    const f = finalByRef.get(d.ref);
    if (!f) {
      diffs.push({ field: `${label}`, before: "有此品項", after: "員工刪除" });
      return;
    }
    if (!sameText(d.product, f.product)) push(`${label}品項`, d.product, f.product, always);
    if (d.quantity !== f.quantity) push(`${label}數量`, String(d.quantity), String(f.quantity), always);
    if (d.unit_price !== f.unit_price) push(`${label}單價`, textValue(d.unit_price), textValue(f.unit_price), false);
    if (!sameText(d.wood_type, f.wood_type)) push(`${label}木種`, d.wood_type, f.wood_type, false);
    if (d.dimensions !== f.dimensions) push(`${label}尺寸`, d.dimensions, f.dimensions, false);
    if (!sameText(d.notes, f.notes)) push(`${label}備註`, d.notes, f.notes, false);
  });
  const draftRefs = new Set(draft.items.map((it) => it.ref));
  for (const f of final.items) {
    if (draftRefs.has(f.ref) || !f.product) continue;
    // 員工新增的品項：訊息裡有提到才算 AI 漏抓
    const codePart = f.product.split("-")[0];
    if (mentionedInText(f.product, text) || (codePart.length >= 2 && mentionedInText(codePart, text))) {
      diffs.push({ field: "新增品項", before: null, after: f.product });
    }
  }

  if (draft.expected_delivery_date !== final.expected_delivery_date) {
    push("希望交期", draft.expected_delivery_date, final.expected_delivery_date, {
      blankHint: dateHint(final.expected_delivery_date),
    });
  }
  if (draft.discount_percent !== final.discount_percent) {
    push("折扣 %", textValue(draft.discount_percent), textValue(final.discount_percent), {
      blankHint: keywordHint(/折|優惠|%|off/i),
    });
  }
  if (draft.deposit_percent !== final.deposit_percent) {
    push("訂金比例 %", textValue(draft.deposit_percent), textValue(final.deposit_percent), {
      blankHint: keywordHint(/訂金|定金/),
    });
  }
  if (draft.shipping_fee !== final.shipping_fee) {
    push("運費", textValue(draft.shipping_fee), textValue(final.shipping_fee), false);
  }
  if (!sameText(draft.notes, final.notes)) push("訂單備註", draft.notes, final.notes, false);
  return diffs;
}

/** 解析 prompt 中的「學到的規則」段落；沒有規則回傳空字串 */
export function formatRulesForPrompt(rules: string[]): string {
  const list = rules.map((r) => r.trim()).filter(Boolean).slice(0, MAX_PROMPT_RULES);
  if (list.length === 0) return "";
  return `\n員工修正後學到的規則（與上方規則衝突時以這些為準）：\n${list.map((r) => `- ${r}`).join("\n")}\n`;
}
