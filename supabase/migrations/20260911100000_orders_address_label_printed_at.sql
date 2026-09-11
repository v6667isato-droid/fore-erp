-- 地址條列印紀錄：列印頁按下列印時寫入時間，訂單列表據此標示「已列印地址條」
alter table public.orders
  add column if not exists address_label_printed_at timestamptz;

comment on column public.orders.address_label_printed_at is '最近一次列印地址條的時間（未列印過為 NULL）';
