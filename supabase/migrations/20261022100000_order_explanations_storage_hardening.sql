-- 訂單說明圖／通路製作圖（order-explanations bucket）收緊權限。
-- 原本三條 policy 都開給 public（含 anon），任何拿到前端公開金鑰的人都能
-- 列出全部檔名、上傳任意檔案、刪除任何檔案。
--
-- - 刪除：程式從不刪這個 bucket 的檔案（移除說明圖只改訂單欄位），整條拿掉。
-- - 列出：ERP（authenticated）照舊；anon（/portal 不是 Supabase Auth）只看得到
--   10 分鐘內上傳的檔案——上傳時 storage 寫入 objects 若帶 RETURNING 需要能讀到新列，
--   保留這個窗口確保通路上傳製作圖不受影響，舊檔名則無法再被列出。
--   顯示圖片走 public bucket 網址（/object/public/...），不需 SELECT。
-- - 上傳：/portal 與 ERP 都要用，保留；限制為圖片且 10MB 以內（目前檔案皆為 JPG/PNG、最大約 3MB）。

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
WHERE id = 'order-explanations';

DROP POLICY IF EXISTS "images_authenticated h63teh_0" ON storage.objects;
DROP POLICY IF EXISTS "images_authenticated h63teh_2" ON storage.objects;

CREATE POLICY order_explanations_select_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-explanations');

CREATE POLICY order_explanations_select_anon_recent ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'order-explanations' AND created_at > now() - interval '10 minutes');
