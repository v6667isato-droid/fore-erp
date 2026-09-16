-- 同日多段加班（例：早上提早來加班＋下班後再加班）原本無法核准：
-- overtime_records 有「一天一筆」的 UNIQUE(employee_id, overtime_date)，
-- 且 approve_overtime_request 會先以「當日已有紀錄」回 already_exists，第二段永遠核不過。
--
-- 本次修正：
-- 1) 解除 overtime_records 的 UNIQUE，改為一般索引；同一天可存在多段加班紀錄
-- 2) approve_overtime_request 改以「時段重疊」為準：同日不重疊的多段皆可核准；
--    若當日已有整日制紀錄（手動補登／週末戰情核准，無對應申報單）仍擋下，避免重複入帳
-- 3) overtime_requests 新增 BEFORE INSERT trigger：送單當下就擋掉與 pending／approved 重疊的時段
-- 4) 撤銷（revoke_overtime_request／revoke_overtime_comp_leave）僅在當日已無其他「轉補休」
--    紀錄時，才移除 daily_attendance 的「🔒 已轉補休」標籤
-- 5) approve_overtime_to_comp_leave（手動補登）改為只擋「同員工同日同時數」的重複補登
-- 一天一筆 → 一天多段
ALTER TABLE public.overtime_records
DROP CONSTRAINT IF EXISTS overtime_records_employee_date_key;

CREATE INDEX IF NOT EXISTS overtime_records_employee_date_idx ON public.overtime_records (employee_id, overtime_date);

COMMENT ON TABLE public.overtime_records IS '老闆核准之假日／加班轉補休紀錄；同一天可有多段（早上／下班後分開申報），與 employees.comp_leave_remaining 聯動';

