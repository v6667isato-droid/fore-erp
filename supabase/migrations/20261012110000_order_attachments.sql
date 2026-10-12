-- 訂單履歷：附件（第一階段只有「完工照片」，依品項上傳，辦公室整理後上傳）。
-- 檔案放 private bucket order-records，前端以 signed URL 顯示：照片可能拍到客戶住家，不用公開網址。
-- 之後的階段（圖面確認、出貨簽收…）沿用這張表，擴充 category 即可。

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- 品項被移出訂單時保留照片（改掛整張訂單），不連帶刪除
  order_item_id uuid references public.order_items (id) on delete set null,
  category text not null default 'completion' check (category in ('completion')),
  storage_path text not null,
  -- 縮圖（列表／時間軸顯示用，省流量）
  thumb_path text,
  file_name text,
  caption text,
  -- 拍攝／完工日期：時間軸依此排序；上傳時預設照片 EXIF 拍攝日，沒有則為上傳當天
  taken_on date,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists order_attachments_order_idx
  on public.order_attachments (order_id) where deleted_at is null;
create index if not exists order_attachments_item_idx
  on public.order_attachments (order_item_id) where deleted_at is null;

comment on table public.order_attachments is '訂單履歷附件（完工照片等）；檔案在 private bucket order-records，刪除為軟刪除（deleted_at）';

alter table public.order_attachments enable row level security;

drop policy if exists order_attachments_authenticated_all on public.order_attachments;
create policy order_attachments_authenticated_all on public.order_attachments
  for all to authenticated using (true) with check (true);

drop trigger if exists audit_order_attachments on public.order_attachments;
create trigger audit_order_attachments
  after insert or delete or update on public.order_attachments
  for each row execute function public.log_audit();

-- Storage：private bucket，路徑約定 <order_id>/<order_item_id 或 order>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-records', 'order-records', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists order_records_select_authenticated on storage.objects;
create policy order_records_select_authenticated
  on storage.objects for select to authenticated
  using (bucket_id = 'order-records');

drop policy if exists order_records_insert_authenticated on storage.objects;
create policy order_records_insert_authenticated
  on storage.objects for insert to authenticated
  with check (bucket_id = 'order-records');

-- 上傳到一半失敗時清掉已上傳的原圖／縮圖
drop policy if exists order_records_delete_authenticated on storage.objects;
create policy order_records_delete_authenticated
  on storage.objects for delete to authenticated
  using (bucket_id = 'order-records');
