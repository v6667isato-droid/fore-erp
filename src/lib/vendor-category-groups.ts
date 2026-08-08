import {
  assignCategoryToGroupIn,
  fetchCategoryGroups,
  type CategoryGroup,
} from "@/lib/category-groups";

export {
  GROUP_FILTER_PREFIX,
  findGroupName,
  groupCategories as groupVendorCategories,
  categoryFilterMatches as vendorCategoryFilterMatches,
} from "@/lib/category-groups";

/** 廠商主類別群組（vendor_category_groups 表）；subcategories 存 vendors.main_category 值 */
export type VendorCategoryGroup = CategoryGroup;

export const VENDOR_CATEGORY_GROUP_TABLE = "vendor_category_groups" as const;

export function fetchVendorCategoryGroups(): Promise<VendorCategoryGroup[]> {
  return fetchCategoryGroups(VENDOR_CATEGORY_GROUP_TABLE);
}

/** 把副類別歸入指定主類別（維持單一歸屬）；groupId 空字串 = 未分類。回傳錯誤訊息或 null */
export function assignCategoryToGroup(category: string, groupId: string): Promise<string | null> {
  return assignCategoryToGroupIn(VENDOR_CATEGORY_GROUP_TABLE, category, groupId);
}
