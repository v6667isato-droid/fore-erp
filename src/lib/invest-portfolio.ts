/**
 * 從買賣流水＋拆股／配股重算持股（平均成本法，與台灣券商庫存算法一致）。
 * 抽成純函式方便單元測試；資料量是個人規模（數百～數千筆），全部在前端算。
 */
import type { InvestCorporateAction, InvestTrade } from "@/lib/invest-types";

export type Position = {
  accountId: string;
  symbol: string;
  name: string | null;
  currency: string;
  quantity: number;
  /** 剩餘持股的總成本（含買進手續費） */
  cost: number;
  /** 平均成本；沒有持股時為 null */
  avgCost: number | null;
  /** 累計已實現損益（賣出應收 − 賣出部分的平均成本） */
  realizedPnl: number;
};

/** 賣出股數超過當時持股：通常是漏記拆股、配股，或匯入的對帳單起始日之前就有持股 */
export type PortfolioWarning = {
  accountId: string;
  symbol: string;
  date: string;
  shortBy: number;
};

export type PortfolioResult = {
  positions: Position[];
  /** 賣出交易 id → 該筆已實現損益 */
  realizedByTradeId: Map<string, number>;
  warnings: PortfolioWarning[];
};

type PortfolioTrade = Pick<
  InvestTrade,
  "id" | "account_id" | "trade_date" | "symbol" | "name" | "side" | "quantity" | "net_amount" | "currency"
>;
type PortfolioAction = Pick<
  InvestCorporateAction,
  "account_id" | "symbol" | "action_date" | "type" | "ratio" | "quantity"
>;

type Event =
  | { kind: "trade"; date: string; rank: number; seq: number; trade: PortfolioTrade }
  | { kind: "action"; date: string; rank: number; seq: number; action: PortfolioAction };

/** 浮點運算殘差（如 0.1 + 0.2）視為 0 的門檻 */
const EPSILON = 1e-9;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function positionKey(accountId: string, symbol: string): string {
  return `${accountId}|${symbol}`;
}

/**
 * 依日期重播事件。同一天的順序：拆股／配股（當天開盤前生效）→ 買進 → 賣出，
 * 避免當沖或同日先賣後買被誤判為持股不足；同類事件維持輸入順序。
 */
function buildEvents(trades: PortfolioTrade[], actions: PortfolioAction[]): Event[] {
  const events: Event[] = [
    ...actions.map((action, seq): Event => ({ kind: "action", date: action.action_date, rank: 0, seq, action })),
    ...trades.map((trade, seq): Event => ({
      kind: "trade",
      date: trade.trade_date,
      rank: trade.side === "buy" ? 1 : 2,
      seq,
      trade,
    })),
  ];
  events.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.rank !== b.rank ? a.rank - b.rank : a.seq - b.seq
  );
  return events;
}

export function computePortfolio(trades: PortfolioTrade[], actions: PortfolioAction[]): PortfolioResult {
  const positions = new Map<string, Position>();
  const realizedByTradeId = new Map<string, number>();
  const warnings: PortfolioWarning[] = [];

  function get(accountId: string, symbol: string, currency = "TWD"): Position {
    const key = positionKey(accountId, symbol);
    let p = positions.get(key);
    if (!p) {
      p = { accountId, symbol, name: null, currency, quantity: 0, cost: 0, avgCost: null, realizedPnl: 0 };
      positions.set(key, p);
    }
    return p;
  }

  for (const e of buildEvents(trades, actions)) {
    if (e.kind === "action") {
      const a = e.action;
      const p = get(a.account_id, a.symbol);
      if (a.type === "split" && a.ratio && a.ratio > 0) {
        p.quantity *= a.ratio;
      } else if (a.type === "stock_dividend" && a.quantity) {
        p.quantity += a.quantity;
      }
    } else {
      const t = e.trade;
      const p = get(t.account_id, t.symbol, t.currency);
      if (t.name) p.name = t.name;
      p.currency = t.currency;
      if (t.side === "buy") {
        p.quantity += t.quantity;
        p.cost += t.net_amount;
      } else {
        const held = Math.max(p.quantity, 0);
        if (t.quantity > held + EPSILON) {
          warnings.push({ accountId: t.account_id, symbol: t.symbol, date: t.trade_date, shortBy: round4(t.quantity - held) });
        }
        const avg = held > EPSILON ? p.cost / held : 0;
        const costOut = avg * Math.min(t.quantity, held);
        const realized = round4(t.net_amount - costOut);
        realizedByTradeId.set(t.id, realized);
        p.realizedPnl += realized;
        p.quantity -= t.quantity;
        p.cost -= costOut;
      }
      if (Math.abs(p.quantity) < EPSILON) p.quantity = 0;
      if (p.quantity <= 0) p.cost = 0;
    }
  }

  const result = [...positions.values()].map((p) => ({
    ...p,
    quantity: round4(p.quantity),
    cost: round4(p.cost),
    realizedPnl: round4(p.realizedPnl),
    avgCost: p.quantity > EPSILON ? p.cost / p.quantity : null,
  }));
  result.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return { positions: result, realizedByTradeId, warnings };
}

/**
 * 除息日前一天收盤後的持股：只計入日期早於 exDate 的交易與拆股／配股
 * （台股除息日前一天以前買進才有配息）。
 */
export function holdingBefore(
  trades: PortfolioTrade[],
  actions: PortfolioAction[],
  accountId: string,
  symbol: string,
  exDate: string
): number {
  const { positions } = computePortfolio(
    trades.filter((t) => t.account_id === accountId && t.symbol === symbol && t.trade_date < exDate),
    actions.filter((a) => a.account_id === accountId && a.symbol === symbol && a.action_date < exDate)
  );
  return Math.max(positions[0]?.quantity ?? 0, 0);
}

/** 依現價估算市值與未實現損益；沒有現價時回 null */
export function valuePosition(
  p: Pick<Position, "quantity" | "cost">,
  price: number | null | undefined
): { marketValue: number; unrealizedPnl: number; returnRate: number | null } | null {
  if (price == null || !(price >= 0)) return null;
  const marketValue = round4(p.quantity * price);
  const unrealizedPnl = round4(marketValue - p.cost);
  return { marketValue, unrealizedPnl, returnRate: p.cost > 0 ? unrealizedPnl / p.cost : null };
}
