-- 員工留職停薪月份（YYYY-MM 清單）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'employees'
  ) THEN
    ALTER TABLE public.employees
      ADD COLUMN IF NOT EXISTS unpaid_leave_months text[] NOT NULL DEFAULT '{}';

    COMMENT ON COLUMN public.employees.unpaid_leave_months IS '曾留職停薪之月份（YYYY-MM），供薪資／年資參考';
  END IF;
END $$;
