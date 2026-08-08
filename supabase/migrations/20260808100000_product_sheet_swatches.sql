-- 產品介紹表改版（Time & Style 風格橫向 A4）Phase 1：
-- 1) material_swatches：材料色樣主檔（材種 wood／布墊 fabric），照片存 Storage bucket material-swatches
-- 2) product_series_swatches：系列 ↔ 色樣關聯（介紹表第二頁底部要顯示哪些色樣、順序）
-- 3) product_variants 加 show_on_sheet（是否列入介紹表）與 dimension_drawing_url（尺寸線圖，Fusion 360 匯出人工上傳）
-- 4) product_series 加 show_price_on_sheet（介紹表是否附報價欄；預設 false，價格由獨立價目表承載）
-- 註：variants 尺寸 dimension_w/d/h、seat_height_cm 既有欄位已是 numeric（cm、可一位小數），無需遷移。

CREATE TABLE IF NOT EXISTS material_swatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- wood=材種, fabric=布墊
  category text NOT NULL CHECK (category IN ('wood', 'fabric')),
  name text NOT NULL,
  -- 英文標示（印在介紹表色樣下方第二行），例：Oak / Natural white
  name_en text,
  -- Supabase Storage public URL（bucket: material-swatches，1:1 方形）
  image_url text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE material_swatches IS '材料色樣主檔（介紹表第二頁色樣區）：category wood=材種 / fabric=布墊';

CREATE TABLE IF NOT EXISTS product_series_swatches (
  series_id uuid NOT NULL REFERENCES product_series(id) ON DELETE CASCADE,
  swatch_id uuid NOT NULL REFERENCES material_swatches(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, swatch_id)
);

COMMENT ON TABLE product_series_swatches IS '系列介紹表要顯示的色樣與順序（材種在前、布墊在後由前端分群）';

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS show_on_sheet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dimension_drawing_url text;

COMMENT ON COLUMN product_variants.show_on_sheet IS '是否顯示於產品介紹表／價目表（獨立於 is_custom_order）';
COMMENT ON COLUMN product_variants.dimension_drawing_url IS '尺寸線圖 public URL（bucket: dimension-drawings，SVG 或 PNG）';

ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS show_price_on_sheet boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN product_series.show_price_on_sheet IS '介紹表第二頁是否渲染報價欄（預設 false：價格由獨立價目表承載）';

-- RLS：比照 product_series／product_variants（authenticated 全權限；anon 唯讀，
-- 介紹表列印頁與官網可能以 anon 讀取型錄資料）
ALTER TABLE material_swatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS material_swatches_authenticated_all ON material_swatches;
CREATE POLICY material_swatches_authenticated_all ON material_swatches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS material_swatches_anon_select ON material_swatches;
CREATE POLICY material_swatches_anon_select ON material_swatches
  FOR SELECT TO anon USING (true);

ALTER TABLE product_series_swatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_series_swatches_authenticated_all ON product_series_swatches;
CREATE POLICY product_series_swatches_authenticated_all ON product_series_swatches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS product_series_swatches_anon_select ON product_series_swatches;
CREATE POLICY product_series_swatches_anon_select ON product_series_swatches
  FOR SELECT TO anon USING (true);

-- Storage buckets：色樣照片與尺寸線圖（public read；上傳／刪除限 authenticated）
INSERT INTO storage.buckets (id, name, public)
VALUES ('material-swatches', 'material-swatches', true), ('dimension-drawings', 'dimension-drawings', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS material_swatches_bucket_write ON storage.objects;
CREATE POLICY material_swatches_bucket_write
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('material-swatches', 'dimension-drawings'));

DROP POLICY IF EXISTS material_swatches_bucket_update ON storage.objects;
CREATE POLICY material_swatches_bucket_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('material-swatches', 'dimension-drawings'));

DROP POLICY IF EXISTS material_swatches_bucket_delete ON storage.objects;
CREATE POLICY material_swatches_bucket_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('material-swatches', 'dimension-drawings'));
