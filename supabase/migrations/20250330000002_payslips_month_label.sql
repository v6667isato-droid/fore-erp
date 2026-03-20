-- 薪資結算寫入；列表／明細顯示用（如「2026 年 3 月」）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'payslips'
  ) THEN
    ALTER TABLE public.payslips
      ADD COLUMN IF NOT EXISTS month_label text;

    COMMENT ON COLUMN public.payslips.month_label IS '結算月份顯示文案（與 period_key 對應）';
  END IF;
END $$;
