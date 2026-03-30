-- 事假／病假計薪天數（與 leave_deduction 對應；員工端薪資明細「請假天數」）
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS leave_days numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payslips.leave_days IS '結算月內事假／病假等計薪天數（扣款依據）';
