-- 已發放薪資單新增「結算後剩餘特休」快照欄位
alter table public.payslips
  add column if not exists special_leave_remaining_after numeric;

comment on column public.payslips.special_leave_remaining_after is
  '該月薪資結算（發放）當下扣除本月特休後的剩餘特休天數快照';

-- 回填歷史已發放紀錄：
-- 假設特休餘額僅由結算流程異動，則
-- 某張薪資單結算後餘額 = 員工目前餘額 + 其後（較新）各張薪資單結算的特休天數合計
with paid as (
  select
    p.id,
    p.employee_id,
    coalesce(p.special_leave_days_settled, 0) as settled,
    coalesce(p.created_at, '-infinity'::timestamptz) as ts
  from public.payslips p
  where lower(trim(coalesce(p.status, ''))) in ('paid', '已發放', '發放')
),
calc as (
  select
    paid.id,
    coalesce(e.annual_leave_remaining, 0)
      + coalesce(
          sum(paid.settled) over (
            partition by paid.employee_id
            order by paid.ts desc, paid.id desc
            rows between unbounded preceding and 1 preceding
          ),
          0
        ) as remaining_after
  from paid
  join public.employees e on e.id = paid.employee_id
)
update public.payslips p
set special_leave_remaining_after = c.remaining_after
from calc c
where p.id = c.id
  and p.special_leave_remaining_after is null;
