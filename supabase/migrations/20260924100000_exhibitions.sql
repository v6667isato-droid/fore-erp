-- 展覽效益：展覽場次主檔、參展成本明細；訂單可標記「在哪一場展覽成交」。
-- 效益統計（成本統計頁「展覽效益」分頁）：
--   現場成交＝orders.exhibition_id 為該場次；
--   展後轉單＝客戶來源（customers.source）等於該場次 customer_source、未標記場次、
--             下單日落在本屆開始～下一屆同展開始前的訂單。

create table if not exists public.exhibitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  location text,
  customer_source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint exhibitions_date_range check (end_date >= start_date)
);

comment on table public.exhibitions is '展覽場次：每年每場一筆（如 2026 木質生活展）';
comment on column public.exhibitions.name is '展名（同展名跨年份視為同一個展，用來找「下一屆」）';
comment on column public.exhibitions.customer_source is '對應的客戶來源值（customers.source，如「展覽(木質生活)」），用於推算展後轉單';

create table if not exists public.exhibition_costs (
  id uuid primary key default gen_random_uuid(),
  exhibition_id uuid not null references public.exhibitions(id) on delete cascade,
  item text not null,
  amount numeric not null default 0,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.exhibition_costs is '參展成本明細（攤位費、裝潢、運輸、住宿、人力等）';

create index if not exists idx_exhibition_costs_exhibition on public.exhibition_costs(exhibition_id);

alter table public.orders
  add column if not exists exhibition_id uuid references public.exhibitions(id) on delete set null;

comment on column public.orders.exhibition_id is '在哪一場展覽成交（現場成交）；NULL＝非展場訂單';

create index if not exists idx_orders_exhibition on public.orders(exhibition_id) where exhibition_id is not null;

alter table public.exhibitions enable row level security;
create policy exhibitions_authenticated_all on public.exhibitions
  for all to authenticated using (true) with check (true);

alter table public.exhibition_costs enable row level security;
create policy exhibition_costs_authenticated_all on public.exhibition_costs
  for all to authenticated using (true) with check (true);

drop trigger if exists audit_exhibitions on public.exhibitions;
create trigger audit_exhibitions after insert or update or delete on public.exhibitions
  for each row execute function public.log_audit();

drop trigger if exists audit_exhibition_costs on public.exhibition_costs;
create trigger audit_exhibition_costs after insert or update or delete on public.exhibition_costs
  for each row execute function public.log_audit();
