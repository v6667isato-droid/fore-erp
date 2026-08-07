-- 加班申報 Telegram 推播＋bot 按鈕審核（邏輯與假單推播一致）：
-- 1) 新的 pending 加班申報 → pg_net 打 fore-telegram-bot /api/overtime/notify（同一把 Vault 密鑰 leave_notify_secret）
-- 2) approve/reject RPC 放行 service_role：bot callback 端以 service role 呼叫（webhook 已先驗過
--    按按鈕者為 telegram_bot_users 的 admin），approved_by 此時為 null。

create or replace function public.notify_telegram_overtime_request()
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
    raise warning 'notify_telegram_overtime_request: vault secret leave_notify_secret missing';
    return new;
  end if;

  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/overtime/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- 推播失敗不可擋下加班申報建立
  raise warning 'notify_telegram_overtime_request failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists overtime_requests_notify_telegram on public.overtime_requests;
create trigger overtime_requests_notify_telegram
after insert on public.overtime_requests
for each row
when (new.status = 'pending')
execute function public.notify_telegram_overtime_request();

-- 核准：管理員或 service_role（telegram bot）；其餘同 20260807000000
CREATE OR REPLACE FUNCTION public.approve_overtime_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.overtime_requests%ROWTYPE;
  v_record_id uuid;
  v_reason text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE
        up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
    )
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_req FROM public.overtime_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE
      e.id = v_req.employee_id
      AND e.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.overtime_records o
    WHERE
      o.employee_id = v_req.employee_id
      AND o.overtime_date = v_req.overtime_date
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_exists');
  END IF;

  v_reason := (CASE v_req.compensation_type WHEN 'pay' THEN '【加班費】' ELSE '【補休】' END)
    || COALESCE(NULLIF(trim(COALESCE(v_req.reason, '')), ''), '員工申報加班')
    || ' ' || to_char(v_req.start_time, 'HH24:MI') || '–' || to_char(v_req.end_time, 'HH24:MI');

  INSERT INTO public.overtime_records(employee_id, overtime_date, hours, reason, created_by)
  VALUES (v_req.employee_id, v_req.overtime_date, v_req.hours, v_reason, auth.uid())
  RETURNING id INTO v_record_id;

  IF v_req.compensation_type = 'comp_leave' THEN
    UPDATE public.employees
    SET comp_leave_remaining = COALESCE(comp_leave_remaining, 0) + v_req.hours
    WHERE id = v_req.employee_id;

    UPDATE public.daily_attendance
    SET
      status_tags = CASE
        WHEN '🔒 已轉補休' = ANY (COALESCE(status_tags, '{}')) THEN status_tags
        ELSE COALESCE(status_tags, '{}') || ARRAY['🔒 已轉補休']::text[]
      END,
      updated_at = now()
    WHERE
      employee_id = v_req.employee_id
      AND attendance_date = v_req.overtime_date;
  END IF;

  UPDATE public.overtime_requests
  SET
    status = 'approved',
    record_id = v_record_id,
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

-- 退回：管理員或 service_role（telegram bot）
CREATE OR REPLACE FUNCTION public.reject_overtime_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE
        up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
    )
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT status INTO v_status FROM public.overtime_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  UPDATE public.overtime_requests
  SET
    status = 'rejected',
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;
