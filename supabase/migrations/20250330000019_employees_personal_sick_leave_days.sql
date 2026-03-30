-- 員工事假／病假請假天數（可手動維護或日後由假單彙總更新）
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS personal_leave_days numeric NOT NULL DEFAULT 0;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS sick_leave_days numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employees.personal_leave_days IS '事假請假天數（曆日或公司定義天數）';
COMMENT ON COLUMN public.employees.sick_leave_days IS '病假請假天數（曆日或公司定義天數）';
