/**
 * 產品系列
 * 對應 Supabase 表：product_series（表名由 @/lib/products-db 統一管理）
 */
export interface SeriesRow {
  id: string;
  name: string;
  category: string;
  notes?: string | null;
  /** 製作時間（例如天數／週數文字） */
  production_time?: string | null;
  /** 編碼原則，提示產品代碼如何命名 */
  code_rule?: string | null;
  design_concept?: string | null;
  faq_scripts?: string | null;
  social_media_copy?: string | null;
  website_article?: string | null;
  customization_rules?: string | null;
  /** 產品系列官網／連結 URL */
  website?: string | null;
  /** 產品系列主視覺圖 Public URL（來自 product-images bucket） */
  image_url?: string | null;
}

/**
 * 產品規格（關聯 series_id → product_series.id）
 * 對應 Supabase 表：product_variants（表名由 @/lib/products-db 統一管理）
 */
export interface VariantRow {
  id: string;
  series_id: string;
  product_code: string;
  wood_type: string;
  dimension_w?: number | null;
  dimension_d?: number | null;
  dimension_h?: number | null;
  base_price?: number | null;
  desktop_area?: number | null;
  /** 通用規格1（例如椅子的「坐墊規格」） */
  spec1?: string | null;
}
