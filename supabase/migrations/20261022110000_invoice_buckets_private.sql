-- 會計發票（accounting-invoices）與採購請款單（purchase-invoices）改為不公開。
-- 原本 bucket 為 public 且 SELECT 開給 public（含 anon）：任何拿到前端公開金鑰的人都能
-- 列出全部檔名並下載；歸檔後的會計發票檔名為「發票號碼_日期」，可被猜出。
--
-- ⚠️ 套用順序：必須等「發票附件改用限時網址」的程式部署上線後才能執行，
-- 否則線上版仍用公開網址顯示，發票縮圖與原稿會全部打不開。
--
-- ERP（authenticated）改用 createSignedUrls／download 讀檔，需要 SELECT；
-- Gmail 匯入等伺服器端走 service role，不受影響。

CREATE POLICY accounting_invoices_select_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'accounting-invoices');

CREATE POLICY purchase_invoices_select_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'purchase-invoices');

DROP POLICY IF EXISTS accounting_invoices_public_read ON storage.objects;
DROP POLICY IF EXISTS purchase_invoices_public_read ON storage.objects;

UPDATE storage.buckets SET public = false WHERE id IN ('accounting-invoices', 'purchase-invoices');
