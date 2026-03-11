/** 客戶資料（customers 表） */
export interface CustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  line_id?: string | null;
  ig_account?: string | null;
  delivery_address?: string | null;
  notes?: string | null;
  /** 客戶來源 */
  source?: string | null;
  /** 客戶種類 */
  customer_type?: string | null;
  /** 所屬通路 ID（報價/訂單用該通路價） */
  channel_id?: string | null;
}
