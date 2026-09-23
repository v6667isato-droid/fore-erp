-- 展覽效益改為依客戶來源與下單日推算（現場成交＝展期內、展後轉單＝展期後到下一屆前），
-- 訂單不再標記場次：移除 orders.exhibition_id（上線時無任何訂單使用）。
drop index if exists public.idx_orders_exhibition;
alter table public.orders drop column if exists exhibition_id;
