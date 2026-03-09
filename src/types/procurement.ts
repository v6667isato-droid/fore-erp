/** 用於關聯欄位 name 的型別（如 vendor 關聯） */
export type NameRel = { name?: string | null } | { name?: string | null }[] | null;

export interface PurchaseRow {
  id: string;
  purchase_date: string;
  vendor_name: string;
  vendor_id?: string;
  item_name: string;
  item_category: string;
  spec: string;
  quantity: string | number;
  unit: string;
  unit_price: number;
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
