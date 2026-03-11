-- 為產品系列加入「交期（週）」欄位，對應前端的 production_time
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS production_time text;

COMMENT ON COLUMN product_series.production_time IS '系列交期（週），純文字紀錄，例如：3 或 3-4';

