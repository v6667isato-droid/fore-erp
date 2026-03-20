-- 已登入使用者：可更新行事曆事件（ERP 編輯）
CREATE POLICY "company_event_update_authenticated"
  ON company_event
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
