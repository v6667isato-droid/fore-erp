-- 採購原物料主檔：統一品名／規格／類別，便於統計與帶入採購明細
CREATE TABLE IF NOT EXISTS procurement_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  item_category text,
  spec text,
  unit text,
  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE procurement_materials IS '採購原物料主檔；品名＋規格（空視為同規格）唯一';
COMMENT ON COLUMN procurement_materials.name IS '標準品名（建議與內部統一用字）';
COMMENT ON COLUMN procurement_materials.item_category IS '物品類別';
COMMENT ON COLUMN procurement_materials.spec IS '規格說明';
COMMENT ON COLUMN procurement_materials.unit IS '預設單位';

CREATE UNIQUE INDEX IF NOT EXISTS procurement_materials_name_spec_unique
  ON procurement_materials (lower(trim(name)), coalesce(trim(spec), ''));

CREATE INDEX IF NOT EXISTS idx_procurement_materials_category ON procurement_materials (item_category);

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES procurement_materials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_material_id ON purchases(material_id);

COMMENT ON COLUMN purchases.material_id IS '關聯採購物料主檔；NULL 表示手動輸入（舊資料或未對應主檔）';
