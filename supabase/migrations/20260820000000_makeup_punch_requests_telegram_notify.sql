-- 補打卡申請 Telegram 推播＋bot 按鈕審核（邏輯與假單／加班推播一致）：
-- 1) 新的 pending 補打卡申請 → pg_net 打 fore-telegram-bot /api/makeup/notify（同一把 Vault 密鑰 leave_notify_secret）
-- 2) approve/reject RPC 放行 service_role：bot callback 端以 service role 呼叫（webhook 已先驗過
--    按按鈕者為 telegram_bot_users 的 admin），approved_by 此時為 null。

create or replace function public.notify_telegram_makeup_punch_request()
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
    raise warning 'notify_telegram_makeup_punch_request: vault secret leave_notify_secret missing';
    return new;
  end if;

  perform net.http_post(
    url := 'https://fore-telegram-bot.vercel.app/api/makeup/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- 推播失敗不可擋下補打卡申請建立
  raise warning 'notify_telegram_makeup_punch_request failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists makeup_punch_requests_notify_telegram on public.makeup_punch_requests;
create trigger makeup_punch_requests_notify_telegram
after insert on public.makeup_punch_requests
for each row
when (new.status = 'pending')
execute function public.notify_telegram_makeup_punch_request();

-- 核准：管理員或 service_role（telegram bot）；其餘同 20260819000000
CREATE OR REPLACE FUNCTION public.approve_makeup_punch_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.makeup_punch_requests%ROWTYPE;
  v_da public.daily_attendance%ROWTYPE;
  v_filled boolean := false;
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

  SELECT * INTO v_req FROM public.makeup_punch_requests WHERE id = p_request_id FOR UPDATE;

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

  -- 該月薪資已發放：出勤依據已凍結，不可再補卡（改以人工調整）
  IF EXISTS (
    SELECT 1
    FROM public.payslips p
    WHERE
      p.employee_id = v_req.employee_id
      AND p.period_key = to_char(v_req.punch_date, 'YYYY-MM')
      AND lower(trim(COALESCE(p.status, ''))) IN ('paid', '已發放', '發放')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'month_settled');
  END IF;

  SELECT * INTO v_da
  FROM public.daily_attendance
  WHERE employee_id = v_req.employee_id AND attendance_date = v_req.punch_date
  FOR UPDATE;

  IF FOUND THEN
    -- 只補缺的那側；CSV 已有的實卡不覆蓋
    IF v_req.clock_in IS NOT NULL AND v_da.clock_in IS NULL THEN
      UPDATE public.daily_attendance SET clock_in = v_req.clock_in WHERE id = v_da.id;
      v_filled := true;
    END IF;
    IF v_req.clock_out IS NOT NULL AND v_da.clock_out IS NULL THEN
      UPDATE public.daily_attendance SET clock_out = v_req.clock_out WHERE id = v_da.id;
      v_filled := true;
    END IF;
    IF v_filled THEN
      PERFORM public.recompute_daily_attendance_for_makeup(v_req.employee_id, v_req.punch_date, true);
    END IF;
  ELSE
    -- CSV 尚未匯入：先建立列；月底戰情室匯入時會以核准補卡單合併重算
    INSERT INTO public.daily_attendance (employee_id, attendance_date, clock_in, clock_out, status_tags)
    VALUES (v_req.employee_id, v_req.punch_date, v_req.clock_in, v_req.clock_out, '{}');
    PERFORM public.recompute_daily_attendance_for_makeup(v_req.employee_id, v_req.punch_date, true);
  END IF;

  UPDATE public.makeup_punch_requests
  SET
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

-- 退回：管理員或 service_role（telegram bot）
CREATE OR REPLACE FUNCTION public.reject_makeup_punch_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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

  SELECT status INTO v_status FROM public.makeup_punch_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  UPDATE public.makeup_punch_requests
  SET
    status = 'rejected',
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;
