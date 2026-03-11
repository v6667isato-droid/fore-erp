-- 通路與客戶分開 · 通路專用價（方案2）
-- 在 Supabase Dashboard → SQL Editor 貼上整段執行

-- 通路主檔（與客戶分開：通路 = 銷售管道/價目類型，客戶 = 買方）
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE channels IS '銷售通路（直營、經銷等），與客戶分開維護';
COMMENT ON COLUMN channels.name IS '通路名稱';
COMMENT ON COLUMN channels.code IS '通路代碼（選填，用於報表或 API）';
COMMENT ON COLUMN channels.sort_order IS '排序用數字，越小越前';

-- 產品規格 × 通路 專用售價（一規格一通路一價）
CREATE TABLE IF NOT EXISTS product_variant_channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price >= 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE(variant_id, channel_id)
);

COMMENT ON TABLE product_variant_channel_prices IS '各產品規格在各通路的售價；未設定時可 fallback 用規格的 base_price';
COMMENT ON COLUMN product_variant_channel_prices.price IS '該通路下此規格的售價';

CREATE INDEX IF NOT EXISTS idx_variant_channel_prices_variant ON product_variant_channel_prices(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_channel_prices_channel ON product_variant_channel_prices(channel_id);

-- 客戶關聯通路：此客戶透過哪個通路交易，報價/訂單即用該通路價
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.channel_id IS '所屬通路；NULL 表示未指定，報價可用定價或手選通路';
