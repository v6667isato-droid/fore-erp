/** 零件庫存／整備工單模組共用型別 */

export const PART_CATEGORIES = ["木料", "五金", "耗材", "塗料"] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const PART_PROCUREMENT_TYPES = ["常備", "接單"] as const;

export const PART_SOURCE_TYPES = ["自製", "採購"] as const;
export type PartSourceType = (typeof PART_SOURCE_TYPES)[number];

/** 零件單位選項（新增／編輯零件只提供這兩種；舊資料的其他單位在編輯時仍保留） */
export const PART_UNITS = ["個", "組"] as const;

/** 新零件的預設安全庫存；缺料提醒門檻＝安全庫存 */
export const DEFAULT_SAFETY_STOCK = 4;

export interface PartRow {
  id: string;
  /** 舊料號（過渡期保留，僅供歷史對照；新模型以 variant.sku 為顯示碼） */
  part_no: string;
  /** 部件名稱，不含系列前綴（後腳、木座墊、銅製把手…） */
  name: string;
  category: string;
  unit: string;
  procurement_type: string;
  source_type: string;
  /** 材種（過渡期保留；無材質軸零件的固定材質如樺木仍記在此） */
  wood_species: string | null;
  /** 所屬產品系列（product_series.id）；null＝共用/不分系列 */
  series_id: string | null;
  /** 是否有木種變體（木料自製件 true；板材、五金 false） */
  has_material_axis: boolean;
  /** SKU 第三段代碼（REAR/ARM/WSEAT…）；SKU＝系列-材質-name_code */
  name_code: string | null;
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

/** materials 對照表：材質代碼（O/W…）；aliases＝產品 wood_type 別名（煙燻白橡木→O） */
export interface MaterialRow {
  code: string;
  name_zh: string;
  aliases: string[];
  sort_order: number;
}

/** part_option_groups：某零件分類底下的選項「大項」（木料的木材種類另存於 materials） */
export interface PartOptionGroupRow {
  id: string;
  category: string;
  code: string;
  name_zh: string;
  sort_order: number;
  notes: string | null;
}

/** part_option_values：大項底下的「細項」；目前為主檔，尚未參與變體生成 */
export interface PartOptionValueRow {
  id: string;
  group_id: string;
  code: string;
  name_zh: string;
  sort_order: number;
}

/** part_variants：材質層級的實體庫存變體；material_code null＝無材質軸零件的唯一變體 */
export interface PartVariantRow {
  id: string;
  part_id: string;
  material_code: string | null;
  sku: string;
  safety_stock_override: number | null;
  reorder_point_override: number | null;
  deleted_at?: string | null;
}

/** part_variant_stock_status view 一列：變體＋零件屬性＋即時庫存 */
export interface PartVariantStockRow {
  id: string;
  part_id: string;
  sku: string;
  material_code: string | null;
  material_name: string | null;
  name: string;
  name_code: string | null;
  series_id: string | null;
  category: string;
  unit: string;
  procurement_type: string;
  source_type: string;
  vendor_id: string | null;
  is_component: boolean;
  safety_stock: number;
  reorder_point: number;
  current_stock: number;
  needs_reorder: boolean;
  below_safety: boolean;
}

export type BomLineType = "by_material" | "fixed";

/** bom_lines：系列層 BOM 線；by_material 指邏輯零件（下單 resolve），fixed 指具體變體 */
export interface BomLineRow {
  id: string;
  series_id: string;
  line_type: BomLineType;
  part_id: string | null;
  part_variant_id: string | null;
  quantity: number;
  unit: string | null;
  exclusive_group: string | null;
  /** spec1 尾碼字母（F/L/W/P/R…）；null＝不分規格永遠列入 */
  exclusive_key: string | null;
  notes: string | null;
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

/** 料號自動命名的木種代碼（產品系列-木種-零件名稱）；比對材種字串包含關係 */
export const WOOD_CODE_RULES: readonly { match: string; code: string }[] = [
  { match: "白橡", code: "O" },
  { match: "橡木", code: "O" },
  { match: "胡桃", code: "W" },
  { match: "柚木", code: "T" },
];

/** 材種 → 料號木種代碼（白橡木→O、胡桃木→W…）；未知材種回 null */
export function woodSpeciesCode(species: string): string | null {
  const s = species.trim();
  if (!s) return null;
  for (const r of WOOD_CODE_RULES) {
    if (s.includes(r.match)) return r.code;
  }
  return null;
}

/** 系列名稱取料號前綴：取第一段（空白前），如「CH03 扶手椅」→ CH03 */
export function seriesCodeFromName(seriesName: string): string {
  return seriesName.trim().split(/\s+/)[0] ?? "";
}

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
  /** 工單開工自動扣帳時來源訂單 */
  order_id: string | null;
  /** 工單開工自動扣帳時來源工單（可定位到單一 order_item） */
  work_order_id: string | null;
}

export interface EmployeeOption {
  id: string;
  name: string;
}