-- 折抵方式判斷與前端一致（payslip-attendance-remarks.isPayOvertimeRecord）：
-- reason 前綴【加班費】＝計薪；其餘（含【補休】與手動補登舊紀錄）＝轉補休
CREATE OR REPLACE FUNCTION public.is_comp_leave_overtime_record (p_reason text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
SELECT COALESCE(btrim(p_reason), '') NOT LIKE '【加班費】%';
$$;

COMMENT ON FUNCTION public.is_comp_leave_overtime_record (text) IS 'overtime_records.reason 是否為「轉補休」紀錄（非【加班費】前綴）';

-- 送單即擋重疊：同員工同日、狀態 pending／approved 之時段不得相交
-- （SECURITY DEFINER：申報者自己的 RLS 可視範圍不影響判斷）
CREATE OR REPLACE FUNCTION public.overtime_requests_reject_overlap () RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.overtime_requests r
    WHERE
      r.employee_id = NEW.employee_id
      AND r.overtime_date = NEW.overtime_date
      AND r.id <> NEW.id
      AND r.status IN ('pending', 'approved')
      AND r.start_time < NEW.end_time
      AND r.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION '加班時段與同日既有申報重疊，請確認起訖時間（同日分段加班請填不重疊的時段）'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;

$$;

REVOKE ALL ON FUNCTION public.overtime_requests_reject_overlap () FROM PUBLIC;

DROP TRIGGER IF EXISTS overtime_requests_reject_overlap ON public.overtime_requests;

CREATE TRIGGER overtime_requests_reject_overlap
  BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.overtime_requests_reject_overlap ();

-- 核准：管理員或 service_role（telegram bot）；同 20260807010000，僅改「當日已有紀錄」的判斷
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

  -- 手動補登／週末戰情核准之紀錄無起訖時間，視為整日：當日已有此類紀錄即不再核准申報單
  IF EXISTS (
    SELECT 1
    FROM public.overtime_records o
    WHERE
      o.employee_id = v_req.employee_id
      AND o.overtime_date = v_req.overtime_date
      AND NOT EXISTS (
        SELECT 1
        FROM public.overtime_requests r
        WHERE r.record_id = o.id
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_exists');
  END IF;

  -- 同日多段加班可分別核准，但時段不得重疊（避免同一段時間重複入帳）
  IF EXISTS (
    SELECT 1
    FROM public.overtime_requests r
    WHERE
      r.employee_id = v_req.employee_id
      AND r.overtime_date = v_req.overtime_date
      AND r.id <> v_req.id
      AND r.status = 'approved'
      AND r.start_time < v_req.end_time
      AND r.end_time > v_req.start_time
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'overlap');
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

GRANT EXECUTE ON FUNCTION public.approve_overtime_request (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_overtime_request (uuid) IS '管理員／service_role：核准加班申報並寫入 overtime_records；同日多段只要時段不重疊皆可核准';

-- 撤銷已核准申報：同 20260907110000，僅在當日已無其他「轉補休」紀錄時才移除出勤標籤
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

        -- 同日可能還有另一段已核准的轉補休，標籤要留著
        IF NOT EXISTS (
          SELECT 1
          FROM public.overtime_records o
          WHERE
            o.employee_id = v_req.employee_id
            AND o.overtime_date = v_req.overtime_date
            AND public.is_comp_leave_overtime_record(o.reason)
        ) THEN
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

COMMENT ON FUNCTION public.revoke_overtime_request (uuid, text) IS '管理員：撤銷已核准加班申報；扣回補休，當日已無其他轉補休紀錄時才移除出勤標籤';

-- 刪除誤登的加班紀錄：同 20260804000000，僅在當日已無其他「轉補休」紀錄時才移除出勤標籤
CREATE OR REPLACE FUNCTION public.revoke_overtime_comp_leave (p_record_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_employee_id uuid;
  v_hours numeric;
  v_date date;
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

  SELECT o.employee_id, o.hours, o.overtime_date
  INTO v_employee_id, v_hours, v_date
  FROM public.overtime_records o
  WHERE o.id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'record_not_found');
  END IF;

  DELETE FROM public.overtime_records WHERE id = p_record_id;

  -- 不做下限夾制：若補休已被請掉，扣回後餘額可能為負，讓管理員看到並人工處理
  UPDATE public.employees
  SET
    comp_leave_remaining = COALESCE(comp_leave_remaining, 0) - COALESCE(v_hours, 0)
  WHERE
    id = v_employee_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.overtime_records o
    WHERE
      o.employee_id = v_employee_id
      AND o.overtime_date = v_date
      AND public.is_comp_leave_overtime_record(o.reason)
  ) THEN
    UPDATE public.daily_attendance
    SET
      status_tags = array_remove(COALESCE(status_tags, '{}'), '🔒 已轉補休'),
      updated_at = now()
    WHERE
      employee_id = v_employee_id
      AND attendance_date = v_date;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_overtime_comp_leave (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_overtime_comp_leave (uuid) TO authenticated;

-- 手動補登：同 20250330000008，僅把「當日已有紀錄」放寬為「同員工同日同時數」的重複補登
CREATE OR REPLACE FUNCTION public.approve_overtime_to_comp_leave (
  p_employee_id uuid,
  p_hours numeric,
  p_overtime_date date,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
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

  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hours');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE
      e.id = p_employee_id
      AND e.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  -- 同日可補登多段（早上／下班後），僅擋時數也相同的重複補登
  IF EXISTS (
    SELECT 1
    FROM public.overtime_records o
    WHERE
      o.employee_id = p_employee_id
      AND o.overtime_date = p_overtime_date
      AND o.hours = p_hours
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_exists');
  END IF;

  INSERT INTO public.overtime_records(employee_id, overtime_date, hours, reason, created_by)
  VALUES (
    p_employee_id,
    p_overtime_date,
    p_hours,
    NULLIF(trim(COALESCE(p_reason, '')), ''),
    auth.uid()
  );

  UPDATE public.employees
  SET
    comp_leave_remaining = COALESCE(comp_leave_remaining, 0) + p_hours
  WHERE
    id = p_employee_id;

  UPDATE public.daily_attendance
  SET
    status_tags = CASE
      WHEN '🔒 已轉補休' = ANY (COALESCE(status_tags, '{}')) THEN status_tags
      ELSE COALESCE(status_tags, '{}') || ARRAY['🔒 已轉補休']::text[]
    END,
    updated_at = now()
  WHERE
    employee_id = p_employee_id
    AND attendance_date = p_overtime_date;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) TO authenticated;

COMMENT ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) IS '管理員：手動補登加班並累加 comp_leave_remaining；同日可多段，僅擋同時數之重複補登';
