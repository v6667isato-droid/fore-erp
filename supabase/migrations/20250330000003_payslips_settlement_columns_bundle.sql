-- 一次補齊應用程式對 payslips 讀寫所需欄位（與 salary-settlement-center、employee-portal-supabase 對齊）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS employee_id text;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS period_key text;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS pay_period text;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS month_label text;

    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS base_salary numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS net_pay numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS net_salary numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'calculating';

    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS bonus_and_overtime numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS leave_deduction numeric NOT NULL DEFAULT 0;

    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
