-- 展覽成本連結採購：採購品項可標記屬於哪一場展覽（在展覽效益頁連結），
-- 展覽成本＝連結的採購品項（未稅）＋手動輸入的其他成本（exhibition_costs）。
alter table public.purchases
  add column if not exists exhibition_id uuid references public.exhibitions(id) on delete set null;

comment on column public.purchases.exhibition_id is '此採購品項屬於哪一場展覽的成本；NULL＝非展覽支出';

create index if not exists idx_purchases_exhibition on public.purchases(exhibition_id) where exhibition_id is not null;
