-- 員工工坊分工：
-- 1) employees.english_name：員工英文名
-- 2) employee_duties：員工在工坊負責的項目（工序站別／產品系列／自訂項目）

alter table public.employees add column if not exists english_name text;

create table if not exists public.employee_duties (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('stage','series','custom')),
  stage text,
  series_id uuid references public.product_series(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint employee_duties_kind_payload check (
    (kind = 'stage' and stage is not null and series_id is null and label is null)
    or (kind = 'series' and series_id is not null and stage is null and label is null)
    or (kind = 'custom' and label is not null and label <> '' and stage is null and series_id is null)
  )
);

create index if not exists employee_duties_employee_idx
  on public.employee_duties (employee_id, sort_order, created_at);

create unique index if not exists employee_duties_unique_idx
  on public.employee_duties (employee_id, kind, coalesce(stage, ''), coalesce(series_id::text, ''), coalesce(label, ''));

alter table public.employee_duties enable row level security;

create policy employee_duties_authenticated_all on public.employee_duties
  for all to authenticated using (true) with check (true);
