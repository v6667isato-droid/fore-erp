-- 訂單履歷：訂單狀態變更紀錄（比照 work_order_stage_history，由 trigger 自動寫入）。
-- audit_logs 只開放 admin 讀取，履歷時間軸要讓一般員工也看得到「什麼時候進到哪個狀態」，
-- 因此另存一張只有狀態的歷程表。2026/8/6 起的紀錄由 audit_logs 回填。

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_user_id uuid references auth.users (id) on delete set null,
  -- service role 寫入時的來源標記（同 audit_logs.actor_label，例如 portal:<channel_id>）
  actor_label text,
  changed_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx
  on public.order_status_history (order_id, changed_at);

comment on table public.order_status_history is '訂單狀態異動歷程，由 trigger 自動寫入，前端不應直接 insert';

alter table public.order_status_history enable row level security;

drop policy if exists order_status_history_select_authenticated on public.order_status_history;
create policy order_status_history_select_authenticated on public.order_status_history
  for select to authenticated using (true);

-- 回填（先回填再建 trigger；已有紀錄的訂單略過，可重複執行）
insert into public.order_status_history
  (order_id, old_status, new_status, changed_by_user_id, actor_label, changed_at)
select o.id,
       case when a.action = 'UPDATE' then a.old_data ->> 'status' end,
       a.new_data ->> 'status',
       (select u.id from auth.users u where u.id = a.actor_id),
       a.actor_label,
       a.happened_at
  from public.audit_logs a
  join public.orders o on o.id::text = a.record_id
 where a.table_name = 'orders'
   and (a.action = 'INSERT' or (a.action = 'UPDATE' and 'status' = any (a.changed_fields)))
   and a.new_data ->> 'status' is not null
   and not exists (select 1 from public.order_status_history h where h.order_id = o.id)
 order by a.happened_at, a.id;

-- security definer：通路 API（service role）、員工入口等身分更新訂單時也寫得進紀錄
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if new.status is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  begin
    v_label := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor';
  exception when others then
    v_label := null;
  end;
  insert into public.order_status_history (order_id, old_status, new_status, changed_by_user_id, actor_label)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    auth.uid(),
    v_label
  );
  return new;
end;
$$;

drop trigger if exists orders_log_status_change on public.orders;
create trigger orders_log_status_change
  after insert or update of status on public.orders
  for each row execute function public.log_order_status_change();
