-- 為產品系列加入「編碼原則」欄位，對應前端的 code_rule
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS code_rule text;

COMMENT ON COLUMN product_series.code_rule IS '產品系列編碼原則（例如：系列縮寫 + 材質 + 尺寸）';

