-- 選用：自動現價
-- 專案裡已經有每日抓證交所收盤價的 stock_prices 表（kids-finance 的 fetch_twse_prices 排程）時才執行；
-- 沒有這張表的專案略過即可，「我的投資」會退回只用手動現價。
--
-- 投資頁只讀這個 view（symbol, price, trade_date），不直接依賴 stock_prices 的欄位名稱；
-- security_invoker：沿用 stock_prices 本身的 RLS（登入者可讀）

-- DISTINCT ON 用和輸出欄位相同的運算式（stock_code::text），symbol 篩選條件才能推進子查詢、走 (stock_code, trade_date) 索引
create view public.invest_latest_prices
with (security_invoker = true)
as
select distinct on (stock_code::text)
  stock_code::text as symbol,
  close_price as price,
  trade_date
from public.stock_prices
where close_price is not null
order by stock_code::text, trade_date desc;

comment on view public.invest_latest_prices is '各股最近一個交易日的收盤價（來源 stock_prices，證交所每日收盤）';

revoke all on public.invest_latest_prices from anon, authenticated;
grant select on public.invest_latest_prices to authenticated;
