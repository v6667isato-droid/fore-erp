-- 特休假天數（可為小數，例如半日）
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS special_leave_days numeric;

COMMENT ON COLUMN employees.special_leave_days IS '特休假天數（由 HR 維護，單位：日）';
