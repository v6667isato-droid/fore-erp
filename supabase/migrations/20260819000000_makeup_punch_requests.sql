-- 員工補打卡申請：makeup_punch_requests（員工送出 pending → 管理員審核）
-- 打卡鐘 CSV 為出勤主要依據；核准的補卡單於「出勤戰情分析室」匯入時自動併入缺卡側。
-- 若該月 CSV 已匯入（daily_attendance 已有列），核准 RPC 會即時補上並重算時數與標籤。
-- 已發放（paid）月份不可核准／撤銷，避免動到已結算薪資的出勤依據。

CREATE TABLE IF NOT EXISTS public.makeup_punch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  punch_date date NOT NULL,
  clock_in time,
  clock_out time,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 至少要補一側（忘打上班卡／下班卡擇一或兩者皆補）
  CONSTRAINT makeup_punch_requests_side_chk CHECK (clock_in IS NOT NULL OR clock_out IS NOT NULL),
  CONSTRAINT makeup_punch_requests_order_chk CHECK (
    clock_in IS NULL OR clock_out IS NULL OR clock_out > clock_in
  ),
  CONSTRAINT makeup_punch_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'))
);

COMMENT ON TABLE public.makeup_punch_requests IS '員工補打卡申請單；核准後於出勤戰情室匯入時併入，或（已匯入時）即時寫回 daily_attendance';

COMMENT ON COLUMN public.makeup_punch_requests.clock_in IS '補上班卡時間；NULL 表示不補這側';

COMMENT ON COLUMN public.makeup_punch_requests.clock_out IS '補下班卡時間；NULL 表示不補這側';

CREATE INDEX IF NOT EXISTS makeup_punch_requests_employee_created_idx ON public.makeup_punch_requests (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS makeup_punch_requests_status_idx ON public.makeup_punch_requests (status);

CREATE INDEX IF NOT EXISTS makeup_punch_requests_date_idx ON public.makeup_punch_requests (punch_date);

CREATE OR REPLACE FUNCTION public.makeup_punch_requests_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS makeup_punch_requests_set_updated_at ON public.makeup_punch_requests;
CREATE TRIGGER makeup_punch_requests_set_updated_at
  BEFORE UPDATE ON public.makeup_punch_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.makeup_punch_requests_set_updated_at();

-- 操作稽核：沿用 log_audit()（20260806100000_audit_logs.sql）
DROP TRIGGER IF EXISTS audit_makeup_punch_requests ON public.makeup_punch_requests;
CREATE TRIGGER audit_makeup_punch_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.makeup_punch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit();

ALTER TABLE public.makeup_punch_requests ENABLE ROW LEVEL SECURITY;

-- 員工：讀自己的、以 pending 新增自己的；狀態流轉一律走下方 SECURITY DEFINER RPC，不開放 UPDATE/DELETE
DROP POLICY IF EXISTS "makeup_punch_requests_select_own" ON public.makeup_punch_requests;
CREATE POLICY "makeup_punch_requests_select_own" ON public.makeup_punch_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id = makeup_punch_requests.employee_id
  )
);

DROP POLICY IF EXISTS "makeup_punch_requests_insert_own" ON public.makeup_punch_requests;
CREATE POLICY "makeup_punch_requests_insert_own" ON public.makeup_punch_requests FOR INSERT TO authenticated WITH CHECK (
  status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id = makeup_punch_requests.employee_id
  )
);

DROP POLICY IF EXISTS "makeup_punch_requests_select_admin_manager" ON public.makeup_punch_requests;
CREATE POLICY "makeup_punch_requests_select_admin_manager" ON public.makeup_punch_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) IN ('admin', 'manager')
  )
);

GRANT SELECT, INSERT ON public.makeup_punch_requests TO authenticated;

