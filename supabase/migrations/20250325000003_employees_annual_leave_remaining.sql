-- 特休「結算後」剩餘天數（發放薪資時由 ERP 回寫）
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS annual_leave_remaining numeric;

COMMENT ON COLUMN employees.annual_leave_remaining IS '特休剩餘天數（可為小數）；發放薪資時依本月特休扣減後更新。';

-- 自舊欄位 special_leave_days 帶入初值（僅在該欄存在時執行）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'special_leave_days'
  ) THEN
    UPDATE employees
    SET annual_leave_remaining = COALESCE(annual_leave_remaining, special_leave_days)
    WHERE annual_leave_remaining IS NULL
      AND special_leave_days IS NOT NULL;
  END IF;
END $$;
