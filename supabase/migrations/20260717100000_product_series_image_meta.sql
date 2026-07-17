-- 產品系列圖片中繼資料（官網顯示用）
-- image_meta：以圖片 Public URL 為 key 的 jsonb 物件，值為
--   { "title_zh": "圖片標題（中）", "title_en": "圖片標題（英）", "object_position": "50% 30%" }
-- 適用主視覺圖與細節圖；object_position 為官網 4:5 裁切時的焦點（CSS object-position），留空為置中
alter table public.product_series
  add column if not exists image_meta jsonb not null default '{}'::jsonb;
