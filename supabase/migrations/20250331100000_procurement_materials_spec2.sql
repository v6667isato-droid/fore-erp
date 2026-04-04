-- 採購物料主檔：補充「規格2」欄位，並將唯一性改為 品名＋規格＋規格2
ALTER TABLE procurement_materials
  ADD COLUMN IF NOT EXISTS spec2 text;

COMMENT ON COLUMN procurement_materials.spec2 IS '規格2（補充說明）';

DROP INDEX IF EXISTS procurement_materials_name_spec_unique;

CREATE UNIQUE INDEX IF NOT EXISTS procurement_materials_name_spec_spec2_unique
  ON procurement_materials (lower(trim(name)), coalesce(trim(spec), ''), coalesce(trim(spec2), ''));
