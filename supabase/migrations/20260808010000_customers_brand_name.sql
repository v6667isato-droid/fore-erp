-- 客戶新增「品牌名稱」欄位（品牌通常與公司登記名稱不同）
-- created_at 已存在且預設 now()，作為建立日期使用，這裡不再新增欄位。

alter table public.customers
  add column if not exists brand_name text;

comment on column public.customers.brand_name is '品牌名稱（對外招牌名，通常與公司登記抬頭不同）';
