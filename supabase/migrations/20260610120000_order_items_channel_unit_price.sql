-- 客製品項手動輸入之通路價；規格品為 NULL（通路價由折扣規則計算）
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS channel_unit_price numeric;

COMMENT ON COLUMN order_items.channel_unit_price IS '客製品項通路價（手動）；NULL 表示無通路價，結算時用 unit_price（牌價）';
