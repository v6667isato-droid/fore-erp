-- 工單負責人改為正式關聯 public.employees(id)，取代文字欄位 assignee

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL;

-- 由既有姓名回填（同名多筆時取 id 最小者）；僅在舊欄位 assignee 仍存在時執行
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_orders' AND column_name = 'assignee'
  ) THEN
    UPDATE public.work_orders wo
    SET assignee_id = sub.eid
    FROM (
      SELECT DISTINCT ON (wo2.id)
        wo2.id AS wid,
        e.id AS eid
      FROM public.work_orders wo2
      INNER JOIN public.employees e
        ON lower(trim(e.name)) = lower(trim(wo2.assignee))
      WHERE wo2.assignee IS NOT NULL AND trim(wo2.assignee) <> ''
      ORDER BY wo2.id, e.id
    ) AS sub
    WHERE wo.id = sub.wid;
  END IF;
END;
$mig$;

DROP INDEX IF EXISTS work_orders_assignee_id_idx;
CREATE INDEX work_orders_assignee_id_idx ON public.work_orders (assignee_id);

COMMENT ON COLUMN public.work_orders.assignee_id IS '工單負責人，對應 public.employees.id';

ALTER TABLE public.work_orders DROP COLUMN IF EXISTS assignee;

-- 生產交辦 RLS：以 work_orders.assignee_id 比對；若 production_tasks 有 employee_id 則併入判斷
DO $body$
BEGIN
  IF to_regclass('public.production_tasks') IS NULL OR to_regclass('public.work_orders') IS NULL THEN
    RAISE NOTICE 'Skipping is_production_task_actor: production_tasks or work_orders missing';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_tasks' AND column_name = 'employee_id'
  ) THEN
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
          INNER JOIN public.employees e ON e.id = wo.assignee_id
          WHERE pt.id = p_task_id
            AND wo.assignee_id IS NOT NULL
            AND employees.is_meeting_assignee_actor(e.id)
        );
      $f$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION employees.is_production_task_actor(p_task_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $f$
        SELECT EXISTS (
          SELECT 1
          FROM public.production_tasks pt
          INNER JOIN public.work_orders wo ON wo.id = pt.work_order_id
          INNER JOIN public.employees e ON e.id = wo.assignee_id
          WHERE pt.id = p_task_id
            AND wo.assignee_id IS NOT NULL
            AND employees.is_meeting_assignee_actor(e.id)
        );
      $f$;
    $fn$;
  END IF;

  COMMENT ON FUNCTION employees.is_production_task_actor(uuid) IS
    '員工儀表板生產交辦：工單負責人 assignee_id；若 production_tasks.employee_id 存在則一併比對承辦人';

  REVOKE ALL ON FUNCTION employees.is_production_task_actor(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION employees.is_production_task_actor(uuid) TO authenticated;
END;
$body$;
