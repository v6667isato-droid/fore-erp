-- 採購：台灣營業稅 5% 固定；儲存已稅/未稅單價與總價
-- 注意：若 tax_included_amount 為 GENERATED 欄位，不可 UPDATE；改由 quantity×unit_price_inc_tax 重建該欄位。

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS unit_price_is_tax_inclusive boolean NOT NULL DEFAULT false;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS unit_price_ex_tax numeric;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS unit_price_inc_tax numeric;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS amount_ex_tax numeric;

COMMENT ON COLUMN purchases.unit_price_is_tax_inclusive IS 'true=單價欄為已稅；false=未稅';
COMMENT ON COLUMN purchases.unit_price_ex_tax IS '未稅單價';
COMMENT ON COLUMN purchases.unit_price_inc_tax IS '含稅單價';
COMMENT ON COLUMN purchases.amount_ex_tax IS '未稅總價';

-- 舊資料：假設 unit_price 為未稅單價，補齊新欄位
UPDATE purchases
SET
  unit_price_ex_tax = round(coalesce(unit_price, 0)::numeric, 2),
  unit_price_inc_tax = round(coalesce(unit_price, 0)::numeric * 1.05, 2)
WHERE unit_price_ex_tax IS NULL;

UPDATE purchases
SET
  amount_ex_tax = round(coalesce(quantity, 0)::numeric * coalesce(unit_price_ex_tax, 0)::numeric, 2)
WHERE amount_ex_tax IS NULL;

-- 含稅總價：改為由數量 × 含稅單價自動計算（與應用程式 computePurchaseLinePrices 一致）
ALTER TABLE purchases DROP COLUMN IF EXISTS tax_included_amount CASCADE;

ALTER TABLE purchases
  ADD COLUMN tax_included_amount numeric
  GENERATED ALWAYS AS (
    round(coalesce(quantity, 0)::numeric * coalesce(unit_price_inc_tax, 0)::numeric, 2)
  ) STORED;

COMMENT ON COLUMN purchases.tax_included_amount IS '含稅總價（產生欄：數量×含稅單價）';
