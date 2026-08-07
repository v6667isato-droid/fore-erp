-- 員工加班申報：overtime_requests（員工送出 pending → 管理員審核）
-- 核准時寫入既有 overtime_records；折抵「補休」時同 approve_overtime_to_comp_leave 入帳三件事
-- （寫紀錄、累加 comp_leave_remaining、daily_attendance 加標籤）；折抵「加班費」僅寫紀錄供薪資結算參考。

CREATE TABLE IF NOT EXISTS public.overtime_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  overtime_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hours numeric(10, 2) NOT NULL,
  compensation_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  record_id uuid REFERENCES public.overtime_records (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_requests_hours_pos_chk CHECK (hours > 0),
  -- 以 0.5 小時為最小單位
  CONSTRAINT overtime_requests_hours_half_step_chk CHECK (mod(hours * 2, 1) = 0),
  -- 不支援跨午夜；跨夜加班請分兩筆申報
  CONSTRAINT overtime_requests_time_order_chk CHECK (end_time > start_time),
  CONSTRAINT overtime_requests_comp_type_chk CHECK (compensation_type IN ('pay', 'comp_leave')),
  CONSTRAINT overtime_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'))
);

COMMENT ON TABLE public.overtime_requests IS '員工加班申報單；核准後寫入 overtime_records（record_id 回填）';
COMMENT ON COLUMN public.overtime_requests.compensation_type IS 'pay=加班費（結算時人工計入 bonus_and_overtime）；comp_leave=補休（核准即入帳 comp_leave_remaining）';
COMMENT ON COLUMN public.overtime_requests.record_id IS '核准後對應的 overtime_records.id；撤銷時反向沖回';

CREATE INDEX IF NOT EXISTS overtime_requests_employee_created_idx ON public.overtime_requests (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS overtime_requests_status_idx ON public.overtime_requests (status);

CREATE OR REPLACE FUNCTION public.overtime_requests_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS overtime_requests_set_updated_at ON public.overtime_requests;
CREATE TRIGGER overtime_requests_set_updated_at
  BEFORE UPDATE ON public.overtime_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.overtime_requests_set_updated_at();

-- 操作稽核：沿用 log_audit()（20260806100000_audit_logs.sql）
DROP TRIGGER IF EXISTS audit_overtime_requests ON public.overtime_requests;
CREATE TRIGGER audit_overtime_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit();

ALTER TABLE public.overtime_requests ENABLE ROW LEVEL SECURITY;

-- 員工：讀自己的、以 pending 新增自己的；狀態流轉一律走下方 SECURITY DEFINER RPC，不開放 UPDATE/DELETE
DROP POLICY IF EXISTS "overtime_requests_select_own" ON public.overtime_requests;
CREATE POLICY "overtime_requests_select_own" ON public.overtime_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id = overtime_requests.employee_id
  )
);

DROP POLICY IF EXISTS "overtime_requests_insert_own" ON public.overtime_requests;
CREATE POLICY "overtime_requests_insert_own" ON public.overtime_requests FOR INSERT TO authenticated WITH CHECK (
  status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id = overtime_requests.employee_id
  )
);

DROP POLICY IF EXISTS "overtime_requests_select_admin_manager" ON public.overtime_requests;
CREATE POLICY "overtime_requests_select_admin_manager" ON public.overtime_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) IN ('admin', 'manager')
  )
);

GRANT SELECT, INSERT ON public.overtime_requests TO authenticated;

-- 核准：寫入 overtime_records（一天一筆 UNIQUE）；補休另入帳三件事；回填 record_id
CREATE OR REPLACE FUNCTION public.approve_overtime_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.overtime_requests%ROWTYPE;
  v_record_id uuid;
  v_reason text;
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

REVOKE ALL ON FUNCTION public.approve_overtime_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_overtime_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_overtime_request (uuid) IS '管理員：核准加班申報，寫入 overtime_records；補休另累加 comp_leave_remaining 與出勤標籤';

-- 退回：僅 pending 可退
CREATE OR REPLACE FUNCTION public.reject_overtime_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.reject_overtime_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_overtime_request (uuid) TO authenticated;

-- 撤銷已核准：刪 overtime_records；補休則扣回餘額並移除出勤標籤（同 revoke_overtime_comp_leave，不做下限夾制）
CREATE OR REPLACE FUNCTION public.revoke_overtime_request (p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_overtime_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_overtime_request (uuid) TO authenticated;
