/** 個人投資資料表的列型別（對應 supabase-invest/migrations） */

export type InvestMarket = "TW" | "US";

export type InvestAccount = {
  id: string;
  name: string;
  market: InvestMarket;
  currency: string;
  note: string | null;
};

export type TradeSide = "buy" | "sell";

export type InvestTrade = {
  id: string;
  account_id: string;
  trade_date: string;
  symbol: string;
  name: string | null;
  side: TradeSide;
  quantity: number;
  price: number;
  /** 價金＝成交價 × 數量 */
  amount: number;
  fee: number;
  tax: number;
  /** 買進：應付金額（價金＋手續費）；賣出：應收金額（價金－手續費－交易稅） */
  net_amount: number;
  currency: string;
  order_no: string | null;
  dedupe_key: string | null;
  source: "import" | "manual";
  note: string | null;
};

export type CorporateActionType = "split" | "stock_dividend";

export type InvestCorporateAction = {
  id: string;
  account_id: string;
  symbol: string;
  /** 生效日：當天起的交易以新股數計 */
  action_date: string;
  type: CorporateActionType;
  /** 拆股：1 股變成幾股 */
  ratio: number | null;
  /** 配股：配到的股數 */
  quantity: number | null;
  note: string | null;
};

export type InvestDividend = {
  id: string;
  account_id: string;
  symbol: string;
  name: string | null;
  ex_date: string;
  pay_date: string | null;
  cash_per_share: number;
  shares: number;
  gross_amount: number;
  nhi_premium: number;
  withholding_tax: number;
  fee: number;
  /** 資料庫產生欄位：gross − 補充保費 − 預扣稅 − 匯費 */
  net_amount: number;
  currency: string;
  /** null＝待入帳 */
  received_at: string | null;
  note: string | null;
};

export type InvestQuote = {
  symbol: string;
  price: number;
  updated_at: string;
};

export const CORPORATE_ACTION_LABELS: Record<CorporateActionType, string> = {
  split: "拆股",
  stock_dividend: "配股",
};

export const SIDE_LABELS: Record<TradeSide, string> = {
  buy: "買進",
  sell: "賣出",
};
