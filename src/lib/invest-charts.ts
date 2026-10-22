/**
 * 圖表分頁的資料整理：總資產走勢、資產配置、股利收入、每年已實現損益。
 * 抽成純函式方便單元測試；金額一律換算台幣，美元依當天（沒有就往前找最近一天）的匯率。
 */
import {
  computePortfolio,
  toTwd,
  type PortfolioAction,
  type PortfolioTrade,
  type Position,
} from "@/lib/invest-portfolio";
import type { InvestCorporateAction, InvestDividend, InvestMarket } from "@/lib/invest-types";

/** 一檔的每日收盤價，日期遞增（invest_price_series；USDTWD 為 1 美元兌台幣） */
export type PriceSeries = { dates: string[]; closes: number[] };

export type ChartRange = "3m" | "6m" | "1y" | "all";

const RANGE_MONTHS: Record<Exclude<ChartRange, "all">, number> = { "3m": 3, "6m": 6, "1y": 12 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** date 當天或之前最近一筆收盤價；date 早於第一筆時回 null */
export function priceAsOf(series: PriceSeries | undefined, date: string): number | null {
  if (!series || series.dates.length === 0 || series.dates[0] > date) return null;
  let lo = 0;
  let hi = series.dates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series.dates[mid] <= date) lo = mid;
    else hi = mid - 1;
  }
  return series.closes[lo];
}

/** 美元換算台幣用的匯率：歷史匯率優先，沒有就用目前匯率 */
function usdTwdAsOf(usdTwd: PriceSeries | undefined, fallback: number | null | undefined, date: string) {
  return priceAsOf(usdTwd, date) ?? fallback ?? null;
}

function convert(amount: number, currency: string, rate: number | null): number | null {
  return toTwd(amount, currency, rate);
}

type SplitAction = Pick<InvestCorporateAction, "symbol" | "action_date" | "type" | "ratio">;
type Split = { date: string; ratio: number };

/** 代號 → 拆股紀錄（同一檔在多個帳戶各登錄一次時只算一次） */
function splitsBySymbol(actions: SplitAction[]): Map<string, Split[]> {
  const bySymbol = new Map<string, Map<string, number>>();
  for (const a of actions) {
    if (a.type !== "split" || !a.ratio || a.ratio <= 0) continue;
    const byDate = bySymbol.get(a.symbol) ?? new Map<string, number>();
    byDate.set(a.action_date, a.ratio);
    bySymbol.set(a.symbol, byDate);
  }
  return new Map([...bySymbol].map(([symbol, byDate]) => [symbol, [...byDate].map(([date, ratio]) => ({ date, ratio }))]));
}

/**
 * Yahoo 的歷史收盤價已依拆股調整（拆股前的價格已除以拆股比例），
 * 拆股前的持股是原始股數，所以要乘回 date 之後才生效的拆股比例。
 */
function splitFactor(splits: Split[] | undefined, date: string): number {
  let factor = 1;
  for (const s of splits ?? []) if (s.date > date) factor *= s.ratio;
  return factor;
}

export type ValuePoint = {
  date: string;
  /** 市值（台幣）；沒有歷史價格的持股以成本計 */
  marketValue: number;
  /** 持股成本（台幣；美元依當天匯率換算） */
  cost: number;
  /** 沒有歷史價格（以成本計）或無法換算台幣（不列入）的檔數 */
  unpriced: number;
};

/**
 * 每個交易日收盤後的總市值與持股成本。日期取交易過的代號有收盤價的日子（台股、美股交易日的聯集），
 * 從第一筆交易起到 today；某檔當天沒開盤就沿用前一個交易日的收盤價。
 */
