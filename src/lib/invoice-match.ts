import type { ProcurementMaterialRow } from "@/types/procurement";

/** vendor_item_aliases 資料列 */
export interface VendorItemAlias {
  vendor_name: string;
  alias_text: string;
  material_id: string;
}

/** 品名正規化：小寫、全形轉半形、去空白與標點，供比對與 alias 儲存 */
export function normalizeItemText(raw: string): string {
  let s = raw.trim().toLowerCase();
  // 全形英數與標點轉半形
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // 去空白與常見分隔符
  s = s.replace(/[\s　·・.,，、。;；:：|/\\()（）\[\]【】<>《》\-—_*#]+/g, "");
  return s;
}

export type MatchSource = "alias" | "exact" | "fuzzy";

export interface MaterialMatch {
  materialId: string;
  source: MatchSource;
  /** fuzzy 時的相似度 0~1；alias/exact 為 1 */
  score: number;
}

/** 字元 bigram 集合（中文品名比對用；不足 2 字時退回單字元） */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

/** Dice 係數相似度 */
function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const g of setA) {
    if (setB.has(g)) overlap++;
  }
  return (2 * overlap) / (setA.size + setB.size);
}

const FUZZY_THRESHOLD = 0.45;

/** 兩段文字的相似度（正規化後 bigram Dice；包含關係加權至少 0.8），供廠商名等模糊建議 */
export function textSimilarity(a: string, b: string): number {
  const ka = normalizeItemText(a);
  const kb = normalizeItemText(b);
  if (!ka || !kb) return 0;
  let score = diceSimilarity(ka, kb);
  if (ka.includes(kb) || kb.includes(ka)) score = Math.max(score, 0.8);
  return score;
}

/**
 * 為辨識出的品名找對應料號：
 * 1. 同廠商 alias 記憶（完全比對正規化品名）
 * 2. 不限廠商 alias
 * 3. 物料主檔品名完全比對
 * 4. 模糊比對（品名＋規格 bigram 相似度；含包含關係加權）
 */
export function matchMaterial(
  rawName: string,
  vendorName: string,
  materials: ProcurementMaterialRow[],
  aliases: VendorItemAlias[],
): MaterialMatch | null {
  const key = normalizeItemText(rawName);
  if (!key) return null;
  const vendorKey = vendorName.trim();

  const materialIds = new Set(materials.map((m) => m.id));

  const vendorAlias = aliases.find(
    (a) => a.vendor_name === vendorKey && a.alias_text === key && materialIds.has(a.material_id),
  );
  if (vendorAlias) return { materialId: vendorAlias.material_id, source: "alias", score: 1 };

  const anyAlias = aliases.find((a) => a.alias_text === key && materialIds.has(a.material_id));
  if (anyAlias) return { materialId: anyAlias.material_id, source: "alias", score: 1 };

  for (const m of materials) {
    if (normalizeItemText(m.name) === key) {
      return { materialId: m.id, source: "exact", score: 1 };
    }
  }

  let best: MaterialMatch | null = null;
  for (const m of materials) {
    const nameKey = normalizeItemText(m.name);
    const nameSpecKey = normalizeItemText(`${m.name}${m.spec ?? ""}${m.spec2 ?? ""}`);
    let score = Math.max(diceSimilarity(key, nameKey), diceSimilarity(key, nameSpecKey));
    // 一方完整包含另一方時給予加權（如「白橡木板」vs「白橡木板 18mm」）
    if (nameKey && (key.includes(nameKey) || nameKey.includes(key))) {
      score = Math.max(score, 0.8);
    }
    if (score > (best?.score ?? FUZZY_THRESHOLD)) {
      best = { materialId: m.id, source: "fuzzy", score };
    }
  }
  return best;
}
