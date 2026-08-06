-- 桌（TB）與架（SF）水位合併為單一「桌架」類，共用一組參數。
-- 種子值為粗估（原桌 40萬＋架 20萬），admin 可在總覽頁即時調整。
insert into public.app_settings (key, value, description) values
  ('lead_time_table_shelf_capacity_per_month', '600000', '桌架（TB＋SF 系列）產能門檻（NT$/月），交期公式分母'),
  ('lead_time_table_shelf_base_months', '3', '桌架（TB＋SF 系列）基準交期（月）')
on conflict (key) do nothing;

delete from public.app_settings where key in (
  'lead_time_table_capacity_per_month',
  'lead_time_table_base_months',
  'lead_time_shelf_capacity_per_month',
  'lead_time_shelf_base_months'
);
