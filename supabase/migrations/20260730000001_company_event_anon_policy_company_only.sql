-- 員工入口公告改回僅顯示「公司公告」類別（家具運送不再進公告）
-- （已於 2026-07-30 經 MCP apply_migration 套用至正式庫，此檔為版本紀錄）
DROP POLICY "company_event_select_anon_company_only" ON company_event;
CREATE POLICY "company_event_select_anon_company_only"
  ON company_event
  FOR SELECT
  TO anon
  USING (category = 'company');
