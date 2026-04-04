-- 生產交辦：除 production_tasks.employee_id 外，亦允許「工單負責人」work_orders.assignee
-- 與 employees.name 相符者更新／讀取（與 employees.is_meeting_assignee_actor 身分一致時）。
-- 需 production_tasks.work_order_id → work_orders.id；若專案僅有 order_item_id 關聯，請自行調整 JOIN。

DO $body$
BEGIN
  IF to_regclass('public.production_tasks') IS NULL OR to_regclass('public.work_orders') IS NULL THEN
    RAISE NOTICE 'Skipping: production_tasks or work_orders not found';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION employees.is_production_task_actor(p_task_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $f$
      SELECT EXISTS (
        SELECT 1 FROM public.production_tasks pt
        WHERE pt.id = p_task_id
          AND pt.employee_id IS NOT NULL
          AND employees.is_meeting_assignee_actor(pt.employee_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.production_tasks pt
        INNER JOIN public.work_orders wo ON wo.id = pt.work_order_id
        INNER JOIN public.employees e ON lower(trim(e.name)) = lower(trim(wo.assignee))
        WHERE pt.id = p_task_id
          AND wo.assignee IS NOT NULL AND trim(wo.assignee) <> ''
          AND employees.is_meeting_assignee_actor(e.id)
      );
    $f$;
  $fn$;

  REVOKE ALL ON FUNCTION employees.is_production_task_actor(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION employees.is_production_task_actor(uuid) TO authenticated;

  EXECUTE 'DROP POLICY IF EXISTS "production_tasks_employee_update_own_status" ON public.production_tasks';

  EXECUTE $pol$
    CREATE POLICY "production_tasks_employee_update_own_status"
      ON public.production_tasks FOR UPDATE TO authenticated
      USING (employees.is_production_task_actor(id))
      WITH CHECK (employees.is_production_task_actor(id));
  $pol$;
END;
$body$;

COMMENT ON FUNCTION employees.is_production_task_actor(uuid) IS
  '員工儀表板生產交辦：承辦人（employee_id）或工單負責人姓名與本人一致';
