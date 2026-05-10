/** 客戶資料（customers 表） */
export interface CustomerRow {
  id: string;
  name: string;
  /** 客戶別名 */
  alias?: string | null;
  /** 聯絡人姓名 */
  contact_person?: string | null;
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
}
