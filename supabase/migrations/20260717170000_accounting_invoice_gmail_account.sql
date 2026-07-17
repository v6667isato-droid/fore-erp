-- 多 Gmail 帳號支援：記錄發票信來自哪個信箱
ALTER TABLE accounting_invoices
  ADD COLUMN IF NOT EXISTS gmail_account text;

COMMENT ON COLUMN accounting_invoices.gmail_account IS 'Gmail 匯入來源信箱（多帳號時追溯用）';
