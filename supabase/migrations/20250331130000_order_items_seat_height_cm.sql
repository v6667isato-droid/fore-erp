-- 訂單明細：此筆成交之座高（cm），可與規格主檔不同（客戶加高等）
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS seat_height_cm numeric;

COMMENT ON COLUMN order_items.seat_height_cm IS '訂單明細約定座高（cm）；椅／凳類可與 product_variants.seat_height_cm 不同';
