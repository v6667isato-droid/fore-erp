-- 通路商月結對帳（MVP）：
-- 1) orders.shipped_date 實際出貨日：狀態變更為「已出貨」時 trigger 自動填當天（已有值不覆寫），可手動修改；對帳按出貨月歸屬
-- 2) channel_statements 對帳單主檔（草稿→已請款→已收款）＋ channel_statement_lines 明細（金額為建立當下快照，退貨列負項）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_date date;
COMMENT ON COLUMN orders.shipped_date IS '實際出貨日：狀態改「已出貨」時 trigger 自動填當天（已有值不覆寫）；通路對帳按此歸屬月份';

CREATE OR REPLACE FUNCTION set_order_shipped_date() RETURNS trigger AS $$
BEGIN
  IF NEW.status = '已出貨'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.shipped_date IS NULL THEN
    NEW.shipped_date := CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_set_shipped_date ON orders;
CREATE TRIGGER orders_set_shipped_date
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_order_shipped_date();

CREATE TABLE IF NOT EXISTS channel_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  statement_month date NOT NULL,
  status text NOT NULL DEFAULT '草稿' CHECK (status IN ('草稿', '已請款', '已收款')),
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric,
  paid_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE channel_statements IS '通路月結對帳單：statement_month 存該月 1 號；total_amount 為明細加總快照（含退貨負項）；收款登錄時可批次將訂單 payment_status 設已結清';
COMMENT ON COLUMN channel_statements.statement_month IS '對帳月份（該月 1 號）';

CREATE INDEX IF NOT EXISTS channel_statements_channel_idx
  ON channel_statements (channel_id, statement_month);

CREATE TABLE IF NOT EXISTS channel_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES channel_statements(id) ON DELETE CASCADE,
  line_type text NOT NULL DEFAULT 'order' CHECK (line_type IN ('order', 'return', 'adjustment')),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  return_id uuid REFERENCES order_returns(id) ON DELETE SET NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE channel_statement_lines IS '對帳單明細：description 為建立當下快照（單號＋客戶）；order 列金額為正、return 列為負；amount 可於草稿階段調整';

-- 防重複請款：一張訂單／一筆退貨只能出現在一張對帳單（刪除對帳單後可重新納入）
CREATE UNIQUE INDEX IF NOT EXISTS channel_statement_lines_order_uniq
  ON channel_statement_lines (order_id) WHERE line_type = 'order' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS channel_statement_lines_return_uniq
  ON channel_statement_lines (return_id) WHERE line_type = 'return' AND return_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_statement_lines_statement_idx
  ON channel_statement_lines (statement_id);

ALTER TABLE channel_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_statements_authenticated_all ON channel_statements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE channel_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_statement_lines_authenticated_all ON channel_statement_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
