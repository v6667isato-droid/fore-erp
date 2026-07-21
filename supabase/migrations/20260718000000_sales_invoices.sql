-- 銷項發票（開立給客戶的統一發票）：可由訂單開立（一單可拆多張，如訂金＋尾款），
-- B2B（買方統編）與 B2C（載具／捐贈／紙本）皆支援；預留光賀加值中心同步欄位，
-- 串接前可先以「手開登記」方式使用（自行輸入字軌號碼）。
CREATE TABLE IF NOT EXISTS sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 來源訂單（可空：允許開立與訂單無關的發票）；一張訂單可對應多張發票
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  -- B2B=買方有統編（開立三聯式／電子發票含買方統編）；B2C=一般消費者（載具／捐贈／紙本）
  invoice_type text NOT NULL DEFAULT 'B2B' CHECK (invoice_type IN ('B2B', 'B2C')),
  -- 統一發票號碼（2 碼字軌＋8 碼數字，存為 XX-12345678，同進項慣例）；draft 階段可空
  invoice_number text,
  invoice_date date,
  -- 買方資訊：B2B 必填抬頭與統編；B2C 可空
  buyer_name text,
  buyer_tax_id text,
  -- 電子發票開立通知／寄送用信箱
  buyer_email text,
  -- B2C 載具：類別代號（如 3J0002 手機條碼、CQ0001 自然人憑證）＋載具號碼
  carrier_type text,
  carrier_id text,
  -- B2C 捐贈碼（有值表示捐贈，與載具、紙本互斥）
  donation_code text,
  -- B2C 是否印製紙本（索取證明聯）
  print_flag boolean NOT NULL DEFAULT false,
  -- 課稅別：1 應稅 / 2 零稅率 / 3 免稅（同 accounting_invoices.tax_type 慣例）
  tax_type integer NOT NULL DEFAULT 1,
  amount_ex_tax numeric,
  tax_amount numeric,
  amount_inc_tax numeric,
  -- draft=草稿（未取號）/ issued=已開立 / voided=已作廢（跨期請改開折讓單）
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'voided')),
  issued_at timestamptz,
  void_date date,
  void_reason text,
  -- 光賀加值中心同步狀態：none=未送（手開登記）/ pending=待送 / sent=已送出 /
  -- confirmed=光賀回覆成功 / failed=失敗（見 sync_error，可重送）
  sync_status text NOT NULL DEFAULT 'none'
    CHECK (sync_status IN ('none', 'pending', 'sent', 'confirmed', 'failed')),
  -- 光賀端的單據識別碼（回傳後寫入，供查詢／作廢／折讓對應）
  external_id text,
  synced_at timestamptz,
  sync_error text,
  -- 銷項 401 媒體檔匯出時間（同進項 exported_at 慣例）
  exported_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE sales_invoices IS '銷項發票：由訂單開立（可一單多張），B2B/B2C，預留光賀加值中心同步欄位';
COMMENT ON COLUMN sales_invoices.invoice_number IS '統一發票號碼（2 碼字軌＋8 碼數字，存為 XX-12345678）';
COMMENT ON COLUMN sales_invoices.donation_code IS 'B2C 捐贈碼；與載具、紙本互斥';

CREATE INDEX IF NOT EXISTS sales_invoices_order_idx ON sales_invoices (order_id);
CREATE INDEX IF NOT EXISTS sales_invoices_invoice_date_idx ON sales_invoices (invoice_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_status_idx ON sales_invoices (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_sync_status_idx ON sales_invoices (sync_status)
  WHERE deleted_at IS NULL AND sync_status IN ('pending', 'failed');
-- 發票號碼不得重複（作廢仍占號，故不限 status；draft 未取號為 NULL 不受限）
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_unique
  ON sales_invoices (invoice_number)
  WHERE deleted_at IS NULL AND invoice_number IS NOT NULL;

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_invoices_authenticated_all ON sales_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 發票明細：預設自 order_items 帶入，品名／數量／單價可手動調整（發票品名常與內部品名不同）
CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  -- 對應的訂單明細（可空：手動加列或拆開訂金／尾款時無一對一關係）
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric,
  -- 小計（單價×數量）；含稅或未稅基準依主檔 invoice_type：B2C 含稅、B2B 未稅（電子發票 MIG 慣例）
  amount numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE sales_invoice_items IS '銷項發票明細：預設自 order_items 帶入，可手動調整品名與金額';

CREATE INDEX IF NOT EXISTS sales_invoice_items_invoice_idx ON sales_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS sales_invoice_items_order_item_idx ON sales_invoice_items (order_item_id);

ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_invoice_items_authenticated_all ON sales_invoice_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 折讓單：發票跨期不可作廢時開立銷貨折讓（金額為折讓額，正數）
CREATE TABLE IF NOT EXISTS sales_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  -- 折讓單號（電子折讓由光賀配號；手開登記自行輸入）
  allowance_number text,
  allowance_date date,
  amount_ex_tax numeric,
  tax_amount numeric,
  amount_inc_tax numeric,
  reason text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'voided')),
  sync_status text NOT NULL DEFAULT 'none'
    CHECK (sync_status IN ('none', 'pending', 'sent', 'confirmed', 'failed')),
  external_id text,
  synced_at timestamptz,
  sync_error text,
  exported_at timestamptz,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE sales_allowances IS '銷貨折讓單：掛在某張銷項發票下，跨期更正用（作廢限當期）';

CREATE INDEX IF NOT EXISTS sales_allowances_invoice_idx ON sales_allowances (invoice_id);
CREATE INDEX IF NOT EXISTS sales_allowances_date_idx ON sales_allowances (allowance_date) WHERE deleted_at IS NULL;

ALTER TABLE sales_allowances ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_allowances_authenticated_all ON sales_allowances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 客戶檔補發票欄位：開票時自動帶入預設值
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS invoice_title text,
  ADD COLUMN IF NOT EXISTS invoice_email text,
  ADD COLUMN IF NOT EXISTS invoice_carrier text;

COMMENT ON COLUMN customers.invoice_title IS '發票抬頭（可能與客戶名稱不同；空值時開票帶入 name／company）';
COMMENT ON COLUMN customers.invoice_email IS '電子發票寄送信箱（空值時帶入其他聯絡方式）';
COMMENT ON COLUMN customers.invoice_carrier IS 'B2C 常用載具（手機條碼，格式 /XXXXXXX）';
