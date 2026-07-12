-- 產品系列細節圖：官網產品頁的其他圖片（主視覺圖為首張，細節圖依序接續）
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS detail_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN product_series.detail_image_urls IS '產品系列細節圖 Public URL 陣列（jsonb，張數不限，來自 product-images bucket；官網產品頁主視覺圖之後的其他圖片）';
