-- 新的 pending 請假單 → 推播到 Telegram bot(/api/leave/notify)供老闆按鈕審核。
-- 密鑰存於 Vault(name=leave_notify_secret),對應 fore-telegram-bot 的 Vercel env LEAVE_NOTIFY_SECRET。
-- (已於 2026-07-22 透過 Supabase MCP apply_migration 套用到正式庫)
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_telegram_leave_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'leave_notify_secret'
  limit 1;

  if secret is null then
    raise warning 'notify_telegram_leave_request: vault secret leave_notify_secret missing';
    return new;
  end if;

  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/leave/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- 推播失敗不可擋下請假單建立
  raise warning 'notify_telegram_leave_request failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists leave_requests_notify_telegram on public.leave_requests;
create trigger leave_requests_notify_telegram
after insert on public.leave_requests
for each row
when (new.status = 'pending')
execute function public.notify_telegram_leave_request();
