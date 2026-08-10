-- 系列×選項值關聯加「代碼不含此段」開關：單一尺寸系列生成代碼可省略尺寸段
alter table public.product_options
  add column if not exists omit_from_code boolean not null default false;

comment on column public.product_options.omit_from_code is '勾選生成時代碼不含此選項值的代碼段（單一尺寸系列用；尺寸仍寫入規格寬深高）';
