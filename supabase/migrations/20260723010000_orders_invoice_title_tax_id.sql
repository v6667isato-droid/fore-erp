-- 訂單寄送／發票資訊：新增「公司抬頭」「統一編號」欄位（選客戶時自動帶入客戶主檔的 invoice_title / tax_id）
alter table public.orders
  add column if not exists invoice_title text,
  add column if not exists invoice_tax_id text;

comment on column public.orders.invoice_title is '發票公司抬頭（開單時自客戶主檔帶入，可改）';
comment on column public.orders.invoice_tax_id is '統一編號（開單時自客戶主檔帶入，可改）';
