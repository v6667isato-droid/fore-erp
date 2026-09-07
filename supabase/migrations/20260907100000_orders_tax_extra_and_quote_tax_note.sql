-- 訂單稅金欄位：
--   tax_extra          稅金外加：總金額（折扣後小計＋運費）另加 5% 營業稅
--   tax_extra_amount   稅金外加時的營業稅額（已含在 total_amount 內；未勾選為 0）
--   quote_includes_tax 報價單備註顯示「報價含營業稅」
alter table public.orders
  add column if not exists tax_extra boolean not null default false,
  add column if not exists tax_extra_amount numeric not null default 0,
  add column if not exists quote_includes_tax boolean not null default false;

comment on column public.orders.tax_extra is '稅金外加：總金額（折扣後小計＋運費）另加 5% 營業稅';
comment on column public.orders.tax_extra_amount is '稅金外加時的營業稅額（已含在 total_amount 內；未勾選為 0）';
comment on column public.orders.quote_includes_tax is '報價單備註顯示「報價含營業稅」';
