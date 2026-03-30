-- 開會紀錄：僅 admin / manager 可更新、刪除主檔（一般員工仍可新增）
CREATE OR REPLACE FUNCTION employees.is_meeting_admin_or_manager()
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
      AND lower(trim(COALESCE(up.role::text, ''))) IN ('admin', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION employees.is_meeting_admin_or_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION employees.is_meeting_admin_or_manager() TO authenticated;

DROP POLICY IF EXISTS "meeting_minutes_update_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_update_admin_managers"
  ON employees.meeting_minutes FOR UPDATE TO authenticated
  USING (employees.is_meeting_admin_or_manager())
  WITH CHECK (employees.is_meeting_admin_or_manager());

DROP POLICY IF EXISTS "meeting_minutes_delete_auth" ON employees.meeting_minutes;
CREATE POLICY "meeting_minutes_delete_admin_managers"
  ON employees.meeting_minutes FOR DELETE TO authenticated
  USING (employees.is_meeting_admin_or_manager());
