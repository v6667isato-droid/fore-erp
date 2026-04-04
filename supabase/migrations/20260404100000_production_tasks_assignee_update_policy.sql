-- 員工儀表板「生產交辦」：承辦人可更新自己的 production_tasks.status
-- 依賴 employees.is_meeting_assignee_actor（與開會交辦相同：user_profiles.employee_id 或 email 對應）
-- 若專案中尚無 public.production_tasks，此檔會略過。

DO $body$
BEGIN
  IF to_regclass('public.production_tasks') IS NULL THEN
    RAISE NOTICE 'Skipping: public.production_tasks not found';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "production_tasks_employee_update_own_status" ON public.production_tasks';

  EXECUTE $pol$
    CREATE POLICY "production_tasks_employee_update_own_status"
      ON public.production_tasks FOR UPDATE TO authenticated
      USING (
        employee_id IS NOT NULL
        AND employees.is_meeting_assignee_actor(employee_id)
      )
      WITH CHECK (
        employee_id IS NOT NULL
        AND employees.is_meeting_assignee_actor(employee_id)
      );
  $pol$;
END;
$body$;
