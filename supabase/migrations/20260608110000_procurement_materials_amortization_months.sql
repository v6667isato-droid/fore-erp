-- 採購物料主檔預設成本攤提月數；採購選取物料時自動帶入
ALTER TABLE procurement_materials
  ADD COLUMN IF NOT EXISTS amortization_months integer;

COMMENT ON COLUMN procurement_materials.amortization_months IS '預設成本攤提月數；NULL 時依物品類別推斷（木料→12）；1=不攤提';

-- 既有木料類物料預設 12 個月（僅補 NULL，不覆寫已設定值）
UPDATE procurement_materials
SET amortization_months = 12
WHERE amortization_months IS NULL
  AND trim(coalesce(item_category, '')) LIKE '木料%';