export function buildValueSeries({
  trades,
  actions,
  splitActions = actions,
  prices,
  usdTwd,
  fallbackUsdTwd,
  today,
}: {
  trades: PortfolioTrade[];
  actions: PortfolioAction[];
  /** 換算拆股前價格用的拆股紀錄（篩選帳戶時仍傳全部帳戶的紀錄） */
  splitActions?: SplitAction[];
  prices: Map<string, PriceSeries>;
  usdTwd?: PriceSeries;
  fallbackUsdTwd?: number | null;
  today: string;
}): ValuePoint[] {
  if (trades.length === 0) return [];
  const start = trades.reduce((min, t) => (t.trade_date < min ? t.trade_date : min), trades[0].trade_date);
  const dateSet = new Set<string>();
  for (const symbol of new Set(trades.map((t) => t.symbol))) {
    for (const d of prices.get(symbol)?.dates ?? []) if (d >= start && d <= today) dateSet.add(d);
  }
  const dates = [...dateSet].sort();
  const splits = splitsBySymbol(splitActions);
  const eventDates = [...new Set([...trades.map((t) => t.trade_date), ...actions.map((a) => a.action_date)])].sort();

  const points: ValuePoint[] = [];
  let eventIndex = -1;
  let positions: Position[] = [];
  for (const date of dates) {
    // 只在當天有新交易／拆股時重算持股
    let advanced = false;
    while (eventIndex + 1 < eventDates.length && eventDates[eventIndex + 1] <= date) {
      eventIndex++;
      advanced = true;
    }
    if (advanced) {
      const cutoff = eventDates[eventIndex];
      positions = computePortfolio(
        trades.filter((t) => t.trade_date <= cutoff),
        actions.filter((a) => a.action_date <= cutoff)
      ).positions.filter((p) => p.quantity > 0);
    }

    const fx = usdTwdAsOf(usdTwd, fallbackUsdTwd, date);
    let marketValue = 0;
    let cost = 0;
    let unpriced = 0;
    for (const p of positions) {
      const costTwd = convert(p.cost, p.currency, fx);
      if (costTwd == null) {
        unpriced++;
        continue;
      }
      cost += costTwd;
      const close = priceAsOf(prices.get(p.symbol), date);
      if (close == null) {
        marketValue += costTwd;
        unpriced++;
      } else {
        marketValue += convert(p.quantity * close * splitFactor(splits.get(p.symbol), date), p.currency, fx) ?? 0;
      }
    }
    points.push({ date, marketValue: round2(marketValue), cost: round2(cost), unpriced });
  }
  return points;
}

/** 期間起日（含）；全部回 null */
export function rangeStart(range: ChartRange, today: string): string | null {
  if (range === "all") return null;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - RANGE_MONTHS[range], d)).toISOString().slice(0, 10);
}

/** 月份圖的起始月份（YYYY-MM）：含本月共 3／6／12 個月；全部＝firstMonth，也不早於 firstMonth */
export function rangeMonthFrom(range: ChartRange, today: string, firstMonth: string): string {
  if (range === "all") return firstMonth;
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - RANGE_MONTHS[range], 1));
  const from = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return from > firstMonth ? from : firstMonth;
}

