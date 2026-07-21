-- 語意擴充：channel_unit_price 改為「通路價快照」——
-- 規格品由訂單儲存時依「客戶通路 × 系列折扣 %」計算寫入（Math.round(base_price * (1 - pct/100))），
-- 客製品項維持手動輸入。NULL 表示無通路價，結算時用 unit_price（牌價）。
-- 統計、發票等頁面可直接讀取此欄位，不需重算。
COMMENT ON COLUMN order_items.channel_unit_price IS
  '通路價快照：規格品於儲存訂單時依「客戶通路 × 系列折扣 %」計算寫入；客製品項為手動輸入。NULL 表示無通路價，結算時用 unit_price（牌價）';

-- 回填既有規格品項的通路價（依目前折扣設定；四捨五入與前端 Math.round 一致）
UPDATE order_items oi
SET channel_unit_price = round(pv.base_price * (1 - d.discount_percent / 100.0))
FROM orders o,
     customers c,
     product_variants pv,
     product_series_channel_discounts d
WHERE o.id = oi.order_id
  AND c.id = o.customer_id
  AND pv.id = oi.variant_id
  AND d.series_id = pv.series_id
  AND d.channel_id = c.channel_id
  AND d.discount_percent > 0
  AND pv.base_price IS NOT NULL
  AND oi.channel_unit_price IS NULL;
