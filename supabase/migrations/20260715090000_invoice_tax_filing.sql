-- 進項發票報稅（媒體申報）欄位：格式代號、扣抵代號、課稅別、媒體檔匯出註記
ALTER TABLE accounting_invoices
  ADD COLUMN IF NOT EXISTS format_code text NOT NULL DEFAULT '25',
  ADD COLUMN IF NOT EXISTS deduction_code smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tax_type smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS exported_at timestamptz;

ALTER TABLE accounting_invoices
  DROP CONSTRAINT IF EXISTS accounting_invoices_format_code_check;
ALTER TABLE accounting_invoices
  ADD CONSTRAINT accounting_invoices_format_code_check CHECK (format_code IN ('21', '22', '25'));
ALTER TABLE accounting_invoices
  DROP CONSTRAINT IF EXISTS accounting_invoices_deduction_code_check;
ALTER TABLE accounting_invoices
  ADD CONSTRAINT accounting_invoices_deduction_code_check CHECK (deduction_code BETWEEN 1 AND 4);
ALTER TABLE accounting_invoices
  DROP CONSTRAINT IF EXISTS accounting_invoices_tax_type_check;
ALTER TABLE accounting_invoices
  ADD CONSTRAINT accounting_invoices_tax_type_check CHECK (tax_type BETWEEN 1 AND 3);

COMMENT ON COLUMN accounting_invoices.format_code IS '進項憑證格式代號：21=手開三聯式、22=二聯式收銀機、25=三聯式收銀機及電子發票';
COMMENT ON COLUMN accounting_invoices.deduction_code IS '扣抵代號：1=進貨及費用可扣抵、2=固定資產可扣抵、3=進貨及費用不可扣抵、4=固定資產不可扣抵';
COMMENT ON COLUMN accounting_invoices.tax_type IS '課稅別：1=應稅、2=零稅率、3=免稅';
COMMENT ON COLUMN accounting_invoices.exported_at IS '最近一次產出報稅媒體檔的時間；null=尚未匯出申報';

-- 公司稅籍設定（單筆 singleton，媒體檔表頭用）
CREATE TABLE IF NOT EXISTS company_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text,
  -- 統一編號（8 碼數字）
  tax_id text,
  -- 稅籍編號（9 碼數字，與統編不同，見稅籍登記證）
  tax_registration_number text,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE company_settings IS '公司稅籍設定（單筆）：統一編號與稅籍編號，報稅媒體檔每筆記錄都需要';

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_settings_authenticated_all ON company_settings;
CREATE POLICY company_settings_authenticated_all ON company_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
