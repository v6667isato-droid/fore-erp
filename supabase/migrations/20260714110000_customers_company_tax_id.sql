alter table public.customers
  add column if not exists company text,
  add column if not exists tax_id text;
