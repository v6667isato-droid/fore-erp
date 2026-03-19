alter table public.orders
add column if not exists shipping_fee numeric(12,2) not null default 0;
