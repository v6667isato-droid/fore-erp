"use client";

import { ManageCategoryGroupsDialog } from "@/components/procurement/manage-category-groups-dialog";
import type { VendorCategoryGroup } from "@/lib/vendor-category-groups";

export interface ManageVendorCategoriesDialogProps {
  /** 既有廠商類別（副類別，來自 vendors.main_category 彙整） */
  categories: string[];
  groups: VendorCategoryGroup[];
  onSuccess: () => void;
}

/** 管理廠商主類別（見 ManageCategoryGroupsDialog） */
export function ManageVendorCategoriesDialog({ categories, groups, onSuccess }: ManageVendorCategoriesDialogProps) {
  return (
    <ManageCategoryGroupsDialog
      table="vendor_category_groups"
      subjectTable="vendors"
      subjectColumn="main_category"
      subjectLabel="廠商"
      title="管理廠商主類別"
      exampleName="工廠硬體"
      categories={categories}
      groups={groups}
      onSuccess={onSuccess}
    />
  );
}
