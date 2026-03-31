-- LINE Webhook：儲存文字訊息；客戶主檔以 line_user_id（或既有 line_id）對應 Messaging API 的 userId

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS line_user_id text;

COMMENT ON COLUMN customers.line_user_id IS 'LINE Messaging API 的 userId（U 開頭），Webhook 用於自動關聯客戶';

CREATE UNIQUE INDEX IF NOT EXISTS customers_line_user_id_unique
  ON customers (line_user_id)
  WHERE line_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS line_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE line_messages IS 'LINE Webhook 收到的訊息';
COMMENT ON COLUMN line_messages.line_user_id IS 'LINE source.userId';
COMMENT ON COLUMN line_messages.content IS '訊息本文';
COMMENT ON COLUMN line_messages.message_type IS '例如 text';
COMMENT ON COLUMN line_messages.customer_id IS '若 customers.line_user_id 或 line_id 相符則自動填入';

CREATE INDEX IF NOT EXISTS line_messages_created_at_idx ON line_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS line_messages_line_user_id_idx ON line_messages (line_user_id);
CREATE INDEX IF NOT EXISTS line_messages_customer_id_idx ON line_messages (customer_id);

ALTER TABLE line_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "line_messages_select_authenticated" ON line_messages;
CREATE POLICY "line_messages_select_authenticated"
  ON line_messages FOR SELECT TO authenticated
  USING (true);
