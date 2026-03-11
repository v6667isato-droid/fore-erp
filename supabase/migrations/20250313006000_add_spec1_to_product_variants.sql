-- 通用規格欄位一（未來可擴充 spec2, spec3...）
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS spec1 text;

COMMENT ON COLUMN product_variants.spec1 IS '通用規格1，例如椅子的坐墊規格';

