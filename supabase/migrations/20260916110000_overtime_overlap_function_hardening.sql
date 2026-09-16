-- 承 20260916100000：收斂新增函式的權限面（Supabase database linter）
-- 1) is_comp_leave_overtime_record 固定 search_path（function_search_path_mutable）
-- 2) 重疊檢查的 trigger 函式不對外開放 RPC；trigger 權限在建立時即檢查，
--    收回 EXECUTE 不影響觸發（已於本機 PG16 驗證）
ALTER FUNCTION public.is_comp_leave_overtime_record (text)
SET
  search_path = '';

REVOKE EXECUTE ON FUNCTION public.overtime_requests_reject_overlap () FROM anon, authenticated;
