-- RLS Phase 1（docs/RLS_POLICY_PLAN.md）：channels 與 customers 啟用 RLS。
-- channels：堵住 portal_code / portal_password 匿名外洩（anon key 在前端為公開）。
-- customers：客戶個資（電話、地址、LINE、統編）。
-- 通路入口登入走 /api/portal-login（service role），不受影響。
alter table public.channels enable row level security;
create policy channels_authenticated_all on public.channels
  for all to authenticated using (true) with check (true);

alter table public.customers enable row level security;
create policy customers_authenticated_all on public.customers
  for all to authenticated using (true) with check (true);
