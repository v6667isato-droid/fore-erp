-- 產品系列主視覺圖 URL（Supabase Storage product-images bucket）
ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN product_series.image_url IS '產品系列主視覺圖 Public URL（來自 product-images bucket）';

-- 建立公開 Storage bucket：product-images（若已存在則略過）
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 以下政策：若你已在 Dashboard 手動建過同名政策，請在 Supabase SQL Editor 略過或先刪除同名再執行
DROP POLICY IF EXISTS "product_images_upload" ON storage.objects;
DROP POLICY IF EXISTS "product_images_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;

CREATE POLICY "product_images_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'product-images');
