-- 員工持股數（考績獎金股份分紅用）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'employees'
  ) THEN
    ALTER TABLE public.employees
      ADD COLUMN IF NOT EXISTS share_count numeric NOT NULL DEFAULT 0;

    COMMENT ON COLUMN public.employees.share_count IS '持股數；考績獎金股份分紅依此比例分配';
  END IF;
END $$;
