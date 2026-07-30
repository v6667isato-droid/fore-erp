-- 廠商主類別群組：主類別（如「工廠硬體」）底下收多個既有廠商類別（vendors.main_category，作為副類別）。
-- vendors 資料本身不動，仍存副類別文字；歸屬關係集中存在本表的 subcategories 陣列。
CREATE TABLE IF NOT EXISTS vendor_category_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  -- 所屬副類別（= vendors.main_category 的值）；一個副類別僅應屬於一個主類別（由前端維護）
  subcategories text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vendor_category_groups IS '廠商主類別群組：subcategories 存 vendors.main_category 值清單';

ALTER TABLE vendor_category_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_category_groups_authenticated_all ON vendor_category_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
