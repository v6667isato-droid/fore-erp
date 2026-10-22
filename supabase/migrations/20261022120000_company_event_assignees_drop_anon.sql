-- 行事曆交辦（company_event_assignees）移除 anon 權限。
-- 20260512160000 建表時員工入口還是 anon，開了 anon 讀全部＋改全部（USING true）；
-- 員工入口現在必須以 Supabase Auth 登入（未登入導回 /login），走 authenticated policy，
-- 伺服器端（Google 行事曆同步、Telegram bot）走 service role，不再需要 anon。
-- 移除後拿到前端公開金鑰的人無法再讀取或竄改任何交辦的完成狀態。

DROP POLICY IF EXISTS cea_select_anon_own ON public.company_event_assignees;
DROP POLICY IF EXISTS cea_update_anon ON public.company_event_assignees;
