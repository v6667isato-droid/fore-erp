-- 每日出勤彙總（戰情室批次寫入）；與 employees 聯動
-- 若遠端已手動建表，此檔仍會補上索引／RLS（CREATE TABLE IF NOT EXISTS 會略過已存在表結構差異，請自行對齊欄位）

CREATE TABLE IF NOT EXISTS public.daily_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  clock_in time without time zone,
  clock_out time without time zone,
  total_hours numeric(8, 2),
  is_abnormal boolean NOT NULL DEFAULT false,
  status_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_attendance_employee_date_key UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS daily_attendance_attendance_date_idx ON public.daily_attendance (attendance_date DESC);

CREATE INDEX IF NOT EXISTS daily_attendance_employee_id_idx ON public.daily_attendance (employee_id);

COMMENT ON TABLE public.daily_attendance IS '出勤戰情室匯入之每日打卡與異常標籤；UNIQUE(employee_id, attendance_date) 供 upsert';

COMMENT ON COLUMN public.daily_attendance.status_tags IS '異常／狀態標籤文案陣列，如 🌴 已請假、⏰ 遲到、🔒 已轉補休';

ALTER TABLE public.daily_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_attendance_admin_all" ON public.daily_attendance;

CREATE POLICY "daily_attendance_admin_all" ON public.daily_attendance FOR ALL TO authenticated USING (
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

DROP POLICY IF EXISTS "daily_attendance_select_own" ON public.daily_attendance;

CREATE POLICY "daily_attendance_select_own" ON public.daily_attendance FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE
      up.user_id = auth.uid()
      AND up.employee_id IS NOT NULL
      AND up.employee_id::text = daily_attendance.employee_id::text
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_attendance TO authenticated;
