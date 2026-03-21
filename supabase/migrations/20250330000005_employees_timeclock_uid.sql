-- 打卡鐘 CSV 的員工代號，對應出勤戰情分析室 timeclock_uid 對映
ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS timeclock_uid text;

CREATE INDEX IF NOT EXISTS employees_timeclock_uid_idx
  ON public.employees (timeclock_uid)
  WHERE timeclock_uid IS NOT NULL AND trim(timeclock_uid) <> '';

COMMENT ON COLUMN public.employees.timeclock_uid IS '打卡鐘匯出 UID；與 CSV 第 3 欄對應以帶出 employees.name';
