-- 產品系列尺寸圖：主視覺圖下方可上傳多張尺寸圖，張數不限
-- 以 jsonb 陣列存放 Public URL（來自 product-images bucket），fore-furniture.com 可讀取顯示
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS size_chart_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN product_series.size_chart_urls IS '產品系列尺寸圖 Public URL 陣列（jsonb，張數不限，來自 product-images bucket；供官網讀取顯示）';
