-- 假日加班核准：overtime_records + 補休金庫 comp_leave_remaining（RPC 單一交易）

ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS comp_leave_remaining numeric(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employees.comp_leave_remaining IS '補休剩餘時數（小時）；假日加班核准時累加';

CREATE TABLE IF NOT EXISTS public.overtime_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  overtime_date date NOT NULL,
  hours numeric(10, 2) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT overtime_records_hours_pos_chk CHECK (hours > 0),
  CONSTRAINT overtime_records_employee_date_key UNIQUE (employee_id, overtime_date)
);

CREATE INDEX IF NOT EXISTS overtime_records_employee_id_idx ON public.overtime_records (employee_id);

CREATE INDEX IF NOT EXISTS overtime_records_overtime_date_idx ON public.overtime_records (overtime_date DESC);

COMMENT ON TABLE public.overtime_records IS '老闆核准之假日／加班轉補休紀錄；與 employees.comp_leave_remaining 聯動';

ALTER TABLE public.overtime_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "overtime_records_admin_all" ON public.overtime_records;

CREATE POLICY "overtime_records_admin_all" ON public.overtime_records FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.overtime_records TO authenticated;

-- 單一交易：寫入紀錄、入帳補休、併入 daily_attendance.status_tags（若該日有列）
-- 參數順序須為 (uuid, numeric, date, text)：PostgREST 會依參數名字母序對應型別 (p_employee_id, p_hours, p_overtime_date, p_reason)
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

COMMENT ON FUNCTION public.approve_overtime_to_comp_leave (uuid, numeric, date, text) IS '管理員：核准加班寫入 overtime_records、累加 comp_leave_remaining、更新 daily_attendance 標籤';
