-- 回滾 20260923200000_security_advisor_hardening（還原為 2026-09-23 套用前的權限與設定）
-- ⚠️ 全部回滾會重新打開 anon 可呼叫審核 RPC、可改任意員工出勤（recompute）、可讀全部庫存的漏洞。
--    建議只回滾出問題的那一段（各段互相獨立，可單獨執行）。
-- 套用前的 ACL 皆有 postgres／service_role，本次未動，回滾不需處理；
-- employees.is_meeting_assignee_actor／is_production_task_actor 本次實際無變更，不需回滾。

-- 1) trigger 函式：原 ACL 含 PUBLIC＋anon＋authenticated
GRANT EXECUTE ON FUNCTION public.log_audit () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_work_order_stage_change () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_orders_log_stage_change () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_telegram_leave_request () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_telegram_makeup_punch_request () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_telegram_new_order () TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_telegram_overtime_request () TO PUBLIC, anon, authenticated;

-- 2) 審核／異動 RPC：原 ACL 含 anon（authenticated／service_role 本次未收回）
GRANT EXECUTE ON FUNCTION public.approve_makeup_punch_request (uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.reject_makeup_punch_request (uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.revoke_makeup_punch_request (uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_overtime_request (uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.reject_overtime_request (uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.revoke_overtime_request (uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) TO anon;
GRANT EXECUTE ON FUNCTION public.revoke_overtime_comp_leave (uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.recompute_daily_attendance_for_makeup (uuid, date, boolean) TO anon, authenticated;

-- 3) RLS helper
GRANT EXECUTE ON FUNCTION public.current_employee_id () TO anon;
GRANT EXECUTE ON FUNCTION public.is_own_employee (uuid) TO anon;

-- 4) 庫存 view：原本無 reloptions（＝以擁有者 postgres 權限執行）
ALTER VIEW public.part_variant_stock_status RESET (security_invoker);

-- 5) search_path：原本皆未設定
ALTER FUNCTION public.makeup_punch_requests_set_updated_at () RESET search_path;
ALTER FUNCTION public.overtime_requests_set_updated_at () RESET search_path;
ALTER FUNCTION public.leave_requests_set_updated_at () RESET search_path;
ALTER FUNCTION public.journal_posts_set_updated_at () RESET search_path;
ALTER FUNCTION public.telegram_bot_users_set_updated_at () RESET search_path;
ALTER FUNCTION public.prep_orders_set_updated_at () RESET search_path;
ALTER FUNCTION public.set_order_shipped_date () RESET search_path;
ALTER FUNCTION public.work_orders_auto_deduct_parts () RESET search_path;
ALTER FUNCTION employees.set_meeting_minutes_updated_at () RESET search_path;
