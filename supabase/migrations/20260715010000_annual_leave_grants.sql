-- 特休授予紀錄：員工年資達勞基法第 38 條里程碑時，老闆於薪資結算頁核准授予
CREATE TABLE IF NOT EXISTS public.annual_leave_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  -- 年資里程碑：0.5＝滿六個月、1＝滿一年…；同一里程碑僅授予一次
  milestone_years numeric NOT NULL,
  days numeric NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (employee_id, milestone_years)
);

COMMENT ON TABLE public.annual_leave_grants IS '勞基法特休授予紀錄；薪資結算頁「新增特休」欄由此判斷里程碑是否已授予';
COMMENT ON COLUMN public.annual_leave_grants.milestone_years IS '0.5＝滿六個月（3天）、1＝滿一年（7天）、2（10天）、3–4（14天）、5–9（15天）、10+ 每年加 1 天至 30 天';

CREATE INDEX IF NOT EXISTS annual_leave_grants_employee_id_idx
  ON public.annual_leave_grants (employee_id);

ALTER TABLE public.annual_leave_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "annual_leave_grants_select_authenticated"
  ON public.annual_leave_grants FOR SELECT TO authenticated USING (true);

CREATE POLICY "annual_leave_grants_insert_authenticated"
  ON public.annual_leave_grants FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "annual_leave_grants_delete_authenticated"
  ON public.annual_leave_grants FOR DELETE TO authenticated USING (true);

-- 回填：功能上線前已達成的里程碑視為已授予（既有 annual_leave_remaining 已含），
-- 避免老員工被提醒補發全部歷史特休。年資=到職至今月數，扣除留職停薪月份。
WITH emp AS (
  SELECT
    id,
    hire_date,
    (EXTRACT(YEAR FROM age(current_date, hire_date)) * 12
     + EXTRACT(MONTH FROM age(current_date, hire_date)))::int
    - COALESCE((
        SELECT count(DISTINCT m)
        FROM unnest(COALESCE(unpaid_leave_months, '{}')) m
        WHERE m ~ '^\d{4}-\d{2}$'
          AND m >= to_char(hire_date, 'YYYY-MM')
          AND m <= to_char(current_date, 'YYYY-MM')
      ), 0) AS total_months
  FROM public.employees
  WHERE hire_date IS NOT NULL
    AND deleted_at IS NULL
),
milestones AS (
  SELECT e.id AS employee_id, 0.5::numeric AS milestone_years, 3::numeric AS days
  FROM emp e
  WHERE e.total_months >= 6
  UNION ALL
  SELECT
    e.id,
    y::numeric,
    (CASE
      WHEN y = 1 THEN 7
      WHEN y = 2 THEN 10
      WHEN y IN (3, 4) THEN 14
      WHEN y <= 9 THEN 15
      ELSE least(15 + (y - 9), 30)
    END)::numeric
  FROM emp e
  CROSS JOIN LATERAL generate_series(1, greatest(e.total_months / 12, 0)) y
)
INSERT INTO public.annual_leave_grants (employee_id, milestone_years, days, note)
SELECT employee_id, milestone_years, days, '系統回填：功能上線前既有年資里程碑（不影響餘額）'
FROM milestones
ON CONFLICT (employee_id, milestone_years) DO NOTHING;
