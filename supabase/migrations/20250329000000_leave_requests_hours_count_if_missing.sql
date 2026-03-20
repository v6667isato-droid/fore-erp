-- 若 leave_requests 在套用 20250326000000 之前已存在，CREATE TABLE IF NOT EXISTS 不會新增欄位
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS hours_count numeric;

COMMENT ON COLUMN public.leave_requests.hours_count IS '申請時數（特休等）；與 total_days 並存以利報表';
