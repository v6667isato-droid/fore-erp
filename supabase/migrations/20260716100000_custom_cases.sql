-- 訂製案例與加工區：產品資料頁新增兩個分頁共用此表，以 kind 區分
--   kind = 'custom'     訂製案例（客製家具作品，published = true 時供官網顯示）
--   kind = 'processing' 加工區（維修保養等項目，僅內部使用，永不對官網公開）
CREATE TABLE IF NOT EXISTS custom_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom', 'processing')),
  -- 案例編號（例：C14），沿用官網現有客製案例編號習慣
  case_code text,
  name_zh text NOT NULL,
  name_en text,
  -- 類別對照 product_series.category（桌、椅、櫃、層架、其他…；加工區可用 維修、保養…）
  category text,
  -- 材質／木種（例：白橡木、胡桃木）
  material text,
  dimension_w numeric,
  dimension_d numeric,
  dimension_h numeric,
  -- 尺寸補充說明（例：依現場尺寸訂製）；有值時官網優先顯示此文字
  dimensions_note text,
  -- 完成年份（例：2023）
  completed_year text,
  story_zh text,
  story_en text,
  -- 主圖 Public URL（product-images bucket）
  image_url text,
  -- 官網主圖裁切焦點，CSS object-position 寫法（例："50% 30%"）
  object_position text,
  -- 製作過程圖 Public URL 陣列（jsonb，張數不限）
  process_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 僅 kind = 'custom' 有意義：true 時官網客製頁顯示此案例
  published boolean NOT NULL DEFAULT false,
  sort_order integer,
  -- 來源訂單（選填）：由訂單完工後轉建案例時回填
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  -- 內部備註（不對官網公開）
  notes text,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE custom_cases IS '訂製案例（kind=custom，可發佈至官網）與加工區項目（kind=processing，僅內部）';
COMMENT ON COLUMN custom_cases.kind IS 'custom=訂製案例；processing=加工區（維修保養，永不對官網公開）';
COMMENT ON COLUMN custom_cases.published IS '官網發佈開關；僅 kind=custom 時由官網 API 讀取';
COMMENT ON COLUMN custom_cases.process_image_urls IS '製作過程圖 Public URL 陣列（jsonb，product-images bucket）';

CREATE INDEX IF NOT EXISTS custom_cases_kind_idx ON custom_cases (kind) WHERE deleted_at IS NULL;

-- RLS：內部（已登入）完整存取；anon 僅能讀「已發佈的訂製案例」
-- 加工區（kind=processing）在資料庫層即擋下 anon 讀取，官網 API 無法讀到維修保養項目
ALTER TABLE custom_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_cases_authenticated_all ON custom_cases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY custom_cases_anon_read_published ON custom_cases
  FOR SELECT TO anon
  USING (kind = 'custom' AND published = true AND deleted_at IS NULL);
