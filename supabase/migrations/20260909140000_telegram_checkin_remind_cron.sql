-- Telegram 打卡提醒排程:pg_cron + pg_net 定時打 fore-telegram-bot 的 /api/checkin/remind,
-- bot 端再查 /api/telegram/checkin-remind-targets 決定對象並逐一推播(附分享位置打卡按鈕)。
-- 驗證同一把 Vault 密鑰 leave_notify_secret;假日/週末/已打卡/請假的排除邏輯都在
-- targets API,因此排程每天照跑,非工作日 bot 會拿到空名單而不推播。
-- 台北 08:50 提醒、09:10 檢查(kind=in)、18:30 下班提醒(kind=out)
-- = UTC 00:50 / 01:10 / 10:30。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- pg_cron >= 1.4:同名 job 再次 schedule 會直接更新,migration 重跑安全
select cron.schedule(
  'telegram-checkin-remind-in-0850',
  '50 0 * * *',
  $$
  select net.http_get(
    url := 'https://fore-telegram-bot.vercel.app/api/checkin/remind?kind=in',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'leave_notify_secret' limit 1)
    ),
    timeout_milliseconds := 10000
  );
  $$
);

select cron.schedule(
  'telegram-checkin-check-in-0910',
  '10 1 * * *',
  $$
  select net.http_get(
    url := 'https://fore-telegram-bot.vercel.app/api/checkin/remind?kind=in',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'leave_notify_secret' limit 1)
    ),
    timeout_milliseconds := 10000
  );
  $$
);

select cron.schedule(
  'telegram-checkin-remind-out-1830',
  '30 10 * * *',
  $$
  select net.http_get(
    url := 'https://fore-telegram-bot.vercel.app/api/checkin/remind?kind=out',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'leave_notify_secret' limit 1)
    ),
    timeout_milliseconds := 10000
  );
  $$
);
