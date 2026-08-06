-- 椅子工單改版：
-- 1) work_order_stage_logs：工單工序變更紀錄（trigger 自動寫入），
--    供椅子工單「側邊／整張／噴漆階段」顯示各站別的更新日期。
-- 2) chair_work_order_snapshots：椅子工單每次列印輸出之快照（rows 為列印列 JSON）。

-- 工序變更紀錄
create table if not exists public.work_order_stage_logs (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  stage text not null,
  changed_at timestamptz not null default now()
);

create index if not exists work_order_stage_logs_wo_stage_idx
  on public.work_order_stage_logs (work_order_id, stage, changed_at desc);

alter table public.work_order_stage_logs enable row level security;

create policy work_order_stage_logs_authenticated_all on public.work_order_stage_logs
  for all to authenticated using (true) with check (true);

-- security definer：員工入口等以受限身分更新 work_orders 時，trigger 仍可寫入紀錄
create or replace function public.log_work_order_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or old.stage is distinct from new.stage then
    insert into public.work_order_stage_logs (work_order_id, stage)
    values (new.id, new.stage);
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_log_stage_change on public.work_orders;
create trigger work_orders_log_stage_change
  after insert or update of stage on public.work_orders
  for each row execute function public.log_work_order_stage_change();

-- 回填：以現行 stage＋updated_at 作為近似的變更時間（updated_at 為任一欄位更新時間，僅供起始參考）
insert into public.work_order_stage_logs (work_order_id, stage, changed_at)
select w.id, w.stage, coalesce(w.updated_at::timestamptz, w.created_at::timestamptz, now())
from public.work_orders w
where not exists (
  select 1 from public.work_order_stage_logs l where l.work_order_id = w.id
);

-- 椅子工單列印快照
create table if not exists public.chair_work_order_snapshots (
  id uuid primary key default gen_random_uuid(),
  sheet_date text not null default '',
  rows jsonb not null,
  row_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.chair_work_order_snapshots enable row level security;

create policy chair_work_order_snapshots_authenticated_all on public.chair_work_order_snapshots
  for all to authenticated using (true) with check (true);
