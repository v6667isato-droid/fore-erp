-- total_days 原為 numeric(4,1)，寫入 0.125 天（1 小時）會被四捨五入成 0.1 天，
-- 造成審核頁與特休結算顯示 0.8 小時。放寬為不限精度 numeric，
-- 並以 hours_count 回填既有被進位過的資料。
ALTER TABLE public.leave_requests
  ALTER COLUMN total_days TYPE numeric;

UPDATE public.leave_requests
SET total_days = hours_count / 8.0
WHERE hours_count IS NOT NULL
  AND total_days IS DISTINCT FROM hours_count / 8.0;
