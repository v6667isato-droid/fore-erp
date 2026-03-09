"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";
import type { PurchaseRow } from "@/types/procurement";

export interface ProcurementFiltersProps {
  filterYear: string;
  filterCategory: string;
  filterVendor: string;
  filterItemName: string;
  filterSearch: string;
  onYearChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onVendorChange: (v: string) => void;
  onItemNameChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  records: PurchaseRow[];
}

export function ProcurementFilters({
  filterYear,
  filterCategory,
  filterVendor,
  filterItemName,
  filterSearch,
  onYearChange,
  onCategoryChange,
  onVendorChange,
  onItemNameChange,
  onSearchChange,
  records,
}: ProcurementFiltersProps) {
  const years = useMemo(() => [...new Set(records.map((r) => r.purchase_date.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [records]);

  const allCategories = useMemo(() => [...new Set(records.map((r) => r.item_category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [records]);
  const allVendors = useMemo(() => [...new Set(records.map((r) => r.vendor_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [records]);

  const categoriesLinked = useMemo(() => {
    if (!filterVendor) return allCategories;
    return [...new Set(records.filter((r) => r.vendor_name === filterVendor).map((r) => r.item_category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [records, filterVendor, allCategories]);

  const vendorsLinked = useMemo(() => {
    if (!filterCategory) return allVendors;
    return [...new Set(records.filter((r) => r.item_category === filterCategory).map((r) => r.vendor_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [records, filterCategory, allVendors]);

  const itemNamesFiltered = useMemo(() => {
    let list = records;
    if (filterCategory) list = list.filter((r) => r.item_category === filterCategory);
    if (filterVendor) list = list.filter((r) => r.vendor_name === filterVendor);
    return [...new Set(list.map((r) => r.item_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [records, filterCategory, filterVendor]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground shrink-0">篩選</span>
      <select
        value={filterYear}
        onChange={(e) => onYearChange(e.target.value)}
        className="h-8 min-w-[6rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="年度"
      >
        <option value="">年度：全部</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        value={filterCategory}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="h-8 min-w-[6rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="類別"
        title={filterVendor ? "依所選廠商篩選出的物品類別" : "物品類別"}
      >
        <option value="">類別：全部</option>
        {categoriesLinked.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select
        value={filterVendor}
        onChange={(e) => onVendorChange(e.target.value)}
        className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="廠商"
        title={filterCategory ? "依所選類別篩選出的廠商" : "廠商"}
      >
        <option value="">廠商：全部</option>
        {vendorsLinked.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        value={filterItemName}
        onChange={(e) => onItemNameChange(e.target.value)}
        className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="品名"
      >
        <option value="">品名：全部</option>
        {itemNamesFiltered.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <div className="relative flex-1 min-w-[10rem] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
        <input
          type="search"
          value={filterSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜尋廠商、品名、類別、規格…"
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="搜尋採購紀錄"
        />
      </div>
    </div>
  );
}
