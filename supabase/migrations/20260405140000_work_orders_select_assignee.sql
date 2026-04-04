-- 員工儀表板需先讀取「自己為負責人」的 work_orders；若 RLS 未允許會導致生產交辦為空。

DO $body$
BEGIN
  IF to_regclass('public.work_orders') IS NULL THEN
    RAISE NOTICE 'Skipping: public.work_orders not found';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_orders' AND column_name = 'assignee_id'
  ) THEN
    RAISE NOTICE 'Skipping: work_orders.assignee_id missing';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "work_orders_select_own_assignee" ON public.work_orders';

  EXECUTE $pol$
    CREATE POLICY "work_orders_select_own_assignee"
      ON public.work_orders FOR SELECT TO authenticated
      USING (
        assignee_id IS NOT NULL
        AND employees.is_meeting_assignee_actor(assignee_id)
      );
  $pol$;
END;
$body$;
