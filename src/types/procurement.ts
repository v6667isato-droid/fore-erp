/** 用於關聯欄位 name 的型別（如 vendor 關聯） */
export type NameRel = { name?: string | null } | { name?: string | null }[] | null;

/** 採購原物料主檔（procurement_materials） */
export interface ProcurementMaterialRow {
  id: string;
  name: string;
  item_category: string;
  spec: string;
  /** 規格2（補充） */
  spec2?: string | null;
  unit: string;
  notes?: string | null;
  /** 預設成本攤提月數；null 時依類別推斷 */
  amortization_months?: number | null;
  created_at?: string | null;
}

export interface PurchaseRow {
  id: string;
  purchase_date: string;
  vendor_name: string;
  /** vendors.notes（有對應主檔時；名稱後括號顯示） */
  vendor_notes?: string | null;
  vendor_id?: string;
  /** 採購物料主檔；未對應時為 undefined */
  material_id?: string | null;
  item_name: string;
  item_category: string;
  /** 資料庫寫入之合併規格（或舊資料單一字串）；供匯出等 */
  spec: string;
  /** purchases.spec2；若無則自 spec 推導顯示用 */
  spec2?: string | null;
  /** 主檔備註（僅對應 material_id；供搜尋） */
  material_notes?: string | null;
  /** 主規格欄顯示／排序 */
  spec_primary: string;
  /** 規格二欄顯示／排序 */
  spec_secondary: string;
  quantity: string | number;
  unit: string;
  /** 使用者輸入之單價（已稅或未稅，見 unit_price_is_tax_inclusive） */
  unit_price: number;
  /** true=單價欄為已稅；false=未稅 */
  unit_price_is_tax_inclusive: boolean;
  unit_price_ex_tax: number;
  unit_price_inc_tax: number;
  /** 未稅總價 */
  amount_ex_tax: number;
  /** 含稅總價 */
  tax_included_amount: number;
  /** 成本攤提月數；null/1=當月認列 */
  amortization_months?: number | null;
}

/** 廠商資料（vendors 表） */
export interface VendorRow {
  id: string;
  name: string;
  main_category: string;
  contact_person?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  tax_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
  /** 廠商網站 URL */
  website?: string | null;
  purchase_count?: number;
  last_purchase_date?: string | null;
}
