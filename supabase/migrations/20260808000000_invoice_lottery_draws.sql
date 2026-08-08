-- 統一發票中獎號碼（每期一筆）：家庭發票（無買方統編）自動兌獎用
-- 資料來源：財政部 https://invoice.etax.nat.gov.tw/invoice.xml（只提供最近 6 期，故本表累積保存）
CREATE TABLE IF NOT EXISTS invoice_lottery_draws (
  -- 期別起月（西元 YYYY-MM，僅奇數月）：'2026-05' = 115年 05~06月
  period text PRIMARY KEY CHECK (period ~ '^\d{4}-(01|03|05|07|09|11)$'),
  -- 民國期別標籤，如 '115年 05~06月'
  label text NOT NULL,
  -- 特別獎（8 碼全對，1000 萬）
  special_prize text NOT NULL CHECK (special_prize ~ '^\d{8}$'),
  -- 特獎（8 碼全對，200 萬）
  grand_prize text NOT NULL CHECK (grand_prize ~ '^\d{8}$'),
  -- 頭獎號碼（通常 3 組）；末 8~3 碼相符對應頭獎至六獎
  first_prizes text[] NOT NULL DEFAULT '{}',
  -- 增開六獎（末 3 碼，部分期別才有）
  sixth_extra_prizes text[] NOT NULL DEFAULT '{}',
  source_url text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoice_lottery_draws IS '統一發票中獎號碼（每期一筆），由 /api/invoice-lottery 自財政部 RSS 同步';
COMMENT ON COLUMN invoice_lottery_draws.period IS '期別起月（西元 YYYY-MM，奇數月）：2026-05 = 115年 05~06月';
COMMENT ON COLUMN invoice_lottery_draws.first_prizes IS '頭獎號碼陣列；末 8 碼=頭獎、7=二獎、6=三獎、5=四獎、4=五獎、3=六獎';
COMMENT ON COLUMN invoice_lottery_draws.sixth_extra_prizes IS '增開六獎末 3 碼陣列（部分期別無）';

ALTER TABLE invoice_lottery_draws ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_lottery_draws_authenticated_all ON invoice_lottery_draws;
CREATE POLICY invoice_lottery_draws_authenticated_all ON invoice_lottery_draws
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
