-- 驗證 20260923200000_security_advisor_hardening 是否生效（唯讀，可隨時執行）
-- 套用後每一列 ok 都應為 true；套用前變更過的列會是 false。
-- NULL 期望值表示該欄不在本次 migration 範圍，不比對。
WITH expected (obj, anon_exec, auth_exec, svc_exec, search_path_empty) AS (
  VALUES
    -- 1) trigger 函式
    ('public.log_audit()'::regprocedure, false, false, true, NULL::boolean),
    ('public.log_work_order_stage_change()'::regprocedure, false, false, true, NULL),
    ('public.work_orders_log_stage_change()'::regprocedure, false, false, true, NULL),
    ('public.notify_telegram_leave_request()'::regprocedure, false, false, true, NULL),
    ('public.notify_telegram_makeup_punch_request()'::regprocedure, false, false, true, NULL),
    ('public.notify_telegram_new_order()'::regprocedure, false, false, true, NULL),
    ('public.notify_telegram_overtime_request()'::regprocedure, false, false, true, NULL),
    -- 2) 審核／異動 RPC
    ('public.approve_makeup_punch_request(uuid)'::regprocedure, false, true, true, NULL),
    ('public.reject_makeup_punch_request(uuid,text)'::regprocedure, false, true, true, NULL),
    ('public.revoke_makeup_punch_request(uuid,text)'::regprocedure, false, true, true, NULL),
    ('public.approve_overtime_request(uuid)'::regprocedure, false, true, true, NULL),
    ('public.reject_overtime_request(uuid,text)'::regprocedure, false, true, true, NULL),
    ('public.revoke_overtime_request(uuid,text)'::regprocedure, false, true, true, NULL),
    ('public.approve_overtime_to_comp_leave(uuid,numeric,date,text)'::regprocedure, false, true, true, NULL),
    ('public.revoke_overtime_comp_leave(uuid)'::regprocedure, false, true, true, NULL),
    ('public.recompute_daily_attendance_for_makeup(uuid,date,boolean)'::regprocedure, false, false, true, NULL),
    -- 3) RLS helper
    ('public.current_employee_id()'::regprocedure, false, true, NULL, NULL),
    ('public.is_own_employee(uuid)'::regprocedure, false, true, NULL, NULL),
    ('employees.is_meeting_assignee_actor(uuid)'::regprocedure, false, true, NULL, NULL),
    ('employees.is_production_task_actor(uuid)'::regprocedure, false, true, NULL, NULL),
    -- 5) search_path
    ('public.makeup_punch_requests_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.overtime_requests_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.leave_requests_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.journal_posts_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.telegram_bot_users_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.prep_orders_set_updated_at()'::regprocedure, NULL, NULL, NULL, true),
    ('public.set_order_shipped_date()'::regprocedure, NULL, NULL, NULL, true),
    ('public.work_orders_auto_deduct_parts()'::regprocedure, NULL, NULL, NULL, true),
    ('employees.set_meeting_minutes_updated_at()'::regprocedure, NULL, NULL, NULL, true)
),
actual AS (
  SELECT
    e.*,
    has_function_privilege('anon', e.obj, 'EXECUTE') AS anon_now,
    has_function_privilege('authenticated', e.obj, 'EXECUTE') AS auth_now,
    has_function_privilege('service_role', e.obj, 'EXECUTE') AS svc_now,
    COALESCE(p.proconfig @> ARRAY['search_path=""'], false) AS search_path_empty_now,
    p.proconfig
  FROM expected e
  JOIN pg_proc p ON p.oid = e.obj
)
SELECT
  obj::text AS object,
  anon_now AS anon_exec,
  auth_now AS auth_exec,
  svc_now AS svc_exec,
  proconfig::text AS config,
  (anon_exec IS NULL OR anon_now = anon_exec)
  AND (auth_exec IS NULL OR auth_now = auth_exec)
  AND (svc_exec IS NULL OR svc_now = svc_exec)
  AND (search_path_empty IS NULL OR search_path_empty_now = search_path_empty) AS ok
FROM actual
UNION ALL
-- 4) view
SELECT
  'public.part_variant_stock_status (view)',
  NULL,
  NULL,
  NULL,
  c.reloptions::text,
  COALESCE(c.reloptions @> ARRAY['security_invoker=true'], false)
FROM pg_class c
WHERE c.oid = 'public.part_variant_stock_status'::regclass
ORDER BY ok, object;
