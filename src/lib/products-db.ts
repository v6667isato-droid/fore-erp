/**
 * 產品資料庫連線設定：統一使用 product_series、product_variants 表名與欄位
 * 所有產品相關讀寫請透過此模組取得表名與 SELECT 欄位，以利維護與修改
 */

/** Supabase 表名：產品系列 */
export const TABLE_PRODUCT_SERIES = "product_series";

/** Supabase 表名：產品規格（關聯 product_series.id  via series_id） */
export const TABLE_PRODUCT_VARIANTS = "product_variants";

/** product_series 查詢欄位（含 website、image_url；若表無 website 會 fallback 用 SERIES_SELECT_NO_WEBSITE）
 *  資料表實際欄位為 series_name，這裡以 name 作為前端欄位別名
 */
export const SERIES_SELECT =
  "id, series_name as name, category, notes, production_time, code_rule, design_concept, faq_scripts, social_media_copy, website_article, customization_rules, website, image_url";

/** 資料庫 product_series 表之網站 URL 欄位名稱（與 Supabase 表一致） */
export const SERIES_WEBSITE_COLUMN = "website";

/** 無 website 欄位時的查詢（表尚未新增 website 時使用） */
export const SERIES_SELECT_NO_WEBSITE =
  "id, series_name as name, category, notes, production_time, code_rule, design_concept, faq_scripts, social_media_copy, website_article, customization_rules, image_url";

/** product_variants 查詢欄位（含 series_id 關聯） */
export const VARIANT_SELECT =
  "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, base_price, desktop_area, spec1";

/** 精簡系列欄位（當完整欄位不存在時 fallback 用） */
export const SERIES_SELECT_MINIMAL = "id, series_name as name, category, notes";

/** 精簡規格欄位（當完整欄位不存在時 fallback 用） */
export const VARIANT_SELECT_MINIMAL =
  "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, base_price, desktop_area, spec1";

/** product_series 文案欄位（編輯文案用，須與表內欄位一致） */
export const SERIES_CONTENT_COLUMNS = [
  "design_concept",
  "social_media_copy",
  "website_article",
  "faq_scripts",
  "customization_rules",
] as const;
