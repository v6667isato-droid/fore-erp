/** 客戶資料（customers 表） */
export interface CustomerRow {
  id: string;
  name: string;
  /** 客戶別名 */
  alias?: string | null;
  /** 聯絡人姓名 */
  contact_person?: string | null;
  /** 品牌名稱（對外招牌名，通常與公司登記抬頭不同） */
  brand_name?: string | null;
  /** 公司抬頭（發票抬頭來源） */
  company?: string | null;
  /** 統一編號 */
  tax_id?: string | null;
  phone?: string | null;
  line_id?: string | null;
  ig_account?: string | null;
  delivery_address?: string | null;
  /** 送貨地址是否有電梯 */
  has_elevator?: boolean | null;
  notes?: string | null;
  /** 客戶來源 */
  source?: string | null;
  /** 客戶種類 */
  customer_type?: string | null;
  /** 所屬通路 ID（報價/訂單用該通路價） */
  channel_id?: string | null;
  /** 主要聯絡方式（line / ig / fb / email / boss / others） */
  contact_method?: string | null;
  /** 建立日期（DB 預設 now()） */
  created_at?: string | null;
}
