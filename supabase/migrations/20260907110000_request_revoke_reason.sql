-- 撤銷原因：主控端撤銷請假／加班／補打卡時可填寫原因，並顯示於員工儀表板
-- 1) leave_requests / overtime_requests / makeup_punch_requests 各加 revoke_reason 欄位
-- 2) revoke_overtime_request / revoke_makeup_punch_request 改簽章加 p_reason（DEFAULT NULL，舊呼叫相容）
--    （請假撤銷為前端直接 UPDATE，不經 RPC）
ALTER TABLE public.leave_requests
ADD COLUMN IF NOT EXISTS revoke_reason text;

ALTER TABLE public.overtime_requests
ADD COLUMN IF NOT EXISTS revoke_reason text;

ALTER TABLE public.makeup_punch_requests
ADD COLUMN IF NOT EXISTS revoke_reason text;

COMMENT ON COLUMN public.leave_requests.revoke_reason IS '管理端撤銷原因（顯示於員工儀表板）';

COMMENT ON COLUMN public.overtime_requests.revoke_reason IS '管理端撤銷原因（顯示於員工儀表板）';

COMMENT ON COLUMN public.makeup_punch_requests.revoke_reason IS '管理端撤銷原因（顯示於員工儀表板）';

-- 換簽章需先移除舊函式，避免 (uuid) 與 (uuid, text DEFAULT NULL) 雙載造成呼叫模稜兩可
DROP FUNCTION IF EXISTS public.revoke_overtime_request (uuid);

-- 撤銷已核准：刪 overtime_records；補休則扣回餘額並移除出勤標籤（同 20260807000000，僅多寫入 revoke_reason）
CREATE OR REPLACE FUNCTION public.revoke_overtime_request (p_request_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.overtime_requests%ROWTYPE;
  v_rec_hours numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_req FROM public.overtime_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_req.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF v_req.record_id IS NOT NULL THEN
    SELECT o.hours INTO v_rec_hours FROM public.overtime_records o WHERE o.id = v_req.record_id;

    -- 對應紀錄可能已被手動補登卡刪除；找不到時僅改狀態
    IF FOUND THEN
      DELETE FROM public.overtime_records WHERE id = v_req.record_id;

      IF v_req.compensation_type = 'comp_leave' THEN
        UPDATE public.employees
        SET comp_leave_remaining = COALESCE(comp_leave_remaining, 0) - COALESCE(v_rec_hours, 0)
        WHERE id = v_req.employee_id;

        UPDATE public.daily_attendance
        SET
          status_tags = array_remove(COALESCE(status_tags, '{}'), '🔒 已轉補休'),
          updated_at = now()
        WHERE
          employee_id = v_req.employee_id
          AND attendance_date = v_req.overtime_date;
      END IF;
    END IF;
  END IF;

  UPDATE public.overtime_requests
  SET
    status = 'revoked',
    revoke_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_overtime_request (uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_overtime_request (uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.revoke_makeup_punch_request (uuid);

-- 撤銷已核准補打卡：僅清掉相同值的補卡側、重算標籤；已發薪月份拒絕（同 20260819000000，僅多寫入 revoke_reason）
CREATE OR REPLACE FUNCTION public.revoke_makeup_punch_request (p_request_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.makeup_punch_requests%ROWTYPE;
  v_da public.daily_attendance%ROWTYPE;
  v_touched boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_req FROM public.makeup_punch_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_req.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

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
    IF v_req.clock_in IS NOT NULL AND v_da.clock_in = v_req.clock_in THEN
      UPDATE public.daily_attendance SET clock_in = NULL WHERE id = v_da.id;
      v_touched := true;
    END IF;
    IF v_req.clock_out IS NOT NULL AND v_da.clock_out = v_req.clock_out THEN
      UPDATE public.daily_attendance SET clock_out = NULL WHERE id = v_da.id;
      v_touched := true;
    END IF;
    -- 標籤一律重算並移除「📝 已補卡」；若清空後兩側皆無卡且無其他標籤，仍保留該列供戰情室重匯覆蓋
    PERFORM public.recompute_daily_attendance_for_makeup(v_req.employee_id, v_req.punch_date, false);
  END IF;

  UPDATE public.makeup_punch_requests
  SET
    status = 'revoked',
    revoke_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'attendance_touched', v_touched);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_makeup_punch_request (uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_makeup_punch_request (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.revoke_makeup_punch_request (uuid, text) IS '管理員：撤銷已核准補打卡；清回相同值的補卡側並重算標籤；已發薪月份拒絕；可附撤銷原因';