-- 依當前打卡重算 daily_attendance 之工時與可重算標籤（保留請假／假日／已轉補休等非重算類標籤）。
-- 與前端戰情室邏輯對齊：午休 12:00–13:00 扣除、>09:15 遲到、<17:45 早退、<7h45m 工時不足、≤7h／>9h 時數提示。
CREATE OR REPLACE FUNCTION public.recompute_daily_attendance_for_makeup (
  p_employee_id uuid,
  p_date date,
  p_mark_makeup boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_row public.daily_attendance%ROWTYPE;
  v_tags text[];
  v_in_min int;
  v_out_min int;
  v_lunch int;
  v_work_min int;
  v_hours numeric;
  v_discipline boolean;
  v_exempt boolean;
  v_is_abnormal boolean;
BEGIN
  SELECT * INTO v_row
  FROM public.daily_attendance
  WHERE employee_id = p_employee_id AND attendance_date = p_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 移除可重算的標籤（缺卡／未出勤／遲到／早退／工時提示／已補卡），其餘（請假、國定假日、已轉補休…）保留
  SELECT COALESCE(array_agg(t), '{}') INTO v_tags
  FROM unnest(COALESCE(v_row.status_tags, '{}')) AS t
  WHERE t NOT IN (
    '⚠️ 缺卡', '⚠️ 缺上班卡', '⚠️ 缺下班卡', '🚫 未出勤（無打卡紀錄）',
    '⏰ 遲到', '🏃 早退', '📉 工時不足',
    '📉 時數不足：可能有請小時計算的假', '時間超時', '⏱️ 時數異常',
    '💰 假日出勤', '📝 已補卡'
  );

  -- 請假／放假日豁免遲到、早退、缺卡等判定（與戰情室一致）
  v_exempt := EXISTS (
    SELECT 1 FROM unnest(v_tags) AS t
    WHERE t LIKE '🌴%' OR t LIKE '🎉%' OR t LIKE '🌪️%' OR t LIKE '💰 國定%' OR t LIKE '💰 特殊%'
  );

  -- 平日或補班日才套用出勤紀律；國定放假日不套用
  v_discipline := NOT EXISTS (
    SELECT 1 FROM public.public_holidays h
    WHERE h.holiday_date = p_date AND h.is_workday = false
  ) AND (
    extract(isodow FROM p_date) BETWEEN 1 AND 5
    OR EXISTS (
      SELECT 1 FROM public.public_holidays h
      WHERE h.holiday_date = p_date AND h.is_workday = true
    )
  );

  v_in_min := CASE WHEN v_row.clock_in IS NULL THEN NULL
    ELSE extract(hour FROM v_row.clock_in)::int * 60 + extract(minute FROM v_row.clock_in)::int END;
  v_out_min := CASE WHEN v_row.clock_out IS NULL THEN NULL
    ELSE extract(hour FROM v_row.clock_out)::int * 60 + extract(minute FROM v_row.clock_out)::int END;

  v_hours := NULL;
  IF v_in_min IS NOT NULL AND v_out_min IS NOT NULL THEN
    IF v_out_min > v_in_min THEN
      IF v_out_min <= 720 OR v_in_min >= 780 THEN
        v_lunch := 0;
      ELSE
        v_lunch := least(60, least(v_out_min, 780) - greatest(v_in_min, 720));
      END IF;
      v_work_min := v_out_min - v_in_min - v_lunch;
      v_hours := round(v_work_min::numeric / 60, 1);
    ELSIF NOT v_exempt THEN
      v_tags := v_tags || ARRAY['⏱️ 時數異常'];
    END IF;
  END IF;

  IF NOT v_exempt THEN
    IF v_in_min IS NULL AND v_out_min IS NULL THEN
      IF v_discipline THEN
        v_tags := v_tags || ARRAY['🚫 未出勤（無打卡紀錄）'];
      END IF;
    ELSIF v_in_min IS NULL OR v_out_min IS NULL THEN
      IF v_discipline THEN
        v_tags := v_tags || ARRAY[CASE WHEN v_in_min IS NULL THEN '⚠️ 缺上班卡' ELSE '⚠️ 缺下班卡' END];
      END IF;
      IF NOT v_discipline THEN
        v_tags := v_tags || ARRAY['💰 假日出勤'];
      END IF;
    ELSE
      IF NOT v_discipline THEN
        v_tags := v_tags || ARRAY['💰 假日出勤'];
      END IF;
      IF v_discipline AND v_out_min > v_in_min THEN
        IF v_in_min > 555 THEN
          v_tags := v_tags || ARRAY['⏰ 遲到'];
        END IF;
        IF v_out_min < 1065 THEN
          v_tags := v_tags || ARRAY['🏃 早退'];
        END IF;
        IF v_work_min < 465 THEN
          v_tags := v_tags || ARRAY['📉 工時不足'];
        END IF;
      END IF;
      IF v_out_min > v_in_min AND v_hours IS NOT NULL THEN
        IF v_hours <= 7 THEN
          v_tags := v_tags || ARRAY['📉 時數不足：可能有請小時計算的假'];
        ELSIF v_hours > 9 THEN
          v_tags := v_tags || ARRAY['時間超時'];
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_mark_makeup THEN
    v_tags := v_tags || ARRAY['📝 已補卡'];
  END IF;

  v_is_abnormal := EXISTS (
    SELECT 1 FROM unnest(v_tags) AS t
    WHERE t IN (
      '⚠️ 缺卡', '⚠️ 缺上班卡', '⚠️ 缺下班卡', '🚫 未出勤（無打卡紀錄）',
      '⏰ 遲到', '🏃 早退', '📉 工時不足',
      '📉 時數不足：可能有請小時計算的假', '時間超時'
    )
  );

  UPDATE public.daily_attendance
  SET
    total_hours = v_hours,
    status_tags = v_tags,
    is_abnormal = v_is_abnormal,
    updated_at = now()
  WHERE id = v_row.id;
END;

$$;

REVOKE ALL ON FUNCTION public.recompute_daily_attendance_for_makeup (uuid, date, boolean) FROM PUBLIC;

-- 僅供 approve／revoke RPC 內部呼叫，不開放前端直呼
COMMENT ON FUNCTION public.recompute_daily_attendance_for_makeup (uuid, date, boolean) IS '補打卡核准／撤銷後重算 daily_attendance 工時與標籤（保留請假／假日等非重算類標籤）';

-- 核准：該月已發薪則拒絕；daily_attendance 已有列則補缺卡側並重算，無列則建立（等月底戰情室匯入亦會自動併入）
CREATE OR REPLACE FUNCTION public.approve_makeup_punch_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.makeup_punch_requests%ROWTYPE;
  v_da public.daily_attendance%ROWTYPE;
  v_filled boolean := false;
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

REVOKE ALL ON FUNCTION public.approve_makeup_punch_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_makeup_punch_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_makeup_punch_request (uuid) IS '管理員：核准補打卡；已發薪月份拒絕；即時補入 daily_attendance 缺卡側並重算標籤';

-- 退回：僅 pending 可退
CREATE OR REPLACE FUNCTION public.reject_makeup_punch_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_status text;
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

REVOKE ALL ON FUNCTION public.reject_makeup_punch_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_makeup_punch_request (uuid) TO authenticated;

-- 撤銷已核准：僅清掉「與補卡單相同值」的那側（CSV 後來匯入的實卡不動），重算標籤；已發薪月份拒絕
CREATE OR REPLACE FUNCTION public.revoke_makeup_punch_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'attendance_touched', v_touched);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_makeup_punch_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_makeup_punch_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.revoke_makeup_punch_request (uuid) IS '管理員：撤銷已核准補打卡；清回相同值的補卡側並重算標籤；已發薪月份拒絕';
