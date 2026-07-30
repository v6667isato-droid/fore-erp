import { supabase } from "@/lib/supabase";

/** 廠商主類別群組（vendor_category_groups 表）；subcategories 存 vendors.main_category 值 */
export interface VendorCategoryGroup {
  id: string;
  name: string;
  subcategories: string[];
  sort_order: number;
}

/** 篩選下拉的主類別選項值前綴：`__group:{id}` 代表「該主類別底下全部副類別」 */
export const GROUP_FILTER_PREFIX = "__group:";

export async function fetchVendorCategoryGroups(): Promise<VendorCategoryGroup[]> {
  const { data, error } = await supabase
    .from("vendor_category_groups")
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
export function groupVendorCategories(
  categories: string[],
  groups: VendorCategoryGroup[],
): { grouped: { group: VendorCategoryGroup; categories: string[] }[]; ungrouped: string[] } {
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

/** 查某副類別所屬的主類別名稱；未分組回傳 null */
export function findGroupName(category: string, groups: VendorCategoryGroup[]): string | null {
  if (!category) return null;
  return groups.find((g) => g.subcategories.includes(category))?.name ?? null;
}