/** from～to（YYYY-MM，含頭尾）的每個月份 */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/** 每個月最後一個交易日的資料點（表格檢視用） */
export function monthEnds(points: ValuePoint[]): ValuePoint[] {
  const out: ValuePoint[] = [];
  for (const p of points) {
    if (out.length > 0 && out[out.length - 1].date.slice(0, 7) === p.date.slice(0, 7)) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

export type TimeTick = { index: number; label: string };

/**
 * 時間軸刻度：放在每月第一個交易日，依可放的數量每 1／2／3／6／12 個月一格（對齊季、半年、年）。
 * 期間不到一個月時標頭尾日期。
 */
export function timeTicks(dates: string[], maxTicks: number, shortYear = false): TimeTick[] {
  if (dates.length === 0) return [];
  const monthStarts: { index: number; year: number; month: number }[] = [];
  dates.forEach((d, i) => {
    if (i > 0 && dates[i - 1].slice(0, 7) === d.slice(0, 7)) return;
    // 第一個點只有剛好是月初才算月份刻度，避免期間從月中開始時標錯
    if (i === 0 && Number(d.slice(8, 10)) > 7) return;
    monthStarts.push({ index: i, year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
  });
  const label = (year: number, month: number, step: number) =>
    step >= 12 ? String(year) : `${shortYear ? String(year).slice(2) : year}/${String(month).padStart(2, "0")}`;
  for (const step of [1, 2, 3, 6, 12, 24]) {
    const picked = monthStarts.filter((s) => (s.month - 1) % Math.min(step, 12) === 0 && (step < 24 || s.year % 2 === 0));
    if (picked.length <= Math.max(maxTicks, 1) && picked.length >= 2) {
      return picked.map((s) => ({ index: s.index, label: label(s.year, s.month, step) }));
    }
    if (picked.length < 2) break;
  }
  const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
  return dates.length === 1
    ? [{ index: 0, label: md(dates[0]) }]
    : [
        { index: 0, label: md(dates[0]) },
        { index: dates.length - 1, label: md(dates[dates.length - 1]) },
      ];
}

type DividendRow = Pick<InvestDividend, "account_id" | "ex_date" | "currency" | "net_amount" | "received_at">;

export type DividendBucket = {
  /** YYYY-MM 或 YYYY */
  key: string;
  tw: number;
  us: number;
};

/**
 * 已入帳股利（實收）依除息月份或年度加總，台股、美股分開；美元依除息日匯率換算台幣。
 * from～to 之間沒有股利的月份／年度補 0，圖表才看得出空白期。
 */
export function dividendBuckets({
  dividends,
  marketByAccount,
  usdTwd,
  fallbackUsdTwd,
  granularity,
  from,
  to,
}: {
  dividends: DividendRow[];
  marketByAccount: Map<string, InvestMarket>;
  usdTwd?: PriceSeries;
  fallbackUsdTwd?: number | null;
  granularity: "month" | "year";
  /** YYYY-MM */
  from: string;
  /** YYYY-MM */
  to: string;
}): DividendBucket[] {
  const keys =
    granularity === "month"
      ? monthRange(from, to)
      : Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 }, (_, i) =>
          String(Number(from.slice(0, 4)) + i)
        );
  const buckets = new Map(keys.map((key) => [key, { key, tw: 0, us: 0 }]));
  for (const d of dividends) {
    if (!d.received_at) continue;
    const bucket = buckets.get(granularity === "month" ? d.ex_date.slice(0, 7) : d.ex_date.slice(0, 4));
    if (!bucket) continue;
    const twd = convert(d.net_amount, d.currency, usdTwdAsOf(usdTwd, fallbackUsdTwd, d.ex_date));
    if (twd == null) continue;
    const market = marketByAccount.get(d.account_id) ?? (d.currency === "TWD" ? "TW" : "US");
    if (market === "TW") bucket.tw += twd;
    else bucket.us += twd;
  }
  return [...buckets.values()].map((b) => ({ key: b.key, tw: round2(b.tw), us: round2(b.us) }));
}

/** 每年已實現損益（台幣；美元依賣出日匯率換算） */
export function realizedByYear({
  trades,
  realizedByTradeId,
  usdTwd,
  fallbackUsdTwd,
}: {
  trades: Pick<PortfolioTrade, "id" | "trade_date" | "currency">[];
  realizedByTradeId: Map<string, number>;
  usdTwd?: PriceSeries;
  fallbackUsdTwd?: number | null;
}): Map<string, number> {
  const byYear = new Map<string, number>();
  for (const t of trades) {
    const realized = realizedByTradeId.get(t.id);
    if (realized === undefined) continue;
    const twd = convert(realized, t.currency, usdTwdAsOf(usdTwd, fallbackUsdTwd, t.trade_date));
    if (twd == null) continue;
    const year = t.trade_date.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + twd);
  }
  return new Map([...byYear].sort(([a], [b]) => (a < b ? -1 : 1)).map(([y, v]) => [y, round2(v)]));
}

export type YearSummary = {
  year: string;
  dividendsTw: number;
  dividendsUs: number;
  realized: number;
  total: number;
};

/** 年度彙總：股利（台股、美股）＋已實現損益；只列有資料的年度 */
export function yearlySummary(
  dividendYears: DividendBucket[],
  realized: Map<string, number>
): { rows: YearSummary[]; total: YearSummary } {
  const years = new Set<string>([...realized.keys()]);
  for (const b of dividendYears) if (b.tw !== 0 || b.us !== 0) years.add(b.key);
  const dividendByYear = new Map(dividendYears.map((b) => [b.key, b]));
  const rows = [...years].sort().map((year): YearSummary => {
    const d = dividendByYear.get(year);
    const dividendsTw = d?.tw ?? 0;
    const dividendsUs = d?.us ?? 0;
    const r = realized.get(year) ?? 0;
    return { year, dividendsTw, dividendsUs, realized: r, total: round2(dividendsTw + dividendsUs + r) };
  });
  const sum = (pick: (r: YearSummary) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  return {
    rows,
    total: {
      year: "合計",
      dividendsTw: sum((r) => r.dividendsTw),
      dividendsUs: sum((r) => r.dividendsUs),
      realized: sum((r) => r.realized),
      total: sum((r) => r.total),
    },
  };
}

export type AllocationItem = {
  symbol: string;
  name: string | null;
  market: InvestMarket;
  value: number;
  share: number;
};

export type Allocation = {
  total: number;
  byMarket: { market: InvestMarket; value: number; share: number }[];
  /** 市值由大到小的前幾名 */
  items: AllocationItem[];
  /** 前幾名以外合併 */
  others: { symbols: string[]; value: number; share: number } | null;
  /** 沒有現價或無法換算台幣、未列入的檔數 */
  unpriced: number;
};

/** 目前資產配置（台幣市值）：依市場與個股；同一檔在多個帳戶合併計算 */
export function buildAllocation({
  positions,
  priceBySymbol,
  marketByAccount,
  usdTwd,
  top = 9,
}: {
  positions: Pick<Position, "accountId" | "symbol" | "name" | "currency" | "quantity">[];
  priceBySymbol: Map<string, number>;
  marketByAccount: Map<string, InvestMarket>;
  usdTwd: number | null | undefined;
  top?: number;
}): Allocation {
  const bySymbol = new Map<string, { symbol: string; name: string | null; market: InvestMarket; value: number }>();
  let unpriced = 0;
  for (const p of positions) {
    if (p.quantity <= 0) continue;
    const price = priceBySymbol.get(p.symbol);
    const value = price == null ? null : toTwd(p.quantity * price, p.currency, usdTwd);
    if (value == null) {
      unpriced++;
      continue;
    }
    const market = marketByAccount.get(p.accountId) ?? (p.currency === "TWD" ? "TW" : "US");
    const key = `${market}|${p.symbol}`;
    const item = bySymbol.get(key) ?? { symbol: p.symbol, name: p.name, market, value: 0 };
    item.value += value;
    item.name ??= p.name;
    bySymbol.set(key, item);
  }
  const all = [...bySymbol.values()].sort((a, b) => b.value - a.value);
  const total = all.reduce((s, i) => s + i.value, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  const byMarket = (["TW", "US"] as const)
    .map((market) => {
      const value = all.filter((i) => i.market === market).reduce((s, i) => s + i.value, 0);
      return { market, value: round2(value), share: share(value) };
    })
    .filter((m) => m.value > 0);
  // 剩一檔時直接列出，不必合併成「其他 1 檔」
  const shownCount = all.length <= top + 1 ? all.length : top;
  const rest = all.slice(shownCount);
  const restValue = rest.reduce((s, i) => s + i.value, 0);
  return {
    total: round2(total),
    byMarket,
    items: all.slice(0, shownCount).map((i) => ({ ...i, value: round2(i.value), share: share(i.value) })),
    others: rest.length > 0 ? { symbols: rest.map((i) => i.symbol), value: round2(restValue), share: share(restValue) } : null,
    unpriced,
  };
}

/** 1、2、2.5、5 × 10ⁿ 的刻度間距 */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/** 涵蓋 min～max 的整齊刻度（一定包含 0） */
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi - lo <= 0) return { min: 0, max: 1, ticks: [0, 1] };
  const step = niceStep((hi - lo) / count);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: niceMin, max: niceMax, ticks };
}

/** 台幣金額縮寫（座標軸、圖上標籤）：12,345,678 → 1,234.6萬；1 億以上用「億」 */
export function formatTwdShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}萬`;
  return `${sign}${Math.round(abs).toLocaleString("zh-TW")}`;
}
