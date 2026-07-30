"use client";

import { Fragment, useMemo } from "react";
import {
  GROUP_FILTER_PREFIX,
  groupVendorCategories,
  type VendorCategoryGroup,
} from "@/lib/vendor-category-groups";

export interface VendorCategoryFilterOptionsProps {
  /** 副類別清單（vendors.main_category 彙整） */
  categories: string[];
  groups: VendorCategoryGroup[];
}

/**
 * 廠商類別「篩選用」下拉選項：主類別為可選的粗體項（值 `__group:{id}`，代表整組副類別），
 * 副類別縮排列於其下；判斷是否匹配請用 vendorCategoryFilterMatches。
 */
export function VendorCategoryFilterOptions({ categories, groups }: VendorCategoryFilterOptionsProps) {
  const { grouped, ungrouped } = useMemo(
    () => groupVendorCategories(categories, groups),
    [categories, groups],
  );
  return (
    <>
      {grouped.map(({ group, categories: cats }) => (
        <Fragment key={group.id}>
          <option value={`${GROUP_FILTER_PREFIX}${group.id}`} className="font-semibold text-foreground">▍{group.name}</option>
          {cats.map((c) => (
            <option key={c} value={c}>　{c}</option>
          ))}
        </Fragment>
      ))}
      {ungrouped.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </>
  );
}
