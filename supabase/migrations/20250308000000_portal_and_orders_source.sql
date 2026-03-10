-- 通路商入口：客戶可設定「通路代碼」與「通路密碼」，用於 /portal 登入
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_password text;

COMMENT ON COLUMN customers.portal_code IS '通路下單入口登入代碼，唯一';
COMMENT ON COLUMN customers.portal_password IS '通路下單入口密碼（建議正式環境改為雜湊儲存）';

-- 訂單來源：區分 ERP 內部建立 vs 通路 portal 下單（總覽可顯示「通路新單」）
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'erp';

COMMENT ON COLUMN orders.source IS 'erp: 內部建立; portal: 通路商下單';
