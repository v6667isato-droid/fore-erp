-- 介紹表品項自由排序：數字小者在前，NULL 排最後（fallback 依產品代碼）
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sheet_sort_order integer;
COMMENT ON COLUMN product_variants.sheet_sort_order IS '介紹表顯示順序（系列編輯「介紹表」分頁設定）；NULL=未排序，排在已排序項之後';
