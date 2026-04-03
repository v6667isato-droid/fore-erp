-- ERP 手動將 LINE 訊息綁定至客戶（更新 customer_id）
ALTER TABLE line_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "line_messages_update_authenticated" ON line_messages;
CREATE POLICY "line_messages_update_authenticated"
  ON line_messages FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
