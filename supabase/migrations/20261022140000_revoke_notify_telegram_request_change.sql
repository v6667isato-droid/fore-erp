-- Supabase security advisor：notify_telegram_request_change（SECURITY DEFINER）可被 anon／authenticated
-- 經 /rest/v1/rpc 呼叫。它是 trigger 函式（leave_requests／overtime_requests 審核結果通知），
-- 比照 20260923200000_security_advisor_hardening：trigger 函式的 EXECUTE 只在 CREATE TRIGGER 時檢查，
-- 觸發時不檢查，收回不影響請假／加班審核通知。
REVOKE EXECUTE ON FUNCTION public.notify_telegram_request_change () FROM PUBLIC, anon, authenticated;
