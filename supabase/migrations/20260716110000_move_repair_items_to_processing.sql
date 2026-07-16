-- 加工區項目定價：維修保養服務有標準價格（例：更換布面椅墊 2200），搬移時保留
ALTER TABLE custom_cases
  ADD COLUMN IF NOT EXISTS base_price numeric;

COMMENT ON COLUMN custom_cases.base_price IS '定價（加工區服務項目用；不對官網公開）';

-- 將「維修保養」產品系列底下的服務項目搬到加工區（custom_cases kind='processing'）
-- 搬移後軟刪除原系列與規格：自產品系列分頁與官網 /api/products 消失；
-- 舊訂單明細靠 variant_id FK 關聯顯示，不受軟刪除影響
WITH repair_series AS (
  SELECT id FROM product_series
  WHERE series_name = '維修保養' AND deleted_at IS NULL
),
moved AS (
  INSERT INTO custom_cases (kind, name_zh, category, base_price, notes)
  SELECT
    'processing',
    v.product_code,
    CASE
      WHEN v.product_code LIKE '%編織%' OR v.product_code LIKE '%椅墊%' THEN '維修'
      WHEN v.product_code LIKE '%噴漆%' OR v.product_code LIKE '%整理%' THEN '保養'
      ELSE '加工'
    END,
    v.base_price,
    '由產品系列「維修保養」搬移（' || to_char(now(), 'YYYY-MM-DD') || '）'
  FROM product_variants v
  JOIN repair_series rs ON rs.id = v.series_id
  WHERE v.deleted_at IS NULL
  RETURNING id
),
del_variants AS (
  UPDATE product_variants v
  SET deleted_at = now()
  FROM repair_series rs
  WHERE v.series_id = rs.id AND v.deleted_at IS NULL
  RETURNING v.id
)
UPDATE product_series s
SET deleted_at = now()
FROM repair_series rs
WHERE s.id = rs.id;
