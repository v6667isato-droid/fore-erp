-- RLS 改為呼叫 SECURITY DEFINER 函式：以 auth.users.email 比對 employees（與登入帳號一致）
-- 另：user_profiles.user_id = auth.uid() 且 employee_id 已填時亦允許

CREATE OR REPLACE FUNCTION employees.is_meeting_assignee_actor(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.employee_id IS NOT NULL
        AND up.employee_id = p_employee_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.employees e
      INNER JOIN auth.users u ON u.id = auth.uid()
      WHERE e.id = p_employee_id
        AND e.email IS NOT NULL
        AND trim(e.email) <> ''
        AND u.email IS NOT NULL
        AND trim(u.email) <> ''
        AND lower(trim(e.email)) = lower(trim(u.email))
    )
    OR EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = p_employee_id
        AND e.email IS NOT NULL
        AND trim(e.email) <> ''
        AND COALESCE(auth.jwt() ->> 'email', '') <> ''
        AND lower(trim(e.email)) = lower(trim(auth.jwt() ->> 'email'))
    );
$$;

COMMENT ON FUNCTION employees.is_meeting_assignee_actor(uuid) IS
  '開會交辦 RLS：目前登入者是否可代表 p_employee_id（user_profiles.employee_id 或 employees.email = auth.users.email）';

REVOKE ALL ON FUNCTION employees.is_meeting_assignee_actor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION employees.is_meeting_assignee_actor(uuid) TO authenticated;

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
    AND employees.is_meeting_assignee_actor(meeting_minute_assignee_status.employee_id)
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
    AND employees.is_meeting_assignee_actor(meeting_minute_assignee_status.employee_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees.meeting_minute_assignments a
      WHERE a.id = meeting_minute_assignee_status.assignment_id
        AND a.assignee_ids @> ARRAY[meeting_minute_assignee_status.employee_id]::uuid[]
    )
    AND employees.is_meeting_assignee_actor(meeting_minute_assignee_status.employee_id)
  );
