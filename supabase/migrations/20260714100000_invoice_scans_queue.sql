-- 請款單批次上傳待審佇列：拍照上傳先進佇列並背景辨識，員工有空再逐張人工審核建檔
CREATE TABLE IF NOT EXISTS invoice_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- purchase-invoices bucket 內路徑；上傳時放 inbox/，建檔歸檔後移至 archive/{廠商}/{日期}/
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  media_type text,
  -- pending=待辨識 / ready=待審核 / failed=辨識失敗 / archived=已建檔歸檔
  status text NOT NULL DEFAULT 'pending',
  -- 辨識結果（RecognizedInvoice JSON），人工審核時帶入
  recognized jsonb,
  error text,
  -- 建檔後關聯的採購單
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  deleted_at timestamptz
);

COMMENT ON TABLE invoice_scans IS '請款單掃描佇列：批次上傳→AI 辨識→人工審核→建檔歸檔';

CREATE INDEX IF NOT EXISTS invoice_scans_status_idx ON invoice_scans (status) WHERE deleted_at IS NULL;

ALTER TABLE invoice_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_scans_authenticated_all ON invoice_scans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
