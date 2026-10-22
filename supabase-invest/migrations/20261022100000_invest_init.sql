-- 個人投資資料庫（擁有者自己的 Supabase 專案，只給擁有者一人使用）
-- ⚠️ 不要套用到 fore-erp 公司資料庫；設定步驟見 supabase-invest/README.md
--
-- 設計：
-- - invest_trades（買賣流水）是唯一真實來源，持股、平均成本、已實現損益都由前端從流水計算
-- - 對帳單上沒有的事件另外記：invest_corporate_actions（拆股／配股）、invest_dividends（現金股利）
-- - 每張表都有 owner_id，RLS 只允許 owner_id = 登入者本人
-- - 所有物件都以 invest_ 開頭，可以放在既有的個人專案裡，不會和其他表撞名

create or replace function public.invest_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 帳戶：台股券商、複委託／海外券商
create table public.invest_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  market text not null default 'TW' check (market in ('TW', 'US')),
  currency text not null default 'TWD',
  note text,
  created_at timestamptz not null default now()
);

comment on table public.invest_accounts is '投資帳戶（券商）';
comment on column public.invest_accounts.market is 'TW：台股；US：美股';

create index invest_accounts_owner_idx on public.invest_accounts (owner_id);

-- 買賣流水
create table public.invest_trades (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.invest_accounts (id) on delete restrict,
  trade_date date not null,
  symbol text not null,
  name text,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(20, 6) not null check (quantity > 0),
  price numeric(20, 6) not null check (price >= 0),
  amount numeric(20, 4) not null,
  fee numeric(20, 4) not null default 0,
  tax numeric(20, 4) not null default 0,
  net_amount numeric(20, 4) not null,
  currency text not null default 'TWD',
  order_no text,
  dedupe_key text,
  source text not null default 'manual' check (source in ('import', 'manual')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- dedupe_key 為 null（手動新增）時不互相衝突
  constraint invest_trades_dedupe_unique unique (owner_id, account_id, dedupe_key)
);

comment on table public.invest_trades is '買賣流水（對帳單匯入或手動新增）';
comment on column public.invest_trades.amount is '價金＝成交價 × 數量';
comment on column public.invest_trades.net_amount is '買進：應付金額（價金＋手續費）；賣出：應收金額（價金－手續費－交易稅）';
comment on column public.invest_trades.order_no is '委託單號';
comment on column public.invest_trades.dedupe_key is '匯入防重複：成交日|委託單號|代號|買賣|數量|成交價';

create index invest_trades_owner_symbol_date_idx on public.invest_trades (owner_id, symbol, trade_date);
create index invest_trades_account_idx on public.invest_trades (account_id);

create trigger invest_trades_set_updated_at
  before update on public.invest_trades
  for each row execute function public.invest_set_updated_at();

-- 拆股／配股：對帳單上沒有，但會改變股數
create table public.invest_corporate_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.invest_accounts (id) on delete restrict,
  symbol text not null,
  action_date date not null,
  type text not null check (type in ('split', 'stock_dividend')),
  ratio numeric(20, 8) check (ratio > 0),
  quantity numeric(20, 6) check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  constraint invest_corporate_actions_type_fields check (
    (type = 'split' and ratio is not null)
    or (type = 'stock_dividend' and quantity is not null)
  )
);

comment on table public.invest_corporate_actions is '拆股（含反分割、無退款減資）與股票股利';
comment on column public.invest_corporate_actions.action_date is '生效日：拆股為恢復交易日，配股為除權交易日；當天起的交易以新股數計';
comment on column public.invest_corporate_actions.ratio is '拆股：1 股變成幾股（一拆四＝4，二合一＝0.5）';
comment on column public.invest_corporate_actions.quantity is '配股：實際配到的股數（成本 0，平均成本因此下降）';

create index invest_corporate_actions_owner_symbol_idx on public.invest_corporate_actions (owner_id, symbol, action_date);
create index invest_corporate_actions_account_idx on public.invest_corporate_actions (account_id);

-- 現金股利
create table public.invest_dividends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.invest_accounts (id) on delete restrict,
  symbol text not null,
  name text,
  ex_date date not null,
  pay_date date,
  cash_per_share numeric(20, 8) not null check (cash_per_share >= 0),
  shares numeric(20, 6) not null check (shares >= 0),
  gross_amount numeric(20, 4) not null check (gross_amount >= 0),
  nhi_premium numeric(20, 4) not null default 0,
  withholding_tax numeric(20, 4) not null default 0,
  fee numeric(20, 4) not null default 0,
  net_amount numeric(20, 4) generated always as (gross_amount - nhi_premium - withholding_tax - fee) stored,
  currency text not null default 'TWD',
  received_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invest_dividends_unique_event unique (owner_id, account_id, symbol, ex_date)
);

comment on table public.invest_dividends is '現金股利（買賣對帳單上沒有，手動登錄）';
comment on column public.invest_dividends.shares is '除息日前一天的持股數（系統依流水帶入，可修改）';
comment on column public.invest_dividends.gross_amount is '應收股利＝持股 × 每股配息';
comment on column public.invest_dividends.nhi_premium is '二代健保補充保費（台股單筆 2 萬以上扣 2.11%）';
comment on column public.invest_dividends.withholding_tax is '預扣稅（美股 30%）';
comment on column public.invest_dividends.fee is '匯費等其他扣款';
comment on column public.invest_dividends.received_at is '入帳日；null＝待入帳';

create index invest_dividends_account_idx on public.invest_dividends (account_id);

create trigger invest_dividends_set_updated_at
  before update on public.invest_dividends
  for each row execute function public.invest_set_updated_at();

-- 手動輸入的現價（算市值、未實現損益用）
create table public.invest_quotes (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  price numeric(20, 6) not null check (price >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, symbol)
);

comment on table public.invest_quotes is '手動輸入的現價';

create trigger invest_quotes_set_updated_at
  before update on public.invest_quotes
  for each row execute function public.invest_set_updated_at();

-- RLS：只允許本人讀寫自己的資料
alter table public.invest_accounts enable row level security;
alter table public.invest_trades enable row level security;
alter table public.invest_corporate_actions enable row level security;
alter table public.invest_dividends enable row level security;
alter table public.invest_quotes enable row level security;

create policy invest_accounts_owner_all on public.invest_accounts
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy invest_trades_owner_all on public.invest_trades
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy invest_corporate_actions_owner_all on public.invest_corporate_actions
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy invest_dividends_owner_all on public.invest_dividends
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy invest_quotes_owner_all on public.invest_quotes
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 明確授權（較新的 Supabase 專案不一定自動授權 public schema 新表）；anon 一律不給
revoke all on public.invest_accounts, public.invest_trades, public.invest_corporate_actions,
  public.invest_dividends, public.invest_quotes from anon;
grant select, insert, update, delete
  on public.invest_accounts, public.invest_trades, public.invest_corporate_actions,
    public.invest_dividends, public.invest_quotes
  to authenticated;
revoke execute on function public.invest_set_updated_at() from public, anon, authenticated;
