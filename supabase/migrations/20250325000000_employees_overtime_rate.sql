-- 薪資結算：休息日「每加班日」基準金額（8 小時）；NULL 時由前端依月薪公式試算
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS overtime_rate numeric;

COMMENT ON COLUMN employees.overtime_rate IS '休息日加班每「日」基準金額（對應 8 小時）；NULL 表示由系統依月薪 (月薪÷240 公式) 自動計算。';
