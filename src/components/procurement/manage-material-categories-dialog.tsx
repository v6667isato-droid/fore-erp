"use client";

import { ManageCategoryGroupsDialog } from "@/components/procurement/manage-category-groups-dialog";
import type { MaterialCategoryGroup } from "@/lib/material-category-groups";

export interface ManageMaterialCategoriesDialogProps {
  /** 既有物料類別（副類別，來自 procurement_materials.item_category 彙整） */
  categories: string[];
  groups: MaterialCategoryGroup[];
  onSuccess: () => void;
}

/** 管理採購物料主類別（見 ManageCategoryGroupsDialog） */
export function ManageMaterialCategoriesDialog({ categories, groups, onSuccess }: ManageMaterialCategoriesDialogProps) {
  return (
    <ManageCategoryGroupsDialog
      table="material_category_groups"
      subjectTable="procurement_materials"
      subjectColumn="item_category"
      subjectLabel="物料"
      title="管理物料主類別"
      exampleName="生產耗材"
      categories={categories}
      groups={groups}
      onSuccess={onSuccess}
    />
  );
}
