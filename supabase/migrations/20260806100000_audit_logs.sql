-- 操作稽核紀錄：audit_logs 表＋通用 log_audit() trigger
-- 由 DB trigger 記錄，不管寫入來自員工端（anon key＋auth session）、
-- portal／cron（service role）都會被記到；service role 寫入時 actor 取
-- request.headers 的 x-actor（各 API route 建 client 時帶入）。

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  table_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  actor_id uuid,
  actor_email text,
  actor_label text,
  changed_fields text[],
  old_data jsonb,
  new_data jsonb
);

comment on table public.audit_logs is
  '操作稽核紀錄：由 log_audit trigger 自動寫入；UPDATE 只存有變動的欄位（排除 updated_at），INSERT/DELETE 存整列快照；actor_label 為 service role 寫入時的來源標記（portal:… / cron:…）';

create index if not exists audit_logs_happened_at_idx on public.audit_logs (happened_at desc);
create index if not exists audit_logs_table_record_idx on public.audit_logs (table_name, record_id);

alter table public.audit_logs enable row level security;

-- 僅 admin 可讀；不開放任何前端寫入（trigger 以 security definer 寫入，不受 RLS 限制）
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_profiles p
      where p.user_id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
    )
  );

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_actor uuid;
  v_email text;
  v_label text;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  begin
    v_label := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor';
  exception when others then
    v_label := null;
  end;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(v_new) as n(key, value)
     where n.value is distinct from v_old -> n.key
       and n.key <> 'updated_at';
    -- 無實質變更（例如只更新 updated_at）不記
    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return new;
    end if;
    insert into public.audit_logs
      (table_name, action, record_id, actor_id, actor_email, actor_label, changed_fields, old_data, new_data)
    values (
      tg_table_name, tg_op,
      coalesce(v_new ->> 'id', v_new ->> 'key'),
      v_actor, v_email, v_label, v_changed,
      (select jsonb_object_agg(k, v_old -> k) from unnest(v_changed) as k),
      (select jsonb_object_agg(k, v_new -> k) from unnest(v_changed) as k)
    );
    return new;
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    insert into public.audit_logs
      (table_name, action, record_id, actor_id, actor_email, actor_label, new_data)
    values (
      tg_table_name, tg_op,
      coalesce(v_row ->> 'id', v_row ->> 'key'),
      v_actor, v_email, v_label, v_row
    );
    return new;
  else
    v_row := to_jsonb(old);
    insert into public.audit_logs
      (table_name, action, record_id, actor_id, actor_email, actor_label, old_data)
    values (
      tg_table_name, tg_op,
      coalesce(v_row ->> 'id', v_row ->> 'key'),
      v_actor, v_email, v_label, v_row
    );
    return old;
  end if;
end;
$$;

-- 掛 trigger 的業務表清單（不含 log 型／暫存型表，避免噪音與遞迴）
do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'order_returns', 'order_return_items',
    'work_orders', 'customers', 'channels',
    'product_series', 'product_variants',
    'product_variant_channel_prices', 'product_series_channel_discounts',
    'variant_channel_price_overrides', 'option_values', 'product_options',
    'purchase_orders', 'purchases', 'vendors', 'procurement_materials',
    'parts', 'part_variants', 'bom_lines', 'stock_movements',
    'sales_invoices', 'sales_invoice_items', 'sales_allowances',
    'accounting_invoices',
    'employees', 'payslips', 'leave_requests', 'overtime_records',
    'annual_leave_grants',
    'channel_statements', 'channel_statement_lines',
    'app_settings', 'company_settings'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.log_audit()',
      'audit_' || t, t
    );
  end loop;
end $$;
