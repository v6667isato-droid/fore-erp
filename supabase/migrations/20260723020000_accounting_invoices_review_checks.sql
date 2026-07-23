-- 發票審核勾稽結果（QR ground truth vs OCR vs 表單、金額算式、字軌期別）
-- 存檔時寫入，追溯當時的勾稽通過／例外項目
alter table public.accounting_invoices
  add column if not exists review_checks jsonb;

comment on column public.accounting_invoices.review_checks is
  '審核存檔當下的勾稽結果：{checked_at, qr_verified, all_pass, checks:[{key,label,status,detail}]}';
