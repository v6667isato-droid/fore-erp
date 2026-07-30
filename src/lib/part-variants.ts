/** 零件兩層模型共用工具：材質對應、SKU 產生、BOM resolve（與 DB trigger work_orders_auto_deduct_parts 同語義） */

import { supabase } from "@/lib/supabase";
import {
  seriesCodeFromName,
  type BomLineRow,
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

/** 常用座墊互斥代碼建議（spec1 尾碼）；自由輸入，不限於此清單 */
export const EXCLUSIVE_KEY_SUGGESTIONS: { key: string; label: string }[] = [
  { key: "F", label: "布墊-F" },
  { key: "L", label: "皮墊-L（預留）" },
  { key: "W", label: "實木-W" },
  { key: "P", label: "紙繩-P" },
  { key: "R", label: "藤編-R" },
];
