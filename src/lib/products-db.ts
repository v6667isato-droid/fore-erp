/**
 * 產品資料庫連線設定：統一使用 product_series、product_variants 表名與欄位
 * 所有產品相關讀寫請透過此模組取得表名與 SELECT 欄位，以利維護與修改
 */

/** Supabase 表名：產品系列 */
export const TABLE_PRODUCT_SERIES = "product_series";

/** Supabase 表名：產品規格（關聯 product_series.id  via series_id） */
export const TABLE_PRODUCT_VARIANTS = "product_variants";

/** Supabase 表名：材料色樣主檔（材種／座墊／門片／布樣，介紹表色樣區） */
export const TABLE_MATERIAL_SWATCHES = "material_swatches";

/** Supabase 表名：系列 ↔ 色樣關聯（介紹表要顯示的色樣與順序） */
export const TABLE_SERIES_SWATCHES = "product_series_swatches";

/** material_swatches 查詢欄位 */
export const SWATCH_SELECT =
  "id, category, name, name_en, image_url, sort_order, is_active";

/** 色樣照片 Storage bucket（public read，1:1 方形） */
export const SWATCH_BUCKET = "material-swatches";

/** 尺寸線圖 Storage bucket（public read，SVG／PNG） */
export const DIMENSION_DRAWING_BUCKET = "dimension-drawings";

/** product_series 查詢欄位（含 website、image_url；若表無 website 會 fallback 用 SERIES_SELECT_NO_WEBSITE）
 *  資料表實際欄位為 series_name；PostgREST 別名使用 name:series_name（避免 series_name as name 被誤解析）
 */
export const SERIES_SELECT =
  "id, name:series_name, category, notes, production_time, code_rule, design_concept, faq_scripts, social_media_copy, website_article, customization_rules, website, image_url, size_chart_urls, detail_image_urls, image_meta, show_price_on_sheet, name_en:series_name_en, design_concept_en, customization_rules_en";

/** 資料庫 product_series 表之網站 URL 欄位名稱（與 Supabase 表一致） */
export const SERIES_WEBSITE_COLUMN = "website";

/** 無 website 欄位時的查詢（表尚未新增 website 時使用） */
export const SERIES_SELECT_NO_WEBSITE =
  "id, name:series_name, category, notes, production_time, code_rule, design_concept, faq_scripts, social_media_copy, website_article, customization_rules, image_url, size_chart_urls, detail_image_urls, image_meta";

/** product_variants 查詢欄位（含 series_id 關聯） */
export const VARIANT_SELECT =
  "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, arm_height_cm, base_price, desktop_area, spec1, image_url, is_custom_order, show_on_sheet, show_on_price_list, dimension_drawing_url";

/** 精簡系列欄位（當完整欄位不存在時 fallback 用） */
export const SERIES_SELECT_MINIMAL = "id, name:series_name, category, notes";

/**
 * 精簡規格欄位（當完整欄位不存在時 fallback 用）。
 * 刻意不含 arm_height_cm：遷移尚未套用時仍可查得到資料，扶手高度自然為空即不顯示。
 */
export const VARIANT_SELECT_MINIMAL =
  "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, base_price, desktop_area, spec1, image_url, is_custom_order, show_on_sheet, show_on_price_list, dimension_drawing_url";

/** 產品類別基本選項（產品系列與訂製案例共用；加工區類別另見 custom-cases-db） */
export const PRODUCT_CATEGORY_OPTIONS = ["桌", "椅", "櫃", "層架", "其他"];

/** 木種基本選項（variant 與訂製案例共用；datalist 會再合併資料庫既有值） */
export const WOOD_TYPE_OPTIONS = ["白橡木", "胡桃木", "柚木", "雞翅木"] as const;

/** product_series 文案欄位（編輯文案用，須與表內欄位一致） */
export const SERIES_CONTENT_COLUMNS = [
  "design_concept",
  "social_media_copy",
  "website_article",
  "faq_scripts",
  "customization_rules",
] as const;
