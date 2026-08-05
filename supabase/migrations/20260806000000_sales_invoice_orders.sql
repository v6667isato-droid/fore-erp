-- 發票 ↔ 訂單多對多關聯（一張發票可涵蓋多張訂單；合併開票／光貿同步後補連結用）
-- sales_invoices.order_id 保留為「主要訂單」相容欄位；本表為完整連結來源
create table if not exists public.sales_invoice_orders (
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invoice_id, order_id)
);

alter table public.sales_invoice_orders enable row level security;

create policy sales_invoice_orders_authenticated_all on public.sales_invoice_orders
  for all to authenticated using (true) with check (true);

create index if not exists sales_invoice_orders_order_id_idx
  on public.sales_invoice_orders (order_id);

-- 既有單一連結回填
insert into public.sales_invoice_orders (invoice_id, order_id)
select id, order_id from public.sales_invoices
where order_id is not null
on conflict do nothing;
