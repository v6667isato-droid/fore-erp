-- =============================================================================
-- payslips：薪資結算（salary-settlement-center）寫入 + 員工儀表板讀取
-- 在 Supabase → SQL Editor 整份貼上執行即可（表須已存在 public.payslips）
-- 可重複執行：皆為 IF NOT EXISTS
-- =============================================================================
-- insert 使用欄位：
--   employee_id, period_key, pay_period（與 period_key 同 YYYY-MM，舊表可能僅 NOT NULL 此欄）,
--   month_label, base_salary, net_pay, net_salary（與 net_pay 同值，舊表可能僅 NOT NULL 此欄）,
--   status, bonus_and_overtime, leave_deduction,
--   labor_insurance_employee, health_insurance_employee, health_insured_persons,
--   overtime_days, special_leave_days_settled, leave_days, other_adjust
-- 讀取另用：id（主鍵，建表時應已有）, created_at（建議）
-- =============================================================================

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS employee_id text;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS period_key text;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS pay_period text;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS month_label text;

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS base_salary numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS net_pay numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS net_salary numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'calculating';

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS bonus_and_overtime numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS leave_deduction numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS labor_insurance_employee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS health_insurance_employee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS health_insured_persons integer;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS overtime_days numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS special_leave_days_settled numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS leave_days numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS other_adjust numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS payroll_bonus numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.payslips.employee_id IS '對應 employees.id';
COMMENT ON COLUMN public.payslips.period_key IS '結算月 YYYY-MM';
COMMENT ON COLUMN public.payslips.pay_period IS '結算月 YYYY-MM（與 period_key 同值；應用程式寫入兩者以相容舊 schema）';
COMMENT ON COLUMN public.payslips.month_label IS '顯示用，如 2026 年 3 月';
COMMENT ON COLUMN public.payslips.base_salary IS '當月底薪（結算快照）';
COMMENT ON COLUMN public.payslips.net_pay IS '實發總額';
COMMENT ON COLUMN public.payslips.net_salary IS '實發總額（與 net_pay 同值；相容舊 schema）';
COMMENT ON COLUMN public.payslips.status IS 'paid | calculating 等';
COMMENT ON COLUMN public.payslips.bonus_and_overtime IS '加項：加班費等';
COMMENT ON COLUMN public.payslips.leave_deduction IS '請假扣款';
COMMENT ON COLUMN public.payslips.labor_insurance_employee IS '勞保自付額（發薪快照）';
COMMENT ON COLUMN public.payslips.health_insurance_employee IS '健保自付額（發薪快照）';
COMMENT ON COLUMN public.payslips.health_insured_persons IS '健保加保人數（發薪快照）';
COMMENT ON COLUMN public.payslips.overtime_days IS '加班天數';
COMMENT ON COLUMN public.payslips.special_leave_days_settled IS '本月核准特休天數（自餘額扣）';
COMMENT ON COLUMN public.payslips.leave_days IS '結算月內事假／病假等計薪天數（扣款依據）';
COMMENT ON COLUMN public.payslips.other_adjust IS '其他加減項（可正可負；不含考績獎金）';
COMMENT ON COLUMN public.payslips.payroll_bonus IS '考績／分潤／股份等獎金（發放快照）';
COMMENT ON COLUMN public.payslips.created_at IS '建立時間';
