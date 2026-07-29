-- 假單附件 bucket（private）。物件路徑約定：<auth.uid()>/<檔名>，
-- 讀取限本人（第一層資料夾＝自己的 auth uid）或 user_profiles.role 為 admin / manager 的審核者。
insert into storage.buckets (id, name, public)
values ('leave-attachments', 'leave-attachments', false)
on conflict (id) do nothing;

drop policy if exists leave_attachments_insert_own on storage.objects;
create policy leave_attachments_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists leave_attachments_read_own_or_admin on storage.objects;
create policy leave_attachments_read_own_or_admin
  on storage.objects for select to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.user_profiles up
        where up.user_id = auth.uid()
          and lower(coalesce(up.role, '')) in ('admin', 'manager')
      )
    )
  );
