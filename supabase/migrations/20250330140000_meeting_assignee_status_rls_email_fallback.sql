-- 已套用舊版 RLS 的專案：補上「JWT email = employees.email」備援（user_profiles.employee_id 未填時仍可勾選完成）
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
