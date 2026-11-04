-- 假單起訖時間（分鐘精度）：start_day_start_hour／end_day_end_hour 只存整點，
-- 員工可選 09:30 等時間，跨月假單分攤各月扣薪時數需要完整時間。
-- 舊假單維持 NULL，程式退回整點欄位估算。
alter table public.leave_requests
  add column if not exists start_time time,
  add column if not exists end_time time;

comment on column public.leave_requests.start_time is '請假起始時間（起始日，HH:MM）';
comment on column public.leave_requests.end_time is '請假結束時間（結束日，HH:MM）';
