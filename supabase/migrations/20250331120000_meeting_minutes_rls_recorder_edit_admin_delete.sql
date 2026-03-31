-- 開會紀錄：紀錄人（recorder_id 對應登入者）可更新；僅 admin 可刪除（manager 不再可刪）

CREATE OR REPLACE FUNCTION employees.is_meeting_admin_only()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
  );
$$;

COMMENT ON FUNCTION employees.is_meeting_admin_only() IS '開會紀錄刪除 RLS：僅 user_profiles.role = admin';

REVOKE ALL ON FUNCTION employees.is_meeting_admin_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION employees.is_meeting_admin_only() TO authenticated;

DROP POLICY IF EXISTS "meeting_minutes_update_admin_managers" ON employees.meeting_minutes;
DROP POLICY IF EXISTS "meeting_minutes_update_auth" ON employees.meeting_minutes;

CREATE POLICY "meeting_minutes_update_recorder_or_admin"
  ON employees.meeting_minutes FOR UPDATE TO authenticated
  USING (
    employees.is_meeting_admin_or_manager()
    OR employees.is_meeting_assignee_actor(recorder_id)
  )
  WITH CHECK (
    employees.is_meeting_admin_or_manager()
    OR employees.is_meeting_assignee_actor(recorder_id)
  );

DROP POLICY IF EXISTS "meeting_minutes_delete_admin_managers" ON employees.meeting_minutes;
DROP POLICY IF EXISTS "meeting_minutes_delete_admin_only" ON employees.meeting_minutes;

CREATE POLICY "meeting_minutes_delete_admin_only"
  ON employees.meeting_minutes FOR DELETE TO authenticated
  USING (employees.is_meeting_admin_only());
