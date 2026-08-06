import type { WorkOrderStage } from "@/lib/work-order-stages";

export type OrderStatus =
  | "報價中"
  | "繪圖中"
  | "排程中"
  | "繪製製作圖"
  | "生產中"
  | "暫停"
  | "已完工"
  | "已出貨"
  | "結案"
  | "已退貨";
export type PaymentStatus = "未付款" | "部分付款" | "已付訂金" | "已結清";

export interface OrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  total_amount: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_id: string | null;
  customer_name: string;
  customer_alias?: string | null;
  deposit_amount: number;
  shipping_fee?: number;
  shipping_address?: string | null;
  shipping_contact_name?: string | null;
  shipping_contact_phone?: string | null;
  shipping_has_elevator?: boolean | null;
  /** 發票公司抬頭（開單時自客戶主檔帶入，可改） */
  invoice_title?: string | null;
  /** 統一編號（開單時自客戶主檔帶入，可改） */
  invoice_tax_id?: string | null;
  internal_notes?: string | null;
  explanation_image_url?: string | null;
}

export interface CustomerOption {
  id: string;
  name: string;
  /** 客戶別名 */
  alias?: string | null;
  /** 公司名稱 */
  company?: string | null;
  contact_person: string | null;
  phone: string | null;
  delivery_address: string | null;
  has_elevator: boolean | null;
  /** 統一編號 */
  tax_id?: string | null;
  channel_id?: string | null;
}

export interface VariantOption {
  id: string;
  series_id: string;
  series_name: string;
  series_category?: string | null;
  /** 示意圖：product_variants.image_url 優先，否則 product_series.image_url */
  series_image_url?: string | null;
  label: string;
  base_price: number | null;
  /** 訂製款（開單佔位用規格）：牌價改為開單時手動輸入 */
  is_custom_order?: boolean;
  spec1?: string | null;
  wood_type?: string | null;
  dimension_w?: number | null;
  dimension_d?: number | null;
  dimension_h?: number | null;
  seat_height_cm?: number | null;
}

/**
 * 品項類型：
 *   variant    規格庫（產品系列 product_variants）
 *   case       訂製案例（custom_cases kind=custom，挑選後帶入名稱等，可再編輯）
 *   processing 加工項目（custom_cases kind=processing，維修保養等，帶入定價）
 *   custom     客製品項（純手填）
 */
export type OrderItemKind = "variant" | "case" | "processing" | "custom";

export interface OrderItemInput {
  id: string;
  variant_id: string;
  series_id?: string | null;
  quantity: number;
  /** 牌價 */
  unit_price: number;
  /** 通路價格：規格品依折扣規則自動帶入、可手動改（個別折扣）；客製品項為手填。有值時結算優先採用 */
  channel_unit_price?: number | null;
  custom_notes: string;
  kind: OrderItemKind;
  /** kind=case／processing 時對應 order_items.custom_case_id（custom_cases.id） */
  custom_case_id?: string | null;
  custom_category?: string | null;
  custom_name?: string | null;
  custom_description?: string | null;
  custom_dimension_w?: number | null;
  custom_dimension_d?: number | null;
  custom_dimension_h?: number | null;
  /** 訂單約定座高（cm），存入 order_items.seat_height_cm */
  seat_height_cm?: number | null;
  image_url?: string | null;
  wood_type?: string | null;
  /** 編輯訂單時：本次表單新增的明細列（可調價）；既有列僅能透過重選規格更新價格 */
  isNewLine?: boolean;
  /** 對應 work_orders.stage */
  work_order_stage?: WorkOrderStage;
  /** 對應 work_orders.assignee_id（employees.id） */
  work_order_assignee_id?: string | null;
  /** 對應 work_orders.planned_end_date */
  work_order_planned_end_date?: string | null;
}

export interface EmployeeOption {
  id: string;
  name: string;
}

export type ExplanationImage = { url: string; title?: string | null };

export interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerOption[];
  variants: VariantOption[];
  initialOrder?: OrderRow | null;
  initialItems?: OrderItemInput[];
  readOnly?: boolean;
  onSaved: () => void;
  onRefreshCustomers: () => Promise<void>;
}
