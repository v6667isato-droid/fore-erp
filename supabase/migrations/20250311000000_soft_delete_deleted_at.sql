-- 軟刪除：各表新增 deleted_at，刪除時只標記不真正刪除，可還原（需管理員確認）
-- 執行方式：在 Supabase Dashboard → SQL Editor 貼上此檔內容執行，或使用 supabase db push

ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN user_feedback.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN orders.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN customers.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN vendors.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN employees.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE product_series
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN product_series.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN product_variants.deleted_at IS '軟刪除時間；NULL 表示未刪除';

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN purchases.deleted_at IS '軟刪除時間；NULL 表示未刪除';
