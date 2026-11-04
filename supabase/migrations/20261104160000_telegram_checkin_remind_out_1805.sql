-- Telegram 下班打卡提醒由台北 18:30 改為 18:05(= UTC 10:05)。
-- job 名稱含時間,故移除舊 job、以相同內容建立新名稱的 job(原定義見 20260909140000)。
-- 文案在 fore-telegram-bot 的 /api/checkin/remind(依月份每兩個月換一則)。

-- 舊 job 不存在時不做事,migration 重跑安全
select cron.unschedule(jobid) from cron.job where jobname = 'telegram-checkin-remind-out-1830';

-- pg_cron >= 1.4:同名 job 再次 schedule 會直接更新
select cron.schedule(
  'telegram-checkin-remind-out-1805',
  '5 10 * * *',
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
