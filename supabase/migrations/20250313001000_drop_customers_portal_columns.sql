-- 將通路登入資訊由 customers 移轉至 channels 後，移除 customers 上不再使用的欄位
ALTER TABLE customers
  DROP COLUMN IF EXISTS portal_code,
  DROP COLUMN IF EXISTS portal_password;

