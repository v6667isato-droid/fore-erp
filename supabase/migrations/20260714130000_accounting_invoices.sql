-- 會計發票：批次上傳統一發票→AI 辨識→人工審核→對應採購單存檔
CREATE TABLE IF NOT EXISTS accounting_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- accounting-invoices bucket 內路徑；上傳時放 inbox/，審核存檔後移至 archive/{賣方}/{日期}/
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  media_type text,
  -- pending=待辨識 / ready=待審核 / failed=辨識失敗 / confirmed=已審核存檔
  status text NOT NULL DEFAULT 'pending',
  -- AI 辨識結果（RecognizedTaxInvoice JSON），人工審核時帶入
  recognized jsonb,
  error text,
  -- 以下為人工審核確認後的正式欄位
  invoice_number text,
  invoice_date date,
  seller_name text,
  seller_tax_id text,
  buyer_tax_id text,
  amount_ex_tax numeric,
  tax_amount numeric,
  amount_inc_tax numeric,
  -- 對應的採購單（可空：找不到對應時仍可存檔）
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  deleted_at timestamptz
);

COMMENT ON TABLE accounting_invoices IS '會計發票：批次上傳→AI 辨識→人工審核→對應採購單存檔（含稅金額、發票號碼）';
COMMENT ON COLUMN accounting_invoices.invoice_number IS '統一發票號碼（2 碼英文＋8 碼數字，存為 XX-12345678）';
COMMENT ON COLUMN accounting_invoices.amount_inc_tax IS '含稅金額（發票總計）';

CREATE INDEX IF NOT EXISTS accounting_invoices_status_idx ON accounting_invoices (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS accounting_invoices_invoice_date_idx ON accounting_invoices (invoice_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS accounting_invoices_po_idx ON accounting_invoices (purchase_order_id);
-- 已存檔發票號碼不得重複（防重複建檔）
CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoices_number_unique
  ON accounting_invoices (invoice_number)
  WHERE deleted_at IS NULL AND status = 'confirmed' AND invoice_number IS NOT NULL;

ALTER TABLE accounting_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_invoices_authenticated_all ON accounting_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 發票附件 Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('accounting-invoices', 'accounting-invoices', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "accounting_invoices_upload" ON storage.objects;
DROP POLICY IF EXISTS "accounting_invoices_update" ON storage.objects;
DROP POLICY IF EXISTS "accounting_invoices_delete" ON storage.objects;
DROP POLICY IF EXISTS "accounting_invoices_public_read" ON storage.objects;

CREATE POLICY "accounting_invoices_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'accounting-invoices');

CREATE POLICY "accounting_invoices_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'accounting-invoices');

CREATE POLICY "accounting_invoices_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'accounting-invoices');

CREATE POLICY "accounting_invoices_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'accounting-invoices');
