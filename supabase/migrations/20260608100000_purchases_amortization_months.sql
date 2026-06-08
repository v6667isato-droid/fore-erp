-- 採購成本攤提月數：NULL 或 1 表示採購當月一次認列；>1 則平均分攤至後續月份（含採購月）
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS amortization_months integer;

COMMENT ON COLUMN purchases.amortization_months IS '成本攤提月數；NULL 或 1=當月一次認列；>1=平均分攤至後續月份（成本統計用）';
