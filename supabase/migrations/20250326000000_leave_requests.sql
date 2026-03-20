-- 員工請假申請（員工入口寫入、待審核）
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  leave_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- 特休等整點時段：0–23，結束時須大於開始（不含分鐘）
  start_hour smallint,
  end_hour smallint,
  hours_count numeric,
  total_days numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  deducts_salary boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_hour_span_chk CHECK (
    (start_hour IS NULL AND end_hour IS NULL)
    OR (
      start_hour IS NOT NULL
      AND end_hour IS NOT NULL
      AND start_hour >= 0
      AND start_hour <= 23
      AND end_hour >= 0
      AND end_hour <= 23
      AND end_hour > start_hour
    )
  )
);

CREATE INDEX IF NOT EXISTS leave_requests_employee_id_created_at_idx
  ON public.leave_requests (employee_id, created_at DESC);

COMMENT ON TABLE public.leave_requests IS '員工請假；特休可填 start_hour/end_hour 與 hours_count（整點）';
COMMENT ON COLUMN public.leave_requests.hours_count IS '申請時數（特休等）；與 total_days 並存以利報表';

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- 僅能讀寫 user_profiles.employee_id 與本列 employee_id 相符之假單
CREATE POLICY "leave_requests_select_own"
  ON public.leave_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.employee_id IS NOT NULL
        AND up.employee_id::text = leave_requests.employee_id
    )
  );

CREATE POLICY "leave_requests_insert_own"
  ON public.leave_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.employee_id IS NOT NULL
        AND up.employee_id::text = leave_requests.employee_id
    )
    AND (user_id IS NULL OR user_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.leave_requests TO authenticated;
