"use client";

import { Fragment, useMemo } from "react";
import { GROUP_FILTER_PREFIX, groupCategories, type CategoryGroup } from "@/lib/category-groups";

export interface CategoryFilterOptionsProps {
  /** 副類別清單（主檔類別欄位彙整） */
  categories: string[];
  groups: CategoryGroup[];
}

/**
 * 類別「篩選用」下拉選項：主類別為可選的粗體項（值 `__group:{id}`，代表整組副類別），
 * 副類別縮排列於其下；判斷是否匹配請用 categoryFilterMatches。
 */
export function CategoryFilterOptions({ categories, groups }: CategoryFilterOptionsProps) {
  const { grouped, ungrouped } = useMemo(
    () => groupCategories(categories, groups),
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
