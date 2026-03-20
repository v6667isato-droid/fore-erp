-- 薪資結算寫入；員工儀表板明細「請假扣款」
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips
      ADD COLUMN IF NOT EXISTS leave_deduction numeric NOT NULL DEFAULT 0;

    COMMENT ON COLUMN public.payslips.leave_deduction IS '請假扣款（事假／病假等，結算中心寫入）';
  END IF;
END $$;
