-- Telegram 打卡整合（ERP 端）：
-- 1) verify_leave_notify_secret(p_secret)：僅 service_role 可執行，供 /api/telegram/* route
--    驗證 fore-telegram-bot 帶來的 Vault 共用密鑰（leave_notify_secret，與請假／補卡推播同一把）
-- 2) app_settings.telegram_checkin_scope：Telegram 打卡與提醒開放範圍（off／admin／all），
--    預設 admin（測試期僅 bot 管理員）

create or replace function public.verify_leave_notify_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    return false;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'leave_notify_secret'
  limit 1;

  return secret is not null
    and p_secret is not null
    and p_secret <> ''
    and secret = p_secret;
end;
$$;

revoke all on function public.verify_leave_notify_secret(text) from public;
revoke all on function public.verify_leave_notify_secret(text) from anon;
revoke all on function public.verify_leave_notify_secret(text) from authenticated;
grant execute on function public.verify_leave_notify_secret(text) to service_role;

insert into public.app_settings (key, value)
values ('telegram_checkin_scope', '"admin"'::jsonb)
on conflict (key) do nothing;
