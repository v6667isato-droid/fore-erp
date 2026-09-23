import { normalizeText, type IntakeOrderItem } from "@/lib/customer-intake";

/**
 * 貼上建立訂單：把 AI 解析出的品項對應到規格庫（product_variants）。
 * 用程式規則比對（產品編號 → 系列 → 木種／尺寸），結果可預期、可測試：
 * - 找到唯一規格 → 帶入該規格（訂製款規格可帶入手動價格與尺寸）
 * - 只確定系列、規格有多個可能 → 帶入系列，由使用者挑規格
 * - 連系列都對不到 → 呼叫端改用「客製家具」品項
 */

/** 比對所需的規格欄位（orders/types 的 VariantOption 即符合） */
export interface MatchableVariant {
  id: string;
  series_id: string;
  series_name: string;
  product_code?: string | null;
  label: string;
  spec1?: string | null;
  wood_type?: string | null;
  dimension_w?: number | null;
  dimension_d?: number | null;
  dimension_h?: number | null;
  is_custom_order?: boolean;
  is_deleted?: boolean;
}

export type IntakeVariantMatch<V extends MatchableVariant> =
  /** customOrder＝對到系列的訂製款規格（牌價、尺寸以訊息為準） */
  | { kind: "variant"; variant: V; customOrder: boolean }
  /** 系列確定、規格不確定 */
  | { kind: "series"; series_id: string; series_name: string };

/** 編號比對鍵：全形轉半形、大寫、去掉空白與連字號（CH03-A → CH03A） */
function codeKey(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").toUpperCase().replace(/[\s\-_－—]/g, "");
}

/** 系列編號：系列名稱第一段（「CB05 電視櫃/邊櫃 Flow」→ CB05）；需含英數字才算編號 */
function seriesCodeKey(seriesName: string): string {
  const first = seriesName.trim().split(/\s+/)[0] ?? "";
  return /[A-Za-z0-9]/.test(first) ? codeKey(first) : "";
}

/** 系列名稱中的英文品名（「CB05 電視櫃/邊櫃 Flow」→ flow、「ST01 高腳椅 Sushi An」→ sushi an） */
function seriesLatinName(seriesName: string): string {
  const rest = seriesName.trim().split(/\s+/).slice(1).join(" ");
  const latin = rest
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return latin.length >= 3 ? latin : "";
}

/** 木種比對鍵：去掉「木」「白」（胡桃＝胡桃木、橡木＝白橡木，但煙燻白橡木仍與白橡木不同） */
function woodKey(raw: string | null | undefined): string {
  return normalizeText(raw).replace(/[木白]/g, "");
}

/** 訊息中像產品編號的片段（CB05、CH03-A、TB01-W-W180D85） */
const CODE_PATTERN = /[A-Za-z]{2,}\d+[A-Za-z0-9-]*/g;

function sameDim(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.5;
}

interface SeriesRef {
  id: string;
  name: string;
}

function findSeries<V extends MatchableVariant>(item: IntakeOrderItem, active: V[]): SeriesRef | null {
  const series = new Map<string, SeriesRef>();
  for (const v of active) {
    if (v.series_id && !series.has(v.series_id)) series.set(v.series_id, { id: v.series_id, name: v.series_name });
  }
  const list = [...series.values()];

  // 1. 產品編號：取最長的系列編號前綴（CH03A… 對 CH03-A 而非 CH03；CB05W150H90 對 CB05）
  const codes = [item.product_code, ...(item.name.match(CODE_PATTERN) ?? [])]
    .map(codeKey)
    .filter((k) => k.length >= 3);
  for (const code of codes) {
    let best: SeriesRef | null = null;
    let bestLen = 0;
    for (const s of list) {
      const key = seriesCodeKey(s.name);
      if (key && code.startsWith(key) && key.length > bestLen) {
        best = s;
        bestLen = key.length;
      }
    }
    if (best) return best;
  }

  // 2. 品名含系列的英文名（Flow、Sushi An）或完整系列名稱（沒有編號的系列，如「大板桌」）
  const text = normalizeText(`${item.product_code ?? ""} ${item.name} ${item.notes ?? ""}`);
  const hits = list.filter((s) => {
    const latin = seriesLatinName(s.name);
    if (latin && text.includes(normalizeText(latin))) return true;
    return !seriesCodeKey(s.name) && text.includes(normalizeText(s.name));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** 把一個解析品項對應到規格庫；對不到系列回傳 null */
export function matchIntakeItem<V extends MatchableVariant>(
  item: IntakeOrderItem,
  variants: V[]
): IntakeVariantMatch<V> | null {
  const active = variants.filter((v) => !v.is_deleted);

  // 完整產品編號（CB05-W-150H90、CB05-C）直接對到規格
  const fullCode = codeKey(item.product_code);
  if (fullCode) {
    const exact = active.find((v) => codeKey(v.product_code) === fullCode);
    if (exact) return { kind: "variant", variant: exact, customOrder: exact.is_custom_order === true };
  }

  const series = findSeries(item, active);
  if (!series) return null;
  const inSeries = active.filter((v) => v.series_id === series.id);
  const customVariant = inSeries.find((v) => v.is_custom_order);
  const seriesOnly: IntakeVariantMatch<V> = { kind: "series", series_id: series.id, series_name: series.name };

  if (item.custom_made) {
    return customVariant ? { kind: "variant", variant: customVariant, customOrder: true } : seriesOnly;
  }

  const itemWood = woodKey(item.wood_type);
  const hasDims = item.dimension_w != null || item.dimension_d != null || item.dimension_h != null;
  const candidates = inSeries.filter((v) => {
    if (v.is_custom_order) return false;
    if (itemWood && woodKey(v.wood_type) !== itemWood) return false;
    // 訊息有寫的尺寸都要相同（規格沒填該尺寸則不擋）
    const dims: [number | null, number | null | undefined][] = [
      [item.dimension_w, v.dimension_w],
      [item.dimension_d, v.dimension_d],
      [item.dimension_h, v.dimension_h],
    ];
    return dims.every(([want, has]) => want == null || has == null || sameDim(want, has));
  });

  if (candidates.length === 1) return { kind: "variant", variant: candidates[0], customOrder: false };

  if (candidates.length === 0) {
    // 有指定木種／尺寸卻沒有現成規格＝訂製
    if ((itemWood || hasDims) && customVariant) return { kind: "variant", variant: customVariant, customOrder: true };
    return seriesOnly;
  }

  // 多個候選：以規格說明（藤編、紙繩、有靠背…）出現在訊息中的最多者為準，平手則交給使用者挑
  const text = normalizeText(`${item.name} ${item.notes ?? ""}`);
  const scored = candidates.map((v) => {
    const words = (v.spec1 ?? "").split(/[-\s/]+/).map(normalizeText).filter((w) => w.length >= 2);
    return { v, score: words.filter((w) => text.includes(w)).length };
  });
  const top = Math.max(...scored.map((x) => x.score));
  const best = scored.filter((x) => x.score === top);
  return top > 0 && best.length === 1 ? { kind: "variant", variant: best[0].v, customOrder: false } : seriesOnly;
}
