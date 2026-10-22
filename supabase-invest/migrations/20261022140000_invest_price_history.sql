-- 選用：每日收盤價歷史（總資產走勢圖用；Yahoo Finance chart API）
-- 需要 http 與 pg_cron extension。
--
-- - invest_price_history：交易過的台股（代號.TW）、美股與 USD/TWD 匯率（symbol＝USDTWD）的每日收盤價
--   ⚠️ Yahoo 的收盤價已依拆股調整（例如 0050 一拆四前的價格會除以 4），但台股常沒有提供拆股事件；
--   前端依自己登錄的拆股紀錄換算（拆股前市值＝原始股數 × 調整後價格 × 拆股比例），資料庫存原始資料
-- - invest_price_series：每檔一列、日期與收盤價各一個陣列，前端一次請求就能拿到全部歷史

create table public.invest_price_history (
  symbol text not null,
  trade_date date not null,
  close numeric(20, 6) not null,
  primary key (symbol, trade_date)
);

comment on table public.invest_price_history is '每日收盤價歷史（Yahoo Finance，已依拆股調整；USDTWD 為 1 美元兌台幣）';

alter table public.invest_price_history enable row level security;
create policy invest_price_history_read on public.invest_price_history
  for select to authenticated using (true);
revoke all on public.invest_price_history from anon, authenticated;
grant select on public.invest_price_history to authenticated;

create view public.invest_price_series
with (security_invoker = true)
as
select
  symbol,
  array_agg(trade_date order by trade_date) as dates,
  array_agg(close order by trade_date) as closes
from public.invest_price_history
group by symbol;

comment on view public.invest_price_series is '每檔收盤價歷史（dates、closes 兩個陣列，順序對應）';

revoke all on public.invest_price_series from anon, authenticated;
grant select on public.invest_price_series to authenticated;

-- 抓 p_from 起的每日收盤價（交易過的所有代號＋USD/TWD），回傳成功的代號數；單一代號失敗不影響其他代號。
create or replace function public.invest_fetch_price_history(p_from date default current_date - 10)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_target record;
  v_yahoo text;
  v_response public.http_response;
  v_result jsonb;
  v_count integer := 0;
  v_failed text[] := '{}';
  v_period text := 'period1=' || extract(epoch from p_from::timestamptz)::bigint
    || '&period2=' || (extract(epoch from now())::bigint + 86400) || '&interval=1d';
begin
  perform public.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');
  perform public.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');

  for v_target in
    select distinct t.symbol, a.market
    from public.invest_trades t
    join public.invest_accounts a on a.id = t.account_id
    union all
    select 'USDTWD', 'FX'
    order by 1
  loop
    begin
      v_result := null;
      -- 台股先試上市（.TW），抓不到再試上櫃（.TWO）
      foreach v_yahoo in array case
        when v_target.market = 'TW' then array[v_target.symbol || '.TW', v_target.symbol || '.TWO']
        when v_target.market = 'FX' then array['TWD=X']
        else array[v_target.symbol]
      end loop
        select * into v_response from public.http((
          'GET',
          'https://query1.finance.yahoo.com/v8/finance/chart/' || v_yahoo || '?' || v_period,
          array[public.http_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')],
          null,
          null
        )::public.http_request);
        if v_response.status = 200 then
          v_result := v_response.content::jsonb #> '{chart,result,0}';
          exit when jsonb_array_length(coalesce(v_result->'timestamp', '[]'::jsonb)) > 0;
        end if;
        v_result := null;
      end loop;

      if v_result is null then
        v_failed := v_failed || (v_target.symbol || ': no data');
        continue;
      end if;

      insert into public.invest_price_history (symbol, trade_date, close)
      select distinct on (trade_date) v_target.symbol, trade_date, close
      from (
        select
          (to_timestamp(t.ts::text::bigint) at time zone coalesce(v_result #>> '{meta,exchangeTimezoneName}', 'UTC'))::date as trade_date,
          t.ts::text::bigint as ts,
          c.close::text::numeric as close
        from jsonb_array_elements(v_result->'timestamp') with ordinality as t(ts, i)
        join jsonb_array_elements(v_result #> '{indicators,quote,0,close}') with ordinality as c(close, j) on c.j = t.i
        where jsonb_typeof(c.close) = 'number'
      ) points
      order by trade_date, ts desc
      on conflict (symbol, trade_date) do update set close = excluded.close;

      v_count := v_count + 1;
    exception when others then
      v_failed := v_failed || (v_target.symbol || ': ' || sqlerrm);
    end;
    perform pg_sleep(1);
  end loop;

  if cardinality(v_failed) > 0 then
    raise warning 'invest_fetch_price_history 部分失敗：%', array_to_string(v_failed, '; ');
  end if;
  return v_count;
end;
$$;

revoke execute on function public.invest_fetch_price_history(date) from public, anon, authenticated;

-- 台灣早上 6:45（美股收盤後；台股前一天的收盤也已在 Yahoo）抓最近 10 天，補上排程偶爾失敗的日子
select cron.schedule(
  'invest-fetch-price-history',
  '45 22 * * 1-5',
  $cron$select public.invest_fetch_price_history()$cron$
);

-- 第一次設定時補抓歷史（從最早的交易日前開始）：
-- select public.invest_fetch_price_history('2024-04-01');
