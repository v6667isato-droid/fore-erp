-- 訂單退貨紀錄（MVP）：
-- 營收報表按 return_date 月份扣除 refund_amount（不回改 orders.total_amount）；
-- 發票折讓／作廢與零件庫存回沖維持手動流程（會計＞銷項發票、庫存＞盤點調整）。
CREATE TABLE IF NOT EXISTS order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  refund_amount numeric NOT NULL DEFAULT 0,
  reason text,
  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE order_returns IS '訂單退貨紀錄：營收報表按 return_date 月份扣除 refund_amount（不回改 orders.total_amount）；發票另開折讓/作廢、零件回沖用盤點調整';
COMMENT ON COLUMN order_returns.refund_amount IS '退款金額（含稅，正數；0=只退貨不退款）';

CREATE INDEX IF NOT EXISTS order_returns_order_idx ON order_returns (order_id);
CREATE INDEX IF NOT EXISTS order_returns_date_idx ON order_returns (return_date);

-- 品項明細快照品名：編輯訂單會整批重建 order_items，故 order_item_id 允許斷鏈（SET NULL）保留歷史
CREATE TABLE IF NOT EXISTS order_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  description text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

COMMENT ON TABLE order_return_items IS '退貨品項明細：description 為退貨當下品名快照，order_item_id 斷鏈後仍可讀';

CREATE INDEX IF NOT EXISTS order_return_items_return_idx ON order_return_items (return_id);

ALTER TABLE order_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_returns_authenticated_all ON order_returns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE order_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_return_items_authenticated_all ON order_return_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
