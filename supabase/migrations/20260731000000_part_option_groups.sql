-- 零件變體選項主檔：四大類（木料／五金／耗材／塗料）各自可手動定義「大項」與「細項」。
-- 木料的「木材種類」沿用既有 materials 表（驅動 part_variants.material_code 與 BOM resolve），
-- 不在此重複建檔；本表用於其餘可自訂的選項軸。

create table if not exists public.part_option_groups (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('木料', '五金', '耗材', '塗料')),
  code text not null,
  name_zh text not null,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists part_option_groups_category_code_uniq
  on public.part_option_groups (category, code)
  where deleted_at is null;

create index if not exists part_option_groups_category_sort_idx
  on public.part_option_groups (category, sort_order)
  where deleted_at is null;

create table if not exists public.part_option_values (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.part_option_groups (id) on delete cascade,
  code text not null,
  name_zh text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists part_option_values_group_code_uniq
  on public.part_option_values (group_id, code)
  where deleted_at is null;

create index if not exists part_option_values_group_sort_idx
  on public.part_option_values (group_id, sort_order)
  where deleted_at is null;

alter table public.part_option_groups enable row level security;
alter table public.part_option_values enable row level security;

drop policy if exists part_option_groups_authenticated_all on public.part_option_groups;
create policy part_option_groups_authenticated_all
  on public.part_option_groups for all to authenticated
  using (true) with check (true);

drop policy if exists part_option_values_authenticated_all on public.part_option_values;
create policy part_option_values_authenticated_all
  on public.part_option_values for all to authenticated
  using (true) with check (true);

-- 零件表單移除「發注點」欄位，缺料提醒門檻改以安全庫存為準：既有資料一次對齊，
-- 之後由零件編輯畫面於存檔時同步寫入（reorder_point = safety_stock）。
update public.parts
set reorder_point = safety_stock
where deleted_at is null and reorder_point is distinct from safety_stock;

comment on table public.part_option_groups is '零件變體選項大項（依零件分類分組）；木料的木材種類另存於 materials';
comment on table public.part_option_values is '零件變體選項細項；目前為主檔，尚未參與變體生成';
