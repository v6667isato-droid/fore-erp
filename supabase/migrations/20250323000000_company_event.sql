-- 公司綜合行事曆事件（ERP 行事曆與員工入口「公司公告」資料來源）
CREATE TABLE IF NOT EXISTS company_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('company', 'production', 'event', 'memo')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_event IS '公司行事曆事件：公司／生產／事件／備忘';
COMMENT ON COLUMN company_event.title IS '標題';
COMMENT ON COLUMN company_event.event_date IS '事件日期（月曆格／公告日）';
COMMENT ON COLUMN company_event.category IS 'company=公司公告; production=生產; event=事件; memo=備忘';
COMMENT ON COLUMN company_event.description IS '描述';

CREATE INDEX IF NOT EXISTS company_event_event_date_idx ON company_event (event_date);
CREATE INDEX IF NOT EXISTS company_event_category_event_date_idx ON company_event (category, event_date DESC);

ALTER TABLE company_event ENABLE ROW LEVEL SECURITY;

-- 已登入使用者：可查詢全部（ERP 月曆）
CREATE POLICY "company_event_select_authenticated"
  ON company_event
  FOR SELECT
  TO authenticated
  USING (true);

-- 未登入（員工入口）：僅可讀「公司」類別，供公司公告列表
CREATE POLICY "company_event_select_anon_company_only"
  ON company_event
  FOR SELECT
  TO anon
  USING (category = 'company');

-- 已登入使用者：可新增（ERP「新增事件」）
CREATE POLICY "company_event_insert_authenticated"
  ON company_event
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
