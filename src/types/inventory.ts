/** 零件庫存／整備工單模組共用型別 */

export const PART_CATEGORIES = ["木料", "五金", "耗材", "塗料"] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const PART_PROCUREMENT_TYPES = ["常備", "接單"] as const;

export const PART_SOURCE_TYPES = ["自製", "採購"] as const;
export type PartSourceType = (typeof PART_SOURCE_TYPES)[number];

export interface PartRow {
  id: string;
  part_no: string;
  name: string;
  category: string;
  unit: string;
  procurement_type: string;
  source_type: string;
  /** 材種（白橡木/胡桃木…）：分類的子分類，主要用於木料 */
  wood_species: string | null;
  safety_stock: number;
  reorder_point: number;
  vendor_id: string | null;
  reference_unit_price: number | null;
  drawing_url: string | null;
  dim_length_mm: number | null;
  dim_width_mm: number | null;
  dim_thickness_mm: number | null;
  sop: string | null;
  is_component: boolean;
  notes: string | null;
  created_at: string | null;
}

/** 長×寬×厚（mm）顯示字串；三欄皆空回 null */
export function formatPartDimensions(p: Pick<PartRow, "dim_length_mm" | "dim_width_mm" | "dim_thickness_mm">): string | null {
  if (p.dim_length_mm == null && p.dim_width_mm == null && p.dim_thickness_mm == null) return null;
  const f = (v: number | null) => (v == null ? "?" : String(v));
  return `${f(p.dim_length_mm)}×${f(p.dim_width_mm)}×${f(p.dim_thickness_mm)}`;
}

/** part_stock_status view 的即時庫存欄位 */
export interface PartStockInfo {
  current_stock: number;
  needs_reorder: boolean;
  below_safety: boolean;
}

export type PartWithStock = PartRow & PartStockInfo & { vendor_name: string | null };

export const STOCK_MOVEMENT_TYPES = ["進料", "領用", "盤點調整"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovementRow {
  id: string;
  part_id: string;
  movement_type: string;
  quantity: number;
  movement_date: string;
  employee_id: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface EmployeeOption {
  id: string;
  name: string;
}
