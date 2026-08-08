-- 色樣允許先建檔後補照片：image_url 改為可空。
-- 介紹表列印頁會跳過沒有照片的色樣（色樣區只顯示有圖的）。
ALTER TABLE material_swatches ALTER COLUMN image_url DROP NOT NULL;
