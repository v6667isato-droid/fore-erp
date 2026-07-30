-- 行事曆事件類別改版（已於 2026-07-30 經 MCP apply_migration 套用至正式庫，此檔為版本紀錄）：
-- 新類別：delivery=家具運送(全員可見)、visit=參觀預約(負責人)、task=交辦事項(負責人)、
--         company=公司公告(全員可見，沿用舊值)、other=其他事項(負責人)
-- 舊資料對應：production(過去僅 Telegram 交辦寫入)→task；event/memo→other
ALTER TABLE company_event DROP CONSTRAINT company_event_category_check;

UPDATE company_event SET category = 'task' WHERE category = 'production';
UPDATE company_event SET category = 'other' WHERE category IN ('event', 'memo');

-- 'production' 暫時保留：fore-telegram-bot 改版部署前仍以 production 寫入交辦，前端一律視為 task
ALTER TABLE company_event ADD CONSTRAINT company_event_category_check
  CHECK (category IN ('company', 'delivery', 'visit', 'task', 'other', 'production'));

COMMENT ON TABLE company_event IS '公司行事曆事件：家具運送／參觀預約／交辦事項／公司公告／其他事項';
COMMENT ON COLUMN company_event.category IS 'delivery=家具運送(全員公告); visit=參觀預約(負責人); task=交辦事項(負責人); company=公司公告(全員公告); other=其他事項(負責人); production=舊值，一律視同 task';

-- 未登入（員工入口）公告：公司公告＋家具運送 全員可見
DROP POLICY "company_event_select_anon_company_only" ON company_event;
CREATE POLICY "company_event_select_anon_company_only"
  ON company_event
  FOR SELECT
  TO anon
  USING (category IN ('company', 'delivery'));
