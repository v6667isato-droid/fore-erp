-- Supabase security advisors 修補（2026-09-23）
--
-- 調查結論：
-- - 8 支審核 RPC 由前端登入者（authenticated）呼叫；approve/reject 另由 Telegram bot（service_role）呼叫。
--   函式內已有 admin 檢查（user_profiles.role = 'admin'，非 admin 回 {ok:false, error:'forbidden'}），
--   本次不改函式內容，只收回 anon。
-- - recompute_daily_attendance_for_makeup 無外部呼叫端、函式內無權限檢查，只由補卡 approve/revoke
--   內部 PERFORM（以 definer 身分執行），收回 anon＋authenticated。
-- - helper 函式被 RLS policy 使用（is_own_employee → overtime_requests；is_meeting_assignee_actor →
--   work_orders、meeting_minute_assignee_status），policy 皆只給 authenticated，故只收回 anon。
-- - trigger 函式與部分函式的 ACL 含 PUBLIC（=X/postgres），anon 會從 PUBLIC 繼承 EXECUTE，
--   所以 REVOKE 一律連 PUBLIC 一起收；對沒有 PUBLIC 授權的函式是 no-op。
-- - trigger 函式的 EXECUTE 只在 CREATE TRIGGER 時檢查，觸發時不檢查，收回不影響寫入
--   （先例：overtime_requests_reject_overlap 於 20260916110000 收回後員工送單仍正常觸發）。
--
-- 回滾：supabase/sql/rollback_security_advisor_hardening.sql
-- 驗證：supabase/sql/verify_security_advisor_hardening.sql

-- 1) trigger 函式：不對外開放 RPC（保留 owner 與 service_role）
REVOKE EXECUTE ON FUNCTION public.log_audit () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_work_order_stage_change () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.work_orders_log_stage_change () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_leave_request () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_makeup_punch_request () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_new_order () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_overtime_request () FROM PUBLIC, anon, authenticated;

-- 2) 審核／異動 RPC：收回 anon；保留 authenticated（前端 admin）與 service_role（Telegram bot）
REVOKE EXECUTE ON FUNCTION public.approve_makeup_punch_request (uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_makeup_punch_request (uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_makeup_punch_request (uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_overtime_request (uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_overtime_request (uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_overtime_request (uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_overtime_comp_leave (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_makeup_punch_request (uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_makeup_punch_request (uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_makeup_punch_request (uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_overtime_request (uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_overtime_request (uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_overtime_request (uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_overtime_comp_leave (uuid) TO authenticated, service_role;

-- 補卡重算：無權限檢查，僅供補卡 RPC 內部呼叫
REVOKE EXECUTE ON FUNCTION public.recompute_daily_attendance_for_makeup (uuid, date, boolean) FROM PUBLIC, anon, authenticated;

-- 3) RLS helper：只收回 anon，authenticated 必須保留（policy 以查詢者身分呼叫）
--    employees.* 兩支原本就沒有 anon 權限，重下無副作用
REVOKE EXECUTE ON FUNCTION public.current_employee_id () FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_own_employee (uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION employees.is_meeting_assignee_actor (uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION employees.is_production_task_actor (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_employee_id () TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_own_employee (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION employees.is_meeting_assignee_actor (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION employees.is_production_task_actor (uuid) TO authenticated;

-- 4) 庫存 view 改以查詢者權限執行：底層 part_variants／parts／materials／stock_movements
--    皆有 authenticated 全開 policy，登入者結果不變；anon 從此查不到（原本可經此 view 讀全部庫存）
ALTER VIEW public.part_variant_stock_status SET (security_invoker = true);

-- 5) 固定 search_path = ''：9 支皆為非 SECURITY DEFINER 的 trigger 函式，內容只用
--    NEW/OLD/TG_OP、now()、CURRENT_DATE（pg_catalog 恆在搜尋路徑內）；work_orders_auto_deduct_parts
--    的資料表已全部寫 public.，其 INSERT 連帶觸發的 stock_movements trigger 只有 log_audit
--    （自帶 search_path=public）。函式內容不需修改。
ALTER FUNCTION public.makeup_punch_requests_set_updated_at () SET search_path = '';
ALTER FUNCTION public.overtime_requests_set_updated_at () SET search_path = '';
ALTER FUNCTION public.leave_requests_set_updated_at () SET search_path = '';
ALTER FUNCTION public.journal_posts_set_updated_at () SET search_path = '';
ALTER FUNCTION public.telegram_bot_users_set_updated_at () SET search_path = '';
ALTER FUNCTION public.prep_orders_set_updated_at () SET search_path = '';
ALTER FUNCTION public.set_order_shipped_date () SET search_path = '';
ALTER FUNCTION public.work_orders_auto_deduct_parts () SET search_path = '';
ALTER FUNCTION employees.set_meeting_minutes_updated_at () SET search_path = '';
