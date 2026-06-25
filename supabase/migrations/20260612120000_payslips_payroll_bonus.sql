-- 薪資單：考績／分潤／股份獎金（與 other_adjust 分開儲存）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS payroll_bonus numeric NOT NULL DEFAULT 0;
    COMMENT ON COLUMN public.payslips.payroll_bonus IS '考績／分潤／股份等獎金（發放快照；不含手動其他調整）';
  END IF;
END $$;
