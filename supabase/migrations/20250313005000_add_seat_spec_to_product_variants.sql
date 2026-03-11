-- 為產品規格加入座墊規格欄位，只在類別為「椅」的系列會使用
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS seat_spec text;

COMMENT ON COLUMN product_variants.seat_spec IS '座墊／座面規格（實木、藤編、布墊、紙繩等）';

