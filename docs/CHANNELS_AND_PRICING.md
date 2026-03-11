# 通路與客戶分開 · 通路專用價（方案2）

## 概念

- **通路 (channels)**：銷售管道／價目類型，例如「直營」「經銷 A」「電商」。獨立主檔，與客戶分開。
- **客戶 (customers)**：實際買方。可指定「所屬通路」(`channel_id`)，該客戶的報價/訂單即用該通路的產品售價。
- **產品規格 × 通路售價**：同一規格在不同通路可有不同售價，存在 `product_variant_channel_prices`。

關係簡述：

- 一個**客戶**可關聯一個**通路**（或不關聯）。
- 一個**通路**下，每個**產品規格**可有一筆**售價**；未設定時可 fallback 用規格的 `base_price`（定價）。

## 資料庫設定

### 執行 migration

在 Supabase Dashboard → **SQL Editor** 貼上並執行：

```sql
-- 通路主檔
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE channels IS '銷售通路（直營、經銷等），與客戶分開維護';

-- 規格 × 通路 售價
CREATE TABLE IF NOT EXISTS product_variant_channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price >= 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE(variant_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_channel_prices_variant ON product_variant_channel_prices(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_channel_prices_channel ON product_variant_channel_prices(channel_id);

-- 客戶關聯通路
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;
```

或使用專案內 migration 檔：

- `supabase/migrations/20250312000000_channels_and_variant_prices.sql`

（執行方式：`supabase db push` 或複製內容到 SQL Editor 執行。）

## 取價邏輯建議

1. 訂單/報價時若有**客戶**：用 `customer.channel_id`。
2. 若有 **channel_id**：從 `product_variant_channel_prices` 查 `(variant_id, channel_id)` 取得 `price`；沒有則用 `product_variants.base_price`。
3. 若客戶無 `channel_id`：可用 `base_price`，或由操作人員在畫面上選擇「本次使用通路」再依該通路取價。

## 後續可做的畫面

- **通路管理**：新增/編輯/停用通路（channels）。
- **產品資料**：在規格上維護「各通路售價」（寫入 `product_variant_channel_prices`）。
- **客戶資料**：欄位「所屬通路」下拉選 channels。
- **訂單/報價**：帶入客戶通路或手選通路，依通路取規格售價。
