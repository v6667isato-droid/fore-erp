-- 訂單歷程：一次取回某張訂單及其品項／工單／退貨的 audit_logs
-- UPDATE 紀錄只存變動欄位（不含 order_id 等外鍵），因此先由 INSERT/DELETE 快照
-- 與現存資料列收集子表紀錄 ID，再以 (table_name, record_id) 撈全部紀錄。
-- security invoker：沿用 audit_logs 的 RLS（僅 admin 可讀）。

create index if not exists audit_logs_order_ref_idx
  on public.audit_logs ((coalesce(new_data ->> 'order_id', old_data ->> 'order_id')))
  where table_name in ('order_items', 'order_returns');

create index if not exists audit_logs_order_item_ref_idx
  on public.audit_logs ((coalesce(new_data ->> 'order_item_id', old_data ->> 'order_item_id')))
  where table_name = 'work_orders';

create index if not exists audit_logs_return_ref_idx
  on public.audit_logs ((coalesce(new_data ->> 'return_id', old_data ->> 'return_id')))
  where table_name = 'order_return_items';

create or replace function public.order_audit_trail(p_order_id uuid)
returns setof public.audit_logs
language sql
stable
security invoker
set search_path = public
as $$
  with item_ids as (
    select coalesce(a.new_data ->> 'id', a.old_data ->> 'id') as id
      from public.audit_logs a
     where a.table_name = 'order_items'
       and coalesce(a.new_data ->> 'order_id', a.old_data ->> 'order_id') = p_order_id::text
    union
    select oi.id::text from public.order_items oi where oi.order_id = p_order_id
  ),
  work_order_ids as (
    select coalesce(a.new_data ->> 'id', a.old_data ->> 'id') as id
      from public.audit_logs a
     where a.table_name = 'work_orders'
       and coalesce(a.new_data ->> 'order_item_id', a.old_data ->> 'order_item_id') in (select id from item_ids)
    union
    select w.id::text from public.work_orders w
     where w.order_item_id::text in (select id from item_ids)
  ),
  return_ids as (
    select coalesce(a.new_data ->> 'id', a.old_data ->> 'id') as id
      from public.audit_logs a
     where a.table_name = 'order_returns'
       and coalesce(a.new_data ->> 'order_id', a.old_data ->> 'order_id') = p_order_id::text
    union
    select r.id::text from public.order_returns r where r.order_id = p_order_id
  ),
  return_item_ids as (
    select coalesce(a.new_data ->> 'id', a.old_data ->> 'id') as id
      from public.audit_logs a
     where a.table_name = 'order_return_items'
       and coalesce(a.new_data ->> 'return_id', a.old_data ->> 'return_id') in (select id from return_ids)
    union
    select ri.id::text from public.order_return_items ri
     where ri.return_id::text in (select id from return_ids)
  )
  select a.*
    from public.audit_logs a
   where (a.table_name = 'orders' and a.record_id = p_order_id::text)
      or (a.table_name = 'order_items' and a.record_id in (select id from item_ids))
      or (a.table_name = 'work_orders' and a.record_id in (select id from work_order_ids))
      or (a.table_name = 'order_returns' and a.record_id in (select id from return_ids))
      or (a.table_name = 'order_return_items' and a.record_id in (select id from return_item_ids))
   order by a.happened_at, a.id;
$$;

comment on function public.order_audit_trail(uuid) is
  '訂單歷程：回傳訂單、品項、工單、退貨單、退貨品項的 audit_logs（依時間排序）；security invoker，受 audit_logs RLS 限制僅 admin 可讀';

revoke all on function public.order_audit_trail(uuid) from public, anon;
grant execute on function public.order_audit_trail(uuid) to authenticated;
