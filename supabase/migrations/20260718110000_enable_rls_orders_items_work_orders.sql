-- RLS Phase 2（docs/RLS_POLICY_PLAN.md）：orders / order_items / work_orders 啟用 RLS。
-- 前置：通路入口 /portal 已改走 /api/portal/orders/*（service role + portal_token 驗證），
-- anon 不再直接讀寫這三張表；ERP 與員工端皆為 authenticated。
-- 註：work_orders 既有的 work_orders_update_own_assignee policy 在加入
-- authenticated_all 後成為冗餘（policy 之間為 OR），保留無害。
alter table public.orders enable row level security;
create policy orders_authenticated_all on public.orders
  for all to authenticated using (true) with check (true);

alter table public.order_items enable row level security;
create policy order_items_authenticated_all on public.order_items
  for all to authenticated using (true) with check (true);

alter table public.work_orders enable row level security;
create policy work_orders_authenticated_all on public.work_orders
  for all to authenticated using (true) with check (true);
