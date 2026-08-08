import {
  assignCategoryToGroupIn,
  fetchCategoryGroups,
  type CategoryGroup,
} from "@/lib/category-groups";

export {
  GROUP_FILTER_PREFIX,
  findGroupName,
  groupCategories as groupMaterialCategories,
  categoryFilterMatches as materialCategoryFilterMatches,
} from "@/lib/category-groups";

/** 採購物料主類別群組（material_category_groups 表）；subcategories 存 procurement_materials.item_category 值 */
export type MaterialCategoryGroup = CategoryGroup;

export const MATERIAL_CATEGORY_GROUP_TABLE = "material_category_groups" as const;

export function fetchMaterialCategoryGroups(): Promise<MaterialCategoryGroup[]> {
  return fetchCategoryGroups(MATERIAL_CATEGORY_GROUP_TABLE);
}

/** 把物料副類別歸入指定主類別（維持單一歸屬）；groupId 空字串 = 未分類。回傳錯誤訊息或 null */
export function assignMaterialCategoryToGroup(category: string, groupId: string): Promise<string | null> {
  return assignCategoryToGroupIn(MATERIAL_CATEGORY_GROUP_TABLE, category, groupId);
}
