-- 發薪時若缺此二欄會報 schema cache；可單獨執行或改跑整份 payslips_settlement_columns.sql
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS labor_insurance_employee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS health_insurance_employee numeric NOT NULL DEFAULT 0;
