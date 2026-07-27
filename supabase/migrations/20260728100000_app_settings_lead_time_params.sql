-- 通用 key-value 設定表：首批放「訂單水位與交期預估」參數。
-- RLS 慣例同 enable_rls_internal_tables：已登入即可完整存取。
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
create policy app_settings_authenticated_all on public.app_settings
  for all to authenticated using (true) with check (true);

insert into public.app_settings (key, value, description) values
  ('lead_time_chair_capacity_per_month', '500000', '椅子產能門檻（NT$/月），交期公式分母'),
  ('lead_time_chair_base_months', '2', '椅子基準交期（月）'),
  ('lead_time_other_capacity_per_month', '900000', '其他（桌櫃等）產能門檻（NT$/月），交期公式分母'),
  ('lead_time_other_base_months', '3', '其他（桌櫃等）基準交期（月）');
