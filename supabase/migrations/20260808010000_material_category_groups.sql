-- 採購物料主類別群組：與 vendor_category_groups 同結構、同一套主類別名稱。
-- 主類別（如「生產耗材」）底下收多個既有物料類別（procurement_materials.item_category，作為副類別）。
-- procurement_materials 資料本身不動，仍存副類別文字；歸屬關係集中存在本表的 subcategories 陣列。
CREATE TABLE IF NOT EXISTS material_category_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  -- 所屬副類別（= procurement_materials.item_category 的值）；一個副類別僅應屬於一個主類別（由前端維護）
  subcategories text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE material_category_groups IS '採購物料主類別群組：subcategories 存 procurement_materials.item_category 值清單';

ALTER TABLE material_category_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS material_category_groups_authenticated_all ON material_category_groups;
CREATE POLICY material_category_groups_authenticated_all ON material_category_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 預設主類別：沿用廠商的 6 個主類別名稱，並把現有物料類別做初步歸屬（之後可在 UI 調整）
INSERT INTO material_category_groups (name, subcategories, sort_order) VALUES
  ('工廠硬體', ARRAY['硬體', '燈具'], 0),
  ('機器耗材', ARRAY['木工鋸片', '帶鋸', '機器維護'], 1),
  ('委外加工', ARRAY['玻璃', '藤編'], 2),
  ('生產耗材', ARRAY['五金', '螺絲', '塗料', '木工膠', '木榫', '砂紙', 'CNC刀具', '木工工具', '紙繩', '耗材', '防護用品'], 3),
  ('木料相關', ARRAY['木料_實木', '木料_合板'], 4),
  ('營運、行銷', ARRAY['包裝材', '軟體', '常規費用', '物流'], 5)
ON CONFLICT (name) DO NOTHING;
