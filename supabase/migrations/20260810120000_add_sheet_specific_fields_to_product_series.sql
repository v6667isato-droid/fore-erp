-- 介紹表專用欄位：主視覺圖／設計理念／客製與保養與產品資料脫鉤
-- null＝沿用產品資料對應欄位（image_url／design_concept／customization_rules）
alter table public.product_series
  add column if not exists sheet_hero_image_url text,
  add column if not exists sheet_design_concept text,
  add column if not exists sheet_customization_rules text;

comment on column public.product_series.sheet_hero_image_url is '介紹表第一頁主視覺圖（獨立於產品資料 image_url；null=沿用 image_url）';
comment on column public.product_series.sheet_design_concept is '介紹表設計理念（獨立於 design_concept；null=沿用）';
comment on column public.product_series.sheet_customization_rules is '介紹表客製與保養（獨立於 customization_rules；null=沿用）';
