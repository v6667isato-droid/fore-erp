-- 舊版遷移曾使用 days_count；與現有欄位 total_days 對齊
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leave_requests'
      AND column_name = 'days_count'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leave_requests'
      AND column_name = 'total_days'
  ) THEN
    ALTER TABLE public.leave_requests RENAME COLUMN days_count TO total_days;
  END IF;
END $$;
