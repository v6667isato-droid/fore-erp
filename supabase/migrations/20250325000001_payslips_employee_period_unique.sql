-- 避免同一員工、同一結算月份重複發放（若專案尚無 payslips 表則略過）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS payslips_employee_id_period_key_key
      ON public.payslips (employee_id, period_key);
  END IF;
END $$;
