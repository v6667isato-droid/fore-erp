-- 採購明細：規格2 獨立欄位（與 proc. 規格拆分顯示或搜尋）
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS spec2 text;

COMMENT ON COLUMN public.purchases.spec2 IS '規格2；與主檔一致時與 purchases.spec（合併字串）併存';
