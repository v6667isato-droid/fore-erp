-- 薪資單明細：勞健保快照、健保人數、加班、特休結算、其他加減
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS labor_insurance_employee numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS health_insurance_employee numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS health_insured_persons integer;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS overtime_days numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS special_leave_days_settled numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS other_adjust numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
