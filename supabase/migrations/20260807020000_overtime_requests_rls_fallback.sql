-- 修正加班申報 RLS：portal 對應員工有三段 fallback
-- （user_profiles.employee_id → employees.email = 登入信箱 → user_profiles.full_name = employees.name），
-- 原 policy 只認第一段，employee_id 未設定的帳號 insert 會撞 RLS。
-- 以 SECURITY DEFINER helper 完整複製 resolveEmployee 的對應邏輯。

create or replace function public.is_own_employee (p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and (
        exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and up.employee_id = e.id
        )
        or (
          coalesce(auth.jwt() ->> 'email', '') <> ''
          and lower(trim(coalesce(e.email::text, ''))) = lower(trim(auth.jwt() ->> 'email'))
        )
        or exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and nullif(trim(coalesce(up.full_name::text, '')), '') is not null
            and trim(up.full_name::text) = trim(e.name::text)
        )
      )
  );
$$;

revoke all on function public.is_own_employee (uuid) from public;

grant execute on function public.is_own_employee (uuid) to authenticated;

comment on function public.is_own_employee (uuid) is '目前登入者是否對應此員工（employee_id / email / full_name 三段 fallback，同 employee-portal resolveEmployee）';

drop policy if exists "overtime_requests_select_own" on public.overtime_requests;

create policy "overtime_requests_select_own" on public.overtime_requests for select to authenticated using (
  public.is_own_employee (employee_id)
);

drop policy if exists "overtime_requests_insert_own" on public.overtime_requests;

create policy "overtime_requests_insert_own" on public.overtime_requests for insert to authenticated with check (
  status = 'pending'
  and public.is_own_employee (employee_id)
);
