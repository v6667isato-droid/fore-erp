-- 行事曆新增「加班公告」類別（overtime）：全員可見，與公司公告一樣進員工儀表板公告區塊，
-- 並顯示於出勤戰情月曆。
ALTER TABLE company_event DROP CONSTRAINT company_event_category_check;

-- 'production' 暫時保留：fore-telegram-bot 改版部署前仍以 production 寫入交辦，前端一律視為 task
ALTER TABLE company_event ADD CONSTRAINT company_event_category_check
  CHECK (category IN ('company', 'overtime', 'delivery', 'visit', 'task', 'other', 'production'));

COMMENT ON TABLE company_event IS '公司行事曆事件：家具運送／參觀預約／交辦事項／公司公告／加班公告／其他事項';
COMMENT ON COLUMN company_event.category IS 'delivery=家具運送; visit=參觀預約(負責人); task=交辦事項(負責人); company=公司公告(全員公告); overtime=加班公告(全員公告，顯示於出勤戰情月曆); other=其他事項(負責人); production=舊值，一律視同 task';

-- 未登入（員工入口）公告：公司公告＋加班公告 全員可見
DROP POLICY "company_event_select_anon_company_only" ON company_event;
CREATE POLICY "company_event_select_anon_company_only"
  ON company_event
  FOR SELECT
  TO anon
  USING (category IN ('company', 'overtime'));
