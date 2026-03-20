-- 特休跨日：起始日／結束日各一段整點區間（與舊欄 start_hour/end_hour 並存，後者代表起始日區間）
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_hour_span_chk;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS start_day_start_hour smallint,
  ADD COLUMN IF NOT EXISTS start_day_end_hour smallint,
  ADD COLUMN IF NOT EXISTS end_day_start_hour smallint,
  ADD COLUMN IF NOT EXISTS end_day_end_hour smallint;

COMMENT ON COLUMN public.leave_requests.start_day_start_hour IS '請假起始日·起始整點 0–23';
COMMENT ON COLUMN public.leave_requests.start_day_end_hour IS '請假起始日·結束整點 0–23（須大於起始）';
COMMENT ON COLUMN public.leave_requests.end_day_start_hour IS '請假結束日·起始整點 0–23';
COMMENT ON COLUMN public.leave_requests.end_day_end_hour IS '請假結束日·結束整點 0–23（須大於起始）';
