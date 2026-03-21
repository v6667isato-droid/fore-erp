-- 已套用舊版 000007 的環境：函式簽名曾為 (uuid, date, numeric, text)，與 PostgREST 依參數名字母序解析的 (uuid, numeric, date, text) 不符，導致 RPC 找不到函式。
DROP FUNCTION IF EXISTS public.approve_overtime_to_comp_leave (uuid, date, numeric, text);

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

  IF EXISTS (
    SELECT 1
    FROM public.overtime_records o
    WHERE
      o.employee_id = p_employee_id
      AND o.overtime_date = p_overtime_date
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
