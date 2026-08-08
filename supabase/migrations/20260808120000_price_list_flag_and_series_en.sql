-- 1) 價目表獨立勾選：show_on_price_list 與介紹表 show_on_sheet 分開；
--    初始值沿用現況（已勾介紹表者一併勾價目表），之後各自維護。
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS show_on_price_list boolean NOT NULL DEFAULT false;

UPDATE product_variants SET show_on_price_list = true WHERE show_on_sheet = true;

COMMENT ON COLUMN product_variants.show_on_sheet IS '是否顯示於產品介紹表（與價目表勾選各自獨立）';
COMMENT ON COLUMN product_variants.show_on_price_list IS '是否顯示於價目表（與介紹表勾選各自獨立）';

-- 2) 介紹表／價目表中英版本：系列層級英文欄位（配合官網雙語內容）
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS series_name_en text,
  ADD COLUMN IF NOT EXISTS design_concept_en text,
  ADD COLUMN IF NOT EXISTS customization_rules_en text;

COMMENT ON COLUMN product_series.series_name_en IS '系列英文名稱（介紹表／價目表英文版標題用，留空 fallback 中文）';
COMMENT ON COLUMN product_series.design_concept_en IS '設計理念英文版（介紹表英文版第一頁，留空 fallback 中文）';
COMMENT ON COLUMN product_series.customization_rules_en IS '客製與保養英文版（介紹表英文版第二頁，留空 fallback 中文）';
