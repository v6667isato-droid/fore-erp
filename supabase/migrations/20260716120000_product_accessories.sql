-- 配件表：產品資料頁新增「配件表」分頁
-- 記錄產品可搭配的配件選項，以 category 分類（例：門框、坐墊、坐墊布料…）
CREATE TABLE IF NOT EXISTS product_accessories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 分類大項（例：門框、坐墊、坐墊布料；可自由新增其他分類）
  category text NOT NULL,
  -- 配件名稱（例：藤編門框、乳膠坐墊、貓抓布）
  name text NOT NULL,
  -- 規格／型號補充（例：厚度 5cm、W450 x D450）
  spec text,
  -- 材質（例：白橡木、亞麻布）
  material text,
  -- 定價／加價金額（可留空）
  price numeric,
  -- 主圖 Public URL（product-images bucket）
  image_url text,
  -- 內部備註
  notes text,
  sort_order integer,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE product_accessories IS '產品配件表（門框、坐墊、坐墊布料等選項），僅內部使用';
COMMENT ON COLUMN product_accessories.category IS '分類大項：門框、坐墊、坐墊布料等，可自由擴充';
COMMENT ON COLUMN product_accessories.price IS '定價或加價金額，可留空';

CREATE INDEX IF NOT EXISTS product_accessories_category_idx
  ON product_accessories (category) WHERE deleted_at IS NULL;

-- RLS：僅內部（已登入）可存取，不對官網 anon 公開
ALTER TABLE product_accessories ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_accessories_authenticated_all ON product_accessories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
