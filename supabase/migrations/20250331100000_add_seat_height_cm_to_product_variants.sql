-- 椅、凳類產品規格：座高（cm）
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS seat_height_cm numeric;

COMMENT ON COLUMN product_variants.seat_height_cm IS '座高（cm），椅／凳等產品使用；與外觀尺寸 W/D/H 分開填寫';
