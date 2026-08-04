-- 薪資單發放快照補強：
-- 1) comp_leave_remaining_after：發放當下結算後補休剩餘（小時），與 special_leave_remaining_after 對應
-- 2) other_leave_days / other_leave_detail：結算月其他假期（婚假、生理假等非特休、非事假病假）天數與假別明細
alter table public.payslips
  add column if not exists comp_leave_remaining_after numeric,
  add column if not exists other_leave_days numeric not null default 0,
  add column if not exists other_leave_detail text;

comment on column public.payslips.comp_leave_remaining_after is '發放當下結算後補休剩餘快照（小時；舊資料 NULL）';
comment on column public.payslips.other_leave_days is '結算月其他假期天數（非特休、非事假病假）';
comment on column public.payslips.other_leave_detail is '其他假期假別明細，如「婚假 2 天、生理假 1 天」';
