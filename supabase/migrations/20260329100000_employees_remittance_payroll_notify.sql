-- 員工匯款資料與薪資入帳通知信箱（發放薪資時寄信）
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS remittance_bank text,
  ADD COLUMN IF NOT EXISTS remittance_account text,
  ADD COLUMN IF NOT EXISTS payroll_notification_email text;

COMMENT ON COLUMN public.employees.remittance_bank IS '匯款銀行名稱';
COMMENT ON COLUMN public.employees.remittance_account IS '匯款帳號';
COMMENT ON COLUMN public.employees.payroll_notification_email IS '薪資入帳通知信收件信箱；空白時使用 employees.email';
