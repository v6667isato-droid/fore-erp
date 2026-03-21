-- 薪資單出勤／假單／加班彙整備註（結算中心寫入、已發放查詢顯示）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS notes text;

    COMMENT ON COLUMN public.payslips.notes IS '系統彙整之出勤備註（daily_attendance／假單／加班等）';
  END IF;
END $$;
