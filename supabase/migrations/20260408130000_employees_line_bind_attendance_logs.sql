-- 員工 LINE 綁定（line_user_id / line_bind_code）與 LINE 地理打卡明細 attendance_logs

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS line_user_id text,
  ADD COLUMN IF NOT EXISTS line_bind_code text;

COMMENT ON COLUMN public.employees.line_user_id IS 'LINE Messaging API userId（U 開頭）；使用者傳入 line_bind_code 綁定後寫入';
COMMENT ON COLUMN public.employees.line_bind_code IS '一次性綁定驗證碼（人資於後台設定）；綁定成功後清空';

CREATE UNIQUE INDEX IF NOT EXISTS employees_line_user_id_unique
  ON public.employees (line_user_id)
  WHERE line_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_line_bind_code_unique
  ON public.employees (line_bind_code)
  WHERE line_bind_code IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  check_type text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  distance_meters numeric(12, 2) NOT NULL,
  source text NOT NULL DEFAULT 'line',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_logs_employee_id_idx ON public.attendance_logs (employee_id);
CREATE INDEX IF NOT EXISTS attendance_logs_created_at_idx ON public.attendance_logs (created_at DESC);

COMMENT ON TABLE public.attendance_logs IS 'LINE LIFF 等即時地理打卡明細（與 daily_attendance 戰情室匯總分表）';

ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_logs_admin_all" ON public.attendance_logs;

CREATE POLICY "attendance_logs_admin_all" ON public.attendance_logs FOR ALL TO authenticated USING (
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

DROP POLICY IF EXISTS "attendance_logs_select_own" ON public.attendance_logs;

CREATE POLICY "attendance_logs_select_own" ON public.attendance_logs FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id IS NOT NULL
      AND up.employee_id::text = attendance_logs.employee_id::text
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_logs TO authenticated;
