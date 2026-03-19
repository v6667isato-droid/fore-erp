-- 訂單寄送資訊：聯絡人、電話、有無電梯（送貨地址沿用 orders.shipping_address）
-- 若環境已手動建立欄位，此 migration 可安全重跑（IF NOT EXISTS）
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_contact_name text,
  ADD COLUMN IF NOT EXISTS shipping_contact_phone text,
  ADD COLUMN IF NOT EXISTS shipping_has_elevator boolean;

COMMENT ON COLUMN public.orders.shipping_contact_name IS '本訂單送貨聯絡人';
COMMENT ON COLUMN public.orders.shipping_contact_phone IS '本訂單送貨聯絡電話';
COMMENT ON COLUMN public.orders.shipping_has_elevator IS '送貨點是否有電梯：true=有，false=無，NULL=未填';
