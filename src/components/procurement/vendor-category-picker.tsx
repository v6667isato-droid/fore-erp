"use client";

import { CategoryPicker, type CategoryPickerProps } from "@/components/procurement/category-picker";

export type VendorCategoryPickerProps = Omit<CategoryPickerProps, "customPlaceholder">;

/** 廠商類別選擇器（見 CategoryPicker） */
export function VendorCategoryPicker(props: VendorCategoryPickerProps) {
  return <CategoryPicker {...props} customPlaceholder="輸入新類別名稱，例：空壓機" />;
}
