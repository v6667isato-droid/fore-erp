-- Telegram 推播（只推給員工本人）：年資特休入帳、薪資發放（精簡版）
-- 須在 fore-telegram-bot 部署 /api/annual-leave/notify、/api/payroll/notify 之後才套用，
-- 否則 trigger 會打到 404 且不會重送。密鑰沿用 Vault leave_notify_secret（與請假推播相同）。

-- ── 年資特休入帳：leave_balance_ledger 新增 reason=annual_grant ──────────
CREATE OR REPLACE FUNCTION public.notify_telegram_annual_leave_grant () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
    raise warning 'notify_telegram_annual_leave_grant: vault secret leave_notify_secret missing';
    return null;
  end if;

  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/annual-leave/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- 推播失敗不可擋下特休入帳
  raise warning 'notify_telegram_annual_leave_grant failed: %', sqlerrm;
  return null;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_telegram_annual_leave_grant () FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leave_balance_ledger_notify_annual_grant ON public.leave_balance_ledger;

CREATE TRIGGER leave_balance_ledger_notify_annual_grant
AFTER INSERT ON public.leave_balance_ledger FOR EACH ROW
WHEN (new.reason = 'annual_grant')
EXECUTE FUNCTION public.notify_telegram_annual_leave_grant ();

-- ── 薪資發放：payslips 新增為已發放，或由其他狀態改為已發放 ──────────
CREATE OR REPLACE FUNCTION public.notify_telegram_payslip_paid () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
    raise warning 'notify_telegram_payslip_paid: vault secret leave_notify_secret missing';
    return null;
  end if;

  -- 只送 id，bot 端重新讀取薪資單（不在 pg_net 佇列留下金額）
  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/payroll/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- 推播失敗不可擋下薪資發放
  raise warning 'notify_telegram_payslip_paid failed: %', sqlerrm;
  return null;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_telegram_payslip_paid () FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_notify_paid_insert ON public.payslips;

CREATE TRIGGER payslips_notify_paid_insert
AFTER INSERT ON public.payslips FOR EACH ROW
WHEN (lower(trim(COALESCE(new.status, ''))) IN ('paid', '已發放', '發放'))
EXECUTE FUNCTION public.notify_telegram_payslip_paid ();

DROP TRIGGER IF EXISTS payslips_notify_paid_update ON public.payslips;

CREATE TRIGGER payslips_notify_paid_update
AFTER UPDATE OF status ON public.payslips FOR EACH ROW
WHEN (
  lower(trim(COALESCE(new.status, ''))) IN ('paid', '已發放', '發放')
  AND lower(trim(COALESCE(old.status, ''))) NOT IN ('paid', '已發放', '發放')
)
EXECUTE FUNCTION public.notify_telegram_payslip_paid ();
