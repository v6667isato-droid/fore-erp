-- 訂單水位新增「桌（TB 系列）」「架（SF 系列）」兩類，原「其他」剩櫃、搖椅、小物等。
-- 種子值為粗估，admin 可在總覽頁調整水位參數即時修改。
insert into public.app_settings (key, value, description) values
  ('lead_time_table_capacity_per_month', '400000', '桌（TB 系列）產能門檻（NT$/月），交期公式分母'),
  ('lead_time_table_base_months', '3', '桌（TB 系列）基準交期（月）'),
  ('lead_time_shelf_capacity_per_month', '200000', '架（SF 系列）產能門檻（NT$/月），交期公式分母'),
  ('lead_time_shelf_base_months', '2', '架（SF 系列）基準交期（月）')
on conflict (key) do nothing;

update public.app_settings
  set description = '其他（櫃、搖椅、小物等）產能門檻（NT$/月），交期公式分母'
  where key = 'lead_time_other_capacity_per_month';
update public.app_settings
  set description = '其他（櫃、搖椅、小物等）基準交期（月）'
  where key = 'lead_time_other_base_months';
