/** 用於關聯欄位 name 的型別（如 vendor 關聯） */
export type NameRel = { name?: string | null } | { name?: string | null }[] | null;

/** 採購原物料主檔（procurement_materials） */
export interface ProcurementMaterialRow {
  id: string;
  name: string;
  item_category: string;
  spec: string;
  unit: string;
  notes?: string | null;
  created_at?: string | null;
}

export interface PurchaseRow {
  id: string;
  purchase_date: string;
  vendor_name: string;
  vendor_id?: string;
  /** 採購物料主檔；未對應時為 undefined */
  material_id?: string | null;
  item_name: string;
  item_category: string;
  spec: string;
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
