-- 員工領域專用 schema（與 public.employees「員工主檔」分開命名空間）
-- 後續可將其他 HR／員工入口專用子表集中於此。
-- 注意：Supabase 專案需在 Dashboard → Settings → API → Exposed schemas 加入「employees」，
-- 前端才能以 supabase.schema('employees') 存取下列資料表。

CREATE SCHEMA IF NOT EXISTS employees;

GRANT USAGE ON SCHEMA employees TO postgres, anon, authenticated, service_role;

-- 週會／開會紀錄主檔
CREATE TABLE IF NOT EXISTS employees.meeting_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorder_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  meeting_date date NOT NULL,
  announcements text,
  weekly_work_notes text,
  feedback_notes text,
  discussion_notes text,
  created_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA employees IS '員工領域子資料（開會紀錄等）；員工主檔仍為 public.employees';
COMMENT ON TABLE employees.meeting_minutes IS '員工儀表板：開會／週會紀錄';
COMMENT ON COLUMN employees.meeting_minutes.recorder_id IS '紀錄人員（employees.id）';
COMMENT ON COLUMN employees.meeting_minutes.announcements IS '公告事項（暫不連動其他欄位）';
COMMENT ON COLUMN employees.meeting_minutes.weekly_work_notes IS '本週工作事項說明';
COMMENT ON COLUMN employees.meeting_minutes.feedback_notes IS '反應事項';
COMMENT ON COLUMN employees.meeting_minutes.discussion_notes IS '討論事項';

CREATE INDEX IF NOT EXISTS employees_meeting_minutes_meeting_date_idx
  ON employees.meeting_minutes (meeting_date DESC);

CREATE INDEX IF NOT EXISTS employees_meeting_minutes_recorder_id_idx
  ON employees.meeting_minutes (recorder_id);

-- 出席人員
CREATE TABLE IF NOT EXISTS employees.meeting_minute_attendees (
  meeting_minute_id uuid NOT NULL REFERENCES employees.meeting_minutes (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_minute_id, employee_id)
);

COMMENT ON TABLE employees.meeting_minute_attendees IS '開會紀錄出席者';

-- 交辦事項（一行＋多位負責人以 uuid[] 儲存）
CREATE TABLE IF NOT EXISTS employees.meeting_minute_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_minute_id uuid NOT NULL REFERENCES employees.meeting_minutes (id) ON DELETE CASCADE,
  content text NOT NULL,
  assignee_ids uuid[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0
);

COMMENT ON COLUMN employees.meeting_minute_assignments.assignee_ids IS '負責人 employees.id 清單';

CREATE INDEX IF NOT EXISTS employees_meeting_minute_assignments_minute_idx
  ON employees.meeting_minute_assignments (meeting_minute_id);

-- 開會文件圖片（Storage path + 公開 URL 快取）
CREATE TABLE IF NOT EXISTS employees.meeting_minute_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_minute_id uuid NOT NULL REFERENCES employees.meeting_minutes (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS employees_meeting_minute_attachments_minute_idx
  ON employees.meeting_minute_attachments (meeting_minute_id);

-- updated_at
CREATE OR REPLACE FUNCTION employees.set_meeting_minutes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_minutes_set_updated_at ON employees.meeting_minutes;
CREATE TRIGGER meeting_minutes_set_updated_at
  BEFORE UPDATE ON employees.meeting_minutes
  FOR EACH ROW
  EXECUTE PROCEDURE employees.set_meeting_minutes_updated_at();

ALTER TABLE employees.meeting_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees.meeting_minute_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees.meeting_minute_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees.meeting_minute_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_minutes_select_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_select_auth"
  ON employees.meeting_minutes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "meeting_minutes_insert_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_insert_auth"
  ON employees.meeting_minutes FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "meeting_minutes_update_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_update_auth"
  ON employees.meeting_minutes FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "meeting_minutes_delete_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_delete_auth"
  ON employees.meeting_minutes FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "meeting_minute_attendees_select_auth" ON employees.meeting_minute_attendees;
DROP POLICY IF EXISTS "meeting_minute_attendees_insert_auth" ON employees.meeting_minute_attendees;
DROP POLICY IF EXISTS "meeting_minute_attendees_update_auth" ON employees.meeting_minute_attendees;
DROP POLICY IF EXISTS "meeting_minute_attendees_delete_auth" ON employees.meeting_minute_attendees;
CREATE POLICY "meeting_minute_attendees_select_auth"
  ON employees.meeting_minute_attendees FOR SELECT TO authenticated USING (true);
CREATE POLICY "meeting_minute_attendees_insert_auth"
  ON employees.meeting_minute_attendees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "meeting_minute_attendees_update_auth"
  ON employees.meeting_minute_attendees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "meeting_minute_attendees_delete_auth"
  ON employees.meeting_minute_attendees FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "meeting_minute_assignments_select_auth" ON employees.meeting_minute_assignments;
DROP POLICY IF EXISTS "meeting_minute_assignments_insert_auth" ON employees.meeting_minute_assignments;
DROP POLICY IF EXISTS "meeting_minute_assignments_update_auth" ON employees.meeting_minute_assignments;
DROP POLICY IF EXISTS "meeting_minute_assignments_delete_auth" ON employees.meeting_minute_assignments;
CREATE POLICY "meeting_minute_assignments_select_auth"
  ON employees.meeting_minute_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "meeting_minute_assignments_insert_auth"
  ON employees.meeting_minute_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "meeting_minute_assignments_update_auth"
  ON employees.meeting_minute_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "meeting_minute_assignments_delete_auth"
  ON employees.meeting_minute_assignments FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "meeting_minute_attachments_select_auth" ON employees.meeting_minute_attachments;
DROP POLICY IF EXISTS "meeting_minute_attachments_insert_auth" ON employees.meeting_minute_attachments;
DROP POLICY IF EXISTS "meeting_minute_attachments_update_auth" ON employees.meeting_minute_attachments;
DROP POLICY IF EXISTS "meeting_minute_attachments_delete_auth" ON employees.meeting_minute_attachments;
CREATE POLICY "meeting_minute_attachments_select_auth"
  ON employees.meeting_minute_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "meeting_minute_attachments_insert_auth"
  ON employees.meeting_minute_attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "meeting_minute_attachments_update_auth"
  ON employees.meeting_minute_attachments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "meeting_minute_attachments_delete_auth"
  ON employees.meeting_minute_attachments FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA employees TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA employees TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA employees GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- Storage：開會文件圖片
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-minutes', 'meeting-minutes', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "meeting_minutes_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "meeting_minutes_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "meeting_minutes_storage_delete" ON storage.objects;
DROP POLICY IF EXISTS "meeting_minutes_storage_read" ON storage.objects;

CREATE POLICY "meeting_minutes_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meeting-minutes');

CREATE POLICY "meeting_minutes_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'meeting-minutes');

CREATE POLICY "meeting_minutes_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-minutes');

CREATE POLICY "meeting_minutes_storage_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'meeting-minutes');
