-- 刪除誤登的加班紀錄：反向沖回 approve_overtime_to_comp_leave 做的三件事
-- （刪 overtime_records、扣回補休金庫、移除當日出勤「🔒 已轉補休」標籤）。僅 admin 可用。
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

  UPDATE public.daily_attendance
  SET
    status_tags = array_remove(COALESCE(status_tags, '{}'), '🔒 已轉補休'),
    updated_at = now()
  WHERE
    employee_id = v_employee_id
    AND attendance_date = v_date;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.revoke_overtime_comp_leave (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.revoke_overtime_comp_leave (uuid) TO authenticated;
