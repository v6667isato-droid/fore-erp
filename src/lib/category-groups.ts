import { supabase } from "@/lib/supabase";

/** 放主類別群組的資料表；兩張表結構相同（name / subcategories / sort_order） */
export type CategoryGroupTable = "vendor_category_groups" | "material_category_groups";

/** 主類別群組；subcategories 存主檔的類別文字（廠商＝vendors.main_category、物料＝procurement_materials.item_category） */
export interface CategoryGroup {
  id: string;
  name: string;
  subcategories: string[];
  sort_order: number;
}

/** 篩選下拉的主類別選項值前綴：`__group:{id}` 代表「該主類別底下全部副類別」 */
export const GROUP_FILTER_PREFIX = "__group:";

export async function fetchCategoryGroups(table: CategoryGroupTable): Promise<CategoryGroup[]> {
  const { data, error } = await supabase
    .from(table)
    .select("id, name, subcategories, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    subcategories: Array.isArray(r.subcategories) ? r.subcategories.map(String) : [],
    sort_order: Number(r.sort_order) || 0,
  }));
}

/** 把既有類別清單依主類別群組分組；不屬於任何主類別的歸入 ungrouped */
export function groupCategories(
  categories: string[],
  groups: CategoryGroup[],
): { grouped: { group: CategoryGroup; categories: string[] }[]; ungrouped: string[] } {
  const assigned = new Set<string>();
  const grouped = groups.map((group) => {
    const cats = categories
      .filter((c) => group.subcategories.includes(c))
      .sort((a, b) => a.localeCompare(b));
    cats.forEach((c) => assigned.add(c));
    return { group, categories: cats };
  });
  const ungrouped = categories.filter((c) => !assigned.has(c)).sort((a, b) => a.localeCompare(b));
  return { grouped, ungrouped };
}

/** 篩選值是否匹配某副類別：支援 __group:{id}（整個主類別）與一般類別值；空值＝不篩選 */
export function categoryFilterMatches(
  filterValue: string,
  category: string,
  groups: CategoryGroup[],
): boolean {
  if (!filterValue) return true;
  if (filterValue.startsWith(GROUP_FILTER_PREFIX)) {
    const groupId = filterValue.slice(GROUP_FILTER_PREFIX.length);
    return groups.find((g) => g.id === groupId)?.subcategories.includes(category) ?? false;
  }
  return category === filterValue;
}

/** 把副類別歸入指定主類別（會自動從其他主類別移除，維持單一歸屬）；groupId 空字串 = 改為未分類。回傳錯誤訊息或 null */
export async function assignCategoryToGroupIn(
  table: CategoryGroupTable,
  category: string,
  groupId: string,
): Promise<string | null> {
  const cat = category.trim();
  if (!cat) return null;
  const { data, error } = await supabase.from(table).select("id, subcategories");
  if (error || !data) return error?.message ?? "讀取主類別失敗";
  for (const row of data) {
    const subs = Array.isArray(row.subcategories) ? row.subcategories.map(String) : [];
    const isTarget = String(row.id) === groupId;
    const has = subs.includes(cat);
    const next = isTarget ? (has ? null : [...subs, cat]) : has ? subs.filter((s) => s !== cat) : null;
    if (next) {
      const { error: updateError } = await supabase
        .from(table)
        .update({ subcategories: next })
        .eq("id", row.id);
      if (updateError) return updateError.message;
    }
  }
  return null;
}

/** 查某副類別所屬的主類別名稱；未分組回傳 null */
export function findGroupName(category: string, groups: CategoryGroup[]): string | null {
  if (!category) return null;
  return groups.find((g) => g.subcategories.includes(category))?.name ?? null;
}
