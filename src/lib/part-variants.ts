/** 零件兩層模型共用工具：材質對應、SKU 產生、BOM resolve（與 DB trigger work_orders_auto_deduct_parts 同語義） */

import { supabase } from "@/lib/supabase";
import {
  PART_CATEGORIES,
  seriesCodeFromName,
  type BomLineRow,
  type BomLineType,
  type MaterialRow,
} from "@/types/inventory";

export async function fetchMaterials(): Promise<MaterialRow[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("code, name_zh, aliases, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message || "無法載入材質對照表");
  return (data as MaterialRow[]) ?? [];
}

/** 訂單/產品 wood_type → 材質代碼：name_zh 完全相符或 aliases 包含（煙燻白橡木→O）；未知回 null */
export function resolveMaterialCode(
  woodType: string | null | undefined,
  materials: MaterialRow[],
): string | null {
  const t = (woodType ?? "").trim();
  if (!t) return null;
  for (const m of materials) {
    if (m.name_zh === t || (m.aliases ?? []).includes(t)) return m.code;
  }
  return null;
}

/** spec1 尾碼字母（布墊-F → F）；無尾碼回 null。與 trigger 的 regexp_replace 同語義 */
export function specKeyFromSpec1(spec1: string | null | undefined): string | null {
  const t = (spec1 ?? "").trim();
  if (!t) return null;
  const idx = t.lastIndexOf("-");
  const key = idx >= 0 ? t.slice(idx + 1) : "";
  return key || null;
}

/** SKU 產生規則：{系列碼}-{材質碼}-{name_code}，無材質段省略中段。唯讀，不開放人工修改 */
export function buildSku(args: {
  seriesName: string | null;
  materialCode: string | null;
  nameCode: string | null;
  fallbackName: string;
}): string {
  const seg: string[] = [];
  const sc = args.seriesName ? seriesCodeFromName(args.seriesName) : "";
  if (sc) seg.push(sc);
  if (args.materialCode) seg.push(args.materialCode);
  seg.push((args.nameCode ?? "").trim() || args.fallbackName.trim());
  return seg.join("-");
}

/** 依座墊互斥規則過濾出本次適用的 BOM 線（exclusive_key null＝永遠列入） */
export function applicableBomLines<T extends Pick<BomLineRow, "exclusive_key">>(
  lines: T[],
  specKey: string | null,
): T[] {
  return lines.filter((l) => l.exclusive_key == null || l.exclusive_key === specKey);
}

/** 產品規格 resolve 後的用料一列 */
export interface ResolvedBomItem {
  key: string;
  partName: string;
  category: string;
  quantity: number;
  unit: string;
  lineType: BomLineType;
  /** 依 spec1 尾碼列入的線才有值；null＝不分規格一律列入 */
  exclusiveKey: string | null;
  /** 實際會扣帳的零件變體 SKU；隨單材質線缺變體時為 null */
  sku: string | null;
  /** 缺變體時的說明，例如「缺 O 材質變體」 */
  missingNote: string | null;
}

interface BomLineForResolve {
  id: string;
  line_type: BomLineType;
  part_id: string | null;
  part_variant_id: string | null;
  quantity: number;
  unit: string | null;
  exclusive_key: string | null;
  parts: { name: string; category: string; unit: string; deleted_at: string | null } | null;
  part_variants: {
    sku: string;
    deleted_at: string | null;
    parts: { name: string; category: string; unit: string; deleted_at: string | null } | null;
  } | null;
}

/**
 * 依產品規格的木種與座墊代碼展開系列 BOM，與 DB trigger work_orders_auto_deduct_parts 同語義。
 * 供規格總覽顯示用料組成；查詢失敗回空陣列，不影響其他欄位呈現。
 */
export async function resolveVariantBom(args: {
  seriesId: string;
  woodType?: string | null;
  spec1?: string | null;
}): Promise<ResolvedBomItem[]> {
  if (!args.seriesId) return [];
  const [linesRes, materials] = await Promise.all([
    supabase
      .from("bom_lines")
      .select(
        "id, line_type, part_id, part_variant_id, quantity, unit, exclusive_key, " +
          "parts!part_id(name, category, unit, deleted_at), " +
          "part_variants!part_variant_id(sku, deleted_at, parts!part_id(name, category, unit, deleted_at))",
      )
      .eq("series_id", args.seriesId)
      .order("created_at"),
    fetchMaterials().catch(() => [] as MaterialRow[]),
  ]);
  if (linesRes.error) return [];

  const all = ((linesRes.data as unknown as BomLineForResolve[]) ?? []).filter((l) =>
    l.line_type === "by_material"
      ? l.parts != null && !l.parts.deleted_at
      : l.part_variants != null && !l.part_variants.deleted_at && !l.part_variants.parts?.deleted_at,
  );
  const lines = applicableBomLines(all, specKeyFromSpec1(args.spec1));
  if (lines.length === 0) return [];

  // 隨單材質線的 part_id × 材質代碼 → SKU
  const matCode = resolveMaterialCode(args.woodType, materials);
  const partIds = [...new Set(lines.filter((l) => l.line_type === "by_material").map((l) => l.part_id).filter(Boolean))] as string[];
  const skuByPartMaterial = new Map<string, string>();
  if (partIds.length > 0) {
    const { data } = await supabase
      .from("part_variants")
      .select("part_id, material_code, sku")
      .in("part_id", partIds)
      .is("deleted_at", null);
    for (const v of data ?? []) {
      skuByPartMaterial.set(`${v.part_id}:${v.material_code ?? ""}`, v.sku);
    }
  }

  const items: ResolvedBomItem[] = lines.map((l) => {
    const part = l.line_type === "by_material" ? l.parts : l.part_variants?.parts ?? null;
    let sku: string | null;
    let missingNote: string | null = null;
    if (l.line_type === "fixed") {
      sku = l.part_variants?.sku ?? null;
    } else {
      sku = l.part_id ? skuByPartMaterial.get(`${l.part_id}:${matCode ?? ""}`) ?? null : null;
      if (!sku) {
        missingNote = matCode
          ? `缺 ${matCode} 材質變體`
          : `無法對應木種「${(args.woodType ?? "").trim() || "未指定"}」`;
      }
    }
    return {
      key: l.id,
      partName: part?.name ?? "（零件已刪除）",
      category: part?.category ?? "其他",
      quantity: Number(l.quantity),
      unit: l.unit || part?.unit || "—",
      lineType: l.line_type,
      exclusiveKey: l.exclusive_key,
      sku,
      missingNote,
    };
  });

  const catRank = (c: string) => {
    const i = (PART_CATEGORIES as readonly string[]).indexOf(c);
    return i < 0 ? PART_CATEGORIES.length : i;
  };
  return items.sort(
    (a, b) => catRank(a.category) - catRank(b.category) || a.partName.localeCompare(b.partName, "zh-Hant"),
  );
}

/** 常用座墊互斥代碼建議（spec1 尾碼）；自由輸入，不限於此清單 */
export const EXCLUSIVE_KEY_SUGGESTIONS: { key: string; label: string }[] = [
  { key: "F", label: "布墊-F" },
  { key: "L", label: "皮墊-L（預留）" },
  { key: "W", label: "實木-W" },
  { key: "P", label: "紙繩-P" },
  { key: "R", label: "藤編-R" },
];
