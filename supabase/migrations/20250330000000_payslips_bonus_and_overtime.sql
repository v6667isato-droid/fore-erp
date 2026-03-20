-- 薪資結算寫入；員工儀表板明細「專案獎金／加班費」
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips
      ADD COLUMN IF NOT EXISTS bonus_and_overtime numeric NOT NULL DEFAULT 0;

    COMMENT ON COLUMN public.payslips.bonus_and_overtime IS '加項：獎金／加班費等（結算中心目前寫入加班費）';
  END IF;
END $$;
