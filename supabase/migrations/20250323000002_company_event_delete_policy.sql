-- 已登入使用者：可刪除行事曆事件（ERP）
CREATE POLICY "company_event_delete_authenticated"
  ON company_event
  FOR DELETE
  TO authenticated
  USING (true);
