-- fore-furniture.com 透過 GET /api/products/[id] 讀取 design_concept / website_article / customization_rules
-- 顯示在 /works/[id] 的設計理念與客製說明區塊，更新欄位備註以反映這個用途
COMMENT ON COLUMN product_series.design_concept IS '系列設計理念文案（亦用於 fore-furniture.com /works/[id]）';
COMMENT ON COLUMN product_series.website_article IS '網站長篇介紹文章（fore-furniture.com /works/[id] 讀取顯示）';
COMMENT ON COLUMN product_series.customization_rules IS '客製與保養說明（fore-furniture.com /works/[id] 讀取顯示）';
