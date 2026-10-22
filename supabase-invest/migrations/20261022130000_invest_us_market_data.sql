-- 選用：美股現價、股利與美元匯率（Yahoo Finance chart API）
-- 需要 http 與 pg_cron extension，且已執行 20261022110000（invest_latest_prices）與 20261022120000（invest_dividend_events）。
--
-- - invest_market_quotes：美股收盤價與 USD/TWD 匯率（公開市場資料，不分使用者）
-- - invest_dividend_events 加上 market，美股股利也寫進同一張表
-- - invest_latest_prices view 合併台股（stock_prices）與美股（invest_market_quotes）

create table public.invest_market_quotes (
  symbol text primary key,
  name text,
  price numeric(20, 6) not null,
  currency text not null,
  trade_date date not null,
  kind text not null default 'stock' check (kind in ('stock', 'fx')),
  source text not null default 'Yahoo',
  fetched_at timestamptz not null default now()
);

comment on table public.invest_market_quotes is '美股最近收盤價與匯率（Yahoo Finance，每日排程抓取）；匯率 symbol 為 USDTWD（1 美元兌台幣）';

alter table public.invest_market_quotes enable row level security;
create policy invest_market_quotes_read on public.invest_market_quotes
  for select to authenticated using (true);
revoke all on public.invest_market_quotes from anon;
grant select on public.invest_market_quotes to authenticated;

alter table public.invest_dividend_events
  add column market text not null default 'TW' check (market in ('TW', 'US'));

comment on column public.invest_dividend_events.market is 'TW：證交所；US：Yahoo Finance';

-- 欄位型別沿用原本的 view（price numeric(10,2)），美股價格到分即可
create or replace view public.invest_latest_prices
with (security_invoker = true)
as
select * from (
  select distinct on (stock_code::text)
    stock_code::text as symbol,
    close_price as price,
    trade_date
  from public.stock_prices
  where close_price is not null
  order by stock_code::text, trade_date desc
) tw
union all
select symbol, price::numeric(10, 2), trade_date
from public.invest_market_quotes
where kind = 'stock';

-- 抓美股（預設＝美股帳戶交易過的代號）最新價與近 5 年股利，以及 USD/TWD 匯率；回傳成功筆數。
-- 單一代號失敗不影響其他代號（以 warning 記錄）。只給排程（postgres）執行。
create or replace function public.invest_fetch_us_market_data(p_symbols text[] default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_symbols text[];
  v_symbol text;
  v_response public.http_response;
  v_result jsonb;
  v_meta jsonb;
  v_name text;
  v_count integer := 0;
  v_failed text[] := '{}';
begin
  v_symbols := coalesce(p_symbols, array(
    select distinct t.symbol
    from public.invest_trades t
    join public.invest_accounts a on a.id = t.account_id
    where a.market = 'US'
    order by 1
  ));

  perform public.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');
  perform public.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');

  -- TWD=X 是 1 美元兌台幣，存成 USDTWD
  foreach v_symbol in array array_append(v_symbols, 'TWD=X') loop
    begin
      select * into v_response from public.http((
        'GET',
        'https://query1.finance.yahoo.com/v8/finance/chart/' || v_symbol || '?range=5y&interval=1mo&events=div',
        array[public.http_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')],
        null,
        null
      )::public.http_request);

      if v_response.status <> 200 then
        v_failed := v_failed || (v_symbol || ': status ' || v_response.status);
        continue;
      end if;

      v_result := v_response.content::jsonb #> '{chart,result,0}';
      v_meta := v_result->'meta';
      if v_meta->>'regularMarketPrice' is null or v_meta->>'regularMarketTime' is null then
        v_failed := v_failed || (v_symbol || ': no price');
        continue;
      end if;
      v_name := coalesce(v_meta->>'longName', v_meta->>'shortName');

      insert into public.invest_market_quotes (symbol, name, price, currency, trade_date, kind, source)
      values (
        case when v_symbol = 'TWD=X' then 'USDTWD' else v_symbol end,
        v_name,
        (v_meta->>'regularMarketPrice')::numeric,
        coalesce(v_meta->>'currency', 'USD'),
        (to_timestamp((v_meta->>'regularMarketTime')::bigint) at time zone 'America/New_York')::date,
        case when v_symbol = 'TWD=X' then 'fx' else 'stock' end,
        'Yahoo'
      )
      on conflict (symbol) do update set
        name = excluded.name,
        price = excluded.price,
        currency = excluded.currency,
        trade_date = excluded.trade_date,
        kind = excluded.kind,
        fetched_at = now();
      v_count := v_count + 1;

      -- 股利：date 是除息日（美東開盤時間的時間戳）
      if v_symbol <> 'TWD=X' and jsonb_typeof(v_result #> '{events,dividends}') = 'object' then
        insert into public.invest_dividend_events
          (symbol, ex_date, name, rights_type, value_per_share, cash_per_share, market, source)
        select
          v_symbol,
          (to_timestamp((d.value->>'date')::bigint) at time zone 'America/New_York')::date,
          v_name,
          '息',
          (d.value->>'amount')::numeric,
          (d.value->>'amount')::numeric,
          'US',
          'Yahoo'
        from jsonb_each(v_result #> '{events,dividends}') as d
        where d.value->>'amount' is not null and d.value->>'date' is not null
        on conflict (symbol, ex_date) do update set
          name = excluded.name,
          value_per_share = excluded.value_per_share,
          cash_per_share = excluded.cash_per_share,
          market = excluded.market,
          source = excluded.source,
          fetched_at = now();
      end if;
    exception when others then
      v_failed := v_failed || (v_symbol || ': ' || sqlerrm);
    end;
    perform pg_sleep(1);
  end loop;

  if cardinality(v_failed) > 0 then
    raise warning 'invest_fetch_us_market_data 部分失敗：%', array_to_string(v_failed, '; ');
  end if;
  return v_count;
end;
$$;

revoke execute on function public.invest_fetch_us_market_data(text[]) from public, anon, authenticated;

-- 美股收盤後（UTC 22:30＝台灣早上 6:30，夏令／冬令時間都已收盤）每個交易日抓一次
select cron.schedule(
  'invest-fetch-us-market-data',
  '30 22 * * 1-5',
  $cron$select public.invest_fetch_us_market_data()$cron$
);
