-- 選用：台股收盤價歷史晚上 6:30 再抓一次（需已執行 20261022140000_invest_price_history.sql）
-- 原本每天早上 6:45 才抓（等美股收盤），晚上 6 點後持股頁已經是當天收盤價、走勢圖還停在前一天；
-- 晚上加抓一次台股，兩邊當晚就一致。早上那次照舊抓全部代號，順便補齊晚上沒抓到的。
--
-- - invest_fetch_price_history_for(p_from, p_markets)：可只抓指定市場（TW／US／FX＝USD/TWD 匯率），null＝全部
-- - invest_fetch_price_history(p_from) 改為呼叫上面的函式（抓全部），原本的排程不用改

create or replace function public.invest_fetch_price_history_for(p_from date, p_markets text[])
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
    select * from (
      select distinct t.symbol, a.market
      from public.invest_trades t
      join public.invest_accounts a on a.id = t.account_id
      union all
      select 'USDTWD', 'FX'
    ) targets
    where p_markets is null or targets.market = any(p_markets)
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

revoke execute on function public.invest_fetch_price_history_for(date, text[]) from public, anon, authenticated;

create or replace function public.invest_fetch_price_history(p_from date default current_date - 10)
returns integer
language sql
set search_path = ''
as $$
  select public.invest_fetch_price_history_for(p_from, null)
$$;

revoke execute on function public.invest_fetch_price_history(date) from public, anon, authenticated;

-- 台灣晚上 6:30（UTC 10:30，台股 13:30 收盤後 Yahoo 已有當天收盤價）只抓台股最近 3 天
select cron.schedule(
  'invest-fetch-tw-price-history',
  '30 10 * * 1-5',
  $cron$select public.invest_fetch_price_history_for(current_date - 3, array['TW'])$cron$
);
