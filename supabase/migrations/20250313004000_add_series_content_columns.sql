-- 為產品系列加入文案相關欄位，對應前端 Tabs 上的欄位
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS design_concept text,
  ADD COLUMN IF NOT EXISTS social_media_copy text,
  ADD COLUMN IF NOT EXISTS website_article text,
  ADD COLUMN IF NOT EXISTS faq_scripts text,
  ADD COLUMN IF NOT EXISTS customization_rules text,
  ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN product_series.design_concept IS '系列設計理念文案';
COMMENT ON COLUMN product_series.social_media_copy IS '社群貼文／行銷文案';
COMMENT ON COLUMN product_series.website_article IS '網站長篇介紹文章';
COMMENT ON COLUMN product_series.faq_scripts IS '客服問答話術';
COMMENT ON COLUMN product_series.customization_rules IS '客製與保養說明';
COMMENT ON COLUMN product_series.website IS '系列對應的官方網站連結';

