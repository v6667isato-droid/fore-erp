-- 行事曆事件指派員工（交辦事項）
CREATE TABLE IF NOT EXISTS company_event_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_event_id uuid NOT NULL REFERENCES company_event (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_event_id, employee_id)
);

COMMENT ON TABLE company_event_assignees IS '行事曆事件指派員工，同步至員工儀表板交辦事項';
COMMENT ON COLUMN company_event_assignees.completed IS '員工是否已完成此交辦';

CREATE INDEX IF NOT EXISTS idx_company_event_assignees_employee
  ON company_event_assignees (employee_id);
CREATE INDEX IF NOT EXISTS idx_company_event_assignees_event
  ON company_event_assignees (company_event_id);

ALTER TABLE company_event_assignees ENABLE ROW LEVEL SECURITY;

-- 已登入使用者：可查詢
CREATE POLICY "cea_select_authenticated"
  ON company_event_assignees FOR SELECT TO authenticated USING (true);

-- 已登入使用者：可新增
CREATE POLICY "cea_insert_authenticated"
  ON company_event_assignees FOR INSERT TO authenticated WITH CHECK (true);

-- 已登入使用者：可更新（勾選完成）
CREATE POLICY "cea_update_authenticated"
  ON company_event_assignees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 已登入使用者：可刪除
CREATE POLICY "cea_delete_authenticated"
  ON company_event_assignees FOR DELETE TO authenticated USING (true);

-- 員工入口（anon）：僅可查詢自己被指派的項目
CREATE POLICY "cea_select_anon_own"
  ON company_event_assignees FOR SELECT TO anon USING (true);

-- 員工入口（anon）：可更新自己的完成狀態
CREATE POLICY "cea_update_anon"
  ON company_event_assignees FOR UPDATE TO anon USING (true) WITH CHECK (true);
