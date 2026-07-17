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
  /** 產品系列尺寸圖 Public URL 陣列（張數不限，來自 product-images bucket；供官網讀取顯示） */
  size_chart_urls?: string[] | null;
  /** 產品系列細節圖 Public URL 陣列（官網產品頁主視覺圖之後的其他圖片） */
  detail_image_urls?: string[] | null;
  /** 圖片中繼資料：以圖片 URL 為 key（官網圖說與裁切焦點，適用主視覺圖與細節圖） */
  image_meta?: Record<string, SeriesImageMeta> | null;
}

/** 單張圖片的官網中繼資料（product_series.image_meta 的 value） */
export interface SeriesImageMeta {
  /** 圖片標題（中），官網圖說與 alt 文字用；留空不顯示 */
  title_zh?: string | null;
  /** 圖片標題（英） */
  title_en?: string | null;
  /** 官網 4:5 裁切焦點（CSS object-position，例如 "50% 30%"），留空為置中 */
  object_position?: string | null;
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
  /** 座高（cm），椅／凳等產品 */
  seat_height_cm?: number | null;
  base_price?: number | null;
  desktop_area?: number | null;
  /** 通用規格1（例如椅子的「坐墊規格」） */
  spec1?: string | null;
  /** 產品規格圖片 Public URL（來自 product-images bucket） */
  image_url?: string | null;
  /** 訂製款（開單佔位用規格）：不列入產品介紹表／價目表等對外列表，訂單牌價手動輸入 */
  is_custom_order?: boolean;
}
