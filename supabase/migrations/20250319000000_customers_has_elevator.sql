-- 客戶送貨地址是否有電梯（供搬運／排程參考）
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS has_elevator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN customers.has_elevator IS '送貨地址是否有電梯；true=有電梯，false=無電梯';
