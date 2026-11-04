-- Telegram 推播：調薪通知員工本人（💰 你的薪資已調整）
-- 須在 fore-telegram-bot 部署 /api/salary/notify 之後才套用（trigger 打到 404 不會重送）。

CREATE OR REPLACE FUNCTION public.notify_telegram_salary_adjustment () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = '' AS $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'leave_notify_secret'
  limit 1;

  if secret is null then
    raise warning 'notify_telegram_salary_adjustment: vault secret leave_notify_secret missing';
    return null;
  end if;

  -- 只送 id，bot 端重新讀取調薪紀錄（不在 pg_net 佇列留下金額）
  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/salary/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- 推播失敗不可擋下調薪
  raise warning 'notify_telegram_salary_adjustment failed: %', sqlerrm;
  return null;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_telegram_salary_adjustment () FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS salary_adjustments_notify_telegram ON public.salary_adjustments;

CREATE TRIGGER salary_adjustments_notify_telegram
AFTER INSERT ON public.salary_adjustments FOR EACH ROW
EXECUTE FUNCTION public.notify_telegram_salary_adjustment ();
