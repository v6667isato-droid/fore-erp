-- 選用：股利自動抓取（證交所「除權除息計算結果表」TWT49U）
-- 需要 http 與 pg_cron extension（kids-finance 抓股價已在用）；沒有的專案略過即可，股利維持手動輸入。
--
-- invest_dividend_events 是公開市場資料（不分使用者）：每檔股票每個除權息日一列。
-- 「我的投資」依自己的持股比對出還沒登錄的股利，由使用者確認後才寫進 invest_dividends。

create table public.invest_dividend_events (
  symbol text not null,
  ex_date date not null,
  name text,
  rights_type text not null,
  value_per_share numeric(20, 8) not null,
  cash_per_share numeric(20, 8),
  source text not null default 'TWSE',
  fetched_at timestamptz not null default now(),
  primary key (symbol, ex_date)
);

comment on table public.invest_dividend_events is '上市股票／ETF 除權除息結果（證交所 TWT49U，每日排程抓取）';
comment on column public.invest_dividend_events.rights_type is '息／權／權息';
comment on column public.invest_dividend_events.value_per_share is '權值＋息值（每股）';
comment on column public.invest_dividend_events.cash_per_share is '每股現金股利：只除息時等於權值＋息值；含配股（權、權息）時無法拆分，留空由使用者手動輸入';

alter table public.invest_dividend_events enable row level security;
create policy invest_dividend_events_read on public.invest_dividend_events
  for select to authenticated using (true);
revoke all on public.invest_dividend_events from anon;
grant select on public.invest_dividend_events to authenticated;

-- 抓取期間內的除權息結果並 upsert，回傳寫入筆數。只給排程（postgres）執行，不開放 API 呼叫。
create or replace function public.invest_fetch_twse_dividends(
  p_start date default current_date - 30,
  p_end date default current_date
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_response public.http_response;
  v_error text;
  v_body jsonb;
  v_count integer := 0;
  v_url text := 'https://www.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&startDate='
    || to_char(p_start, 'YYYYMMDD') || '&endDate=' || to_char(p_end, 'YYYYMMDD');
begin
  perform public.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');
  perform public.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');

  for v_attempt in 1..3 loop
    v_response := null;
    begin
      select * into v_response from public.http_get(v_url);
      exit when v_response.status = 200;
      v_error := 'status=' || v_response.status;
    exception when others then
      v_error := sqlerrm;
    end;
    if v_attempt < 3 then
      perform pg_sleep(10);
    end if;
  end loop;

  if v_response.status is distinct from 200 then
    raise exception 'TWSE 除權息 API 回應異常（已重試 3 次）：%', v_error;
  end if;

  v_body := v_response.content::jsonb;
  -- 期間內沒有除權息時 stat 不是 OK（「很抱歉，沒有符合條件的資料!」）
  if v_body->>'stat' is distinct from 'OK' or jsonb_typeof(v_body->'data') is distinct from 'array' then
    return 0;
  end if;

  -- data 每列：[資料日期(民國 114年01月17日), 股票代號, 股票名稱, 除權息前收盤價, 除權息參考價, 權值+息值, 權/息, ...]
  insert into public.invest_dividend_events (symbol, ex_date, name, rights_type, value_per_share, cash_per_share)
  select distinct on (symbol, ex_date)
    symbol,
    ex_date,
    name,
    rights_type,
    value_text::numeric,
    case when rights_type = '息' then value_text::numeric end
  from (
    select
      trim(item->>1) as symbol,
      make_date(m[1]::int + 1911, m[2]::int, m[3]::int) as ex_date,
      nullif(trim(item->>2), '') as name,
      trim(item->>6) as rights_type,
      value_text
    from (
      select
        item,
        regexp_match(item->>0, '(\d+)年(\d+)月(\d+)日') as m,
        replace(item->>5, ',', '') as value_text
      from jsonb_array_elements(v_body->'data') as item
    ) raw
    where m is not null and value_text ~ '^[0-9]+(\.[0-9]+)?$'
  ) src
  where symbol <> ''
  order by symbol, ex_date
  on conflict (symbol, ex_date) do update set
    name = excluded.name,
    rights_type = excluded.rights_type,
    value_per_share = excluded.value_per_share,
    cash_per_share = excluded.cash_per_share,
    fetched_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.invest_fetch_twse_dividends(date, date) from public, anon, authenticated;

-- 每個交易日台灣時間 15:20 抓最近 30 天（除息當天結果已公布，30 天涵蓋排程偶爾失敗的日子）
select cron.schedule(
  'invest-fetch-twse-dividends',
  '20 7 * * 1-5',
  $cron$select public.invest_fetch_twse_dividends()$cron$
);

-- 第一次設定時補抓歷史資料（期間依自己最早的交易調整）：
-- select public.invest_fetch_twse_dividends('2024-01-01', current_date);
