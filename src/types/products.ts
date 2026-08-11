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
  /** 產品介紹表第二頁是否渲染報價欄（預設 false：價格由獨立價目表承載） */
  show_price_on_sheet?: boolean;
  /** 系列英文名稱（介紹表／價目表英文版，留空 fallback 中文） */
  name_en?: string | null;
  /** 設計理念英文版（介紹表英文版第一頁） */
  design_concept_en?: string | null;
  /** 客製與保養英文版（介紹表英文版第二頁） */
  customization_rules_en?: string | null;
  /** 介紹表第一頁主視覺圖（獨立於產品資料 image_url；null＝沿用 image_url） */
  sheet_hero_image_url?: string | null;
  /** 介紹表設計理念（獨立於 design_concept；null＝沿用） */
  sheet_design_concept?: string | null;
  /** 介紹表客製與保養（獨立於 customization_rules；null＝沿用） */
  sheet_customization_rules?: string | null;
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
  /** 扶手高度（cm，英文標示 AH），有扶手之椅類；未填寫則各處不顯示 */
  arm_height_cm?: number | null;
  base_price?: number | null;
  desktop_area?: number | null;
  /** 通用規格1（例如椅子的「坐墊規格」） */
  spec1?: string | null;
  /** 產品規格圖片 Public URL（來自 product-images bucket） */
  image_url?: string | null;
  /** 訂製款（開單佔位用規格）：不列入產品介紹表／價目表等對外列表，訂單牌價手動輸入 */
  is_custom_order?: boolean;
  /** 介紹表顯示順序（系列編輯「介紹表」分頁設定）；null=未排序，排在已排序項之後 */
  sheet_sort_order?: number | null;
  /** 是否顯示於產品介紹表（勾選制，預設 false；與價目表勾選各自獨立） */
  show_on_sheet?: boolean;
  /** 是否顯示於價目表（勾選制，預設 false；與介紹表勾選各自獨立） */
  show_on_price_list?: boolean;
  /** 尺寸線圖 Public URL（bucket: dimension-drawings，SVG 或 PNG；Fusion 360 匯出人工上傳） */
  dimension_drawing_url?: string | null;
  /** 選項軸值（勾選生成的規格才有；全空＝手動／舊資料建立） */
  wood_value_id?: string | null;
  size_value_id?: string | null;
  cushion_value_id?: string | null;
  config_value_id?: string | null;
}

/** 是否為非勾選生成的舊規格（訂製款除外）：四個軸值全空 */
export function isLegacyVariant(v: VariantRow): boolean {
  return (
    !v.is_custom_order &&
    v.wood_value_id == null &&
    v.size_value_id == null &&
    v.cushion_value_id == null &&
    v.config_value_id == null
  );
}

/**
 * 材料色樣（介紹表第二頁色樣區）
 * 對應 Supabase 表：material_swatches
 */
export interface SwatchRow {
  id: string;
  /** wood=材種, fabric=座墊, door=門片種類, cloth=布樣 */
  category: "wood" | "fabric" | "door" | "cloth";
  /** 中文名，例：白橡木 */
  name: string;
  /** 英文標示，例：Oak / Natural white（印在介紹表上） */
  name_en?: string | null;
  /** 色樣照片 Public URL（bucket: material-swatches，1:1 方形）；可先建檔後補照片，無照片者不會出現在介紹表 */
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}
