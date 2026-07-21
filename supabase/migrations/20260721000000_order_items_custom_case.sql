-- 訂單品項對應訂製案例／加工區（custom_cases）：
--   開單時品項類型新增「訂製案例」「加工項目」，從 custom_cases 挑選並回填此欄，
--   名稱／類別／尺寸／價格仍寫入既有 custom_* 欄位（列印、統計頁不需改動）
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS custom_case_id uuid REFERENCES custom_cases(id) ON DELETE SET NULL;

COMMENT ON COLUMN order_items.custom_case_id IS '來源 custom_cases（訂製案例 kind=custom／加工區 kind=processing）；純手填客製品項為 NULL';

CREATE INDEX IF NOT EXISTS order_items_custom_case_id_idx
  ON order_items (custom_case_id)
  WHERE custom_case_id IS NOT NULL;
