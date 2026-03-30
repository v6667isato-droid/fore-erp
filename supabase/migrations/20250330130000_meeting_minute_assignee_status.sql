-- 與 leave_requests、daily_attendance 等 RLS 相同：需能將登入者對應到 employees.id
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_profiles_employee_id_idx
  ON public.user_profiles (employee_id)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.employee_id IS '對應 public.employees.id；供員工入口、假單、開會交辦等 RLS';

-- 開會交辦：每位負責人可勾選「已完成」，並在歷史紀錄中顯示
CREATE TABLE IF NOT EXISTS employees.meeting_minute_assignee_status (
  assignment_id uuid NOT NULL REFERENCES employees.meeting_minute_assignments (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, employee_id)
);

CREATE INDEX IF NOT EXISTS meeting_minute_assignee_status_employee_idx
  ON employees.meeting_minute_assignee_status (employee_id);

COMMENT ON TABLE employees.meeting_minute_assignee_status IS '開會交辦：負責人完成狀態（與 assignee_ids 對應）';

ALTER TABLE employees.meeting_minute_assignee_status ENABLE ROW LEVEL SECURITY;

-- 已登入可讀全部（歷史紀錄顯示各人狀態）
DROP POLICY IF EXISTS "meeting_assignee_status_select_auth" ON employees.meeting_minute_assignee_status;
CREATE POLICY "meeting_assignee_status_select_auth"
  ON employees.meeting_minute_assignee_status FOR SELECT TO authenticated
  USING (true);

-- 僅能寫入「自己」為負責人之列：① user_profiles.employee_id 或 ② employees.email 與 JWT email（員工入口常用）
DROP POLICY IF EXISTS "meeting_assignee_status_insert_own" ON employees.meeting_minute_assignee_status;
CREATE POLICY "meeting_assignee_status_insert_own"
  ON employees.meeting_minute_assignee_status FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees.meeting_minute_assignments a
      WHERE a.id = meeting_minute_assignee_status.assignment_id
        AND a.assignee_ids @> ARRAY[meeting_minute_assignee_status.employee_id]::uuid[]
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.employee_id IS NOT NULL
          AND up.employee_id = meeting_minute_assignee_status.employee_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = meeting_minute_assignee_status.employee_id
          AND e.email IS NOT NULL
          AND trim(e.email) <> ''
          AND lower(trim(e.email)) = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
      )
    )
  );

DROP POLICY IF EXISTS "meeting_assignee_status_update_own" ON employees.meeting_minute_assignee_status;
CREATE POLICY "meeting_assignee_status_update_own"
  ON employees.meeting_minute_assignee_status FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees.meeting_minute_assignments a
      WHERE a.id = meeting_minute_assignee_status.assignment_id
        AND a.assignee_ids @> ARRAY[meeting_minute_assignee_status.employee_id]::uuid[]
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.employee_id IS NOT NULL
          AND up.employee_id = meeting_minute_assignee_status.employee_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = meeting_minute_assignee_status.employee_id
          AND e.email IS NOT NULL
          AND trim(e.email) <> ''
          AND lower(trim(e.email)) = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees.meeting_minute_assignments a
      WHERE a.id = meeting_minute_assignee_status.assignment_id
        AND a.assignee_ids @> ARRAY[meeting_minute_assignee_status.employee_id]::uuid[]
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.employee_id IS NOT NULL
          AND up.employee_id = meeting_minute_assignee_status.employee_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = meeting_minute_assignee_status.employee_id
          AND e.email IS NOT NULL
          AND trim(e.email) <> ''
          AND lower(trim(e.email)) = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
      )
    )
  );

GRANT SELECT, INSERT, UPDATE ON employees.meeting_minute_assignee_status TO authenticated;
