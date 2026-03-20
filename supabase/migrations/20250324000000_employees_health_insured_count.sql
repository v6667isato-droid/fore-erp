-- 健保投保人數（含本人），供薪資／保險試算與申報參考
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS health_employee_burden_number integer;

COMMENT ON COLUMN employees.health_employee_burden_number IS '健保投保人數（含自己）';
