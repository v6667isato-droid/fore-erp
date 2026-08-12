-- 產品系列第二張主視覺圖：官網作品牆滑鼠 hover 時顯示；null＝官網 hover 維持微放大效果
alter table product_series add column if not exists hover_image_url text;
comment on column product_series.hover_image_url is '第二張主視覺圖 Public URL（官網作品牆滑鼠 hover 時顯示）；null＝官網 hover 維持微放大效果';
