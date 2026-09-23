-- 貼上建立：員工修正 AI 解析結果後，由 AI 濃縮成一句通用規則，之後每次解析帶入 prompt。
-- 只存規則（不存整段範例），修正當下學一次就好，省下每次解析的 AI 用量。
create table if not exists public.intake_learning_rules (
  id uuid primary key default gen_random_uuid(),
  rule text not null check (char_length(rule) between 1 and 300),
  source_kind text not null default 'order' check (source_kind in ('customer', 'order')),
  source_excerpt text,
  source_order_id uuid references public.orders (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.intake_learning_rules is '貼上建立：員工修正後 AI 學到的解析規則（解析時帶入 prompt）';
comment on column public.intake_learning_rules.rule is '一句話的通用規則，例如「『製作費用』是品項單價」';
comment on column public.intake_learning_rules.source_kind is '修正來源：customer＝客戶欄位、order＝訂單內容';
comment on column public.intake_learning_rules.source_excerpt is '原始訊息摘錄（管理畫面顯示用）';
comment on column public.intake_learning_rules.deleted_at is '軟刪除時間；NULL 表示使用中';

create index if not exists intake_learning_rules_active_idx
  on public.intake_learning_rules (created_at desc)
  where deleted_at is null;

alter table public.intake_learning_rules enable row level security;

-- 已登入使用者：解析時讀取規則、修正後新增規則
create policy "intake_rules_select_authenticated"
  on public.intake_learning_rules for select to authenticated using (true);

create policy "intake_rules_insert_authenticated"
  on public.intake_learning_rules for insert to authenticated with check (true);

-- 刪除（寫入 deleted_at）限管理員：規則影響所有人的解析結果
create policy "intake_rules_update_admin"
  on public.intake_learning_rules for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
       where p.user_id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_profiles p
       where p.user_id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  );
