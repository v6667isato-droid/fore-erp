/**
 * 券商買賣對帳單（Excel／CSV 讀成二維陣列後）解析成交易列。
 * 欄位依標題名稱對應（不依欄位順序），最上方的「合計」列與空白列自動略過。
 * 支援台股買賣對帳單與複委託對帳單（代號帶 .US、買賣別 B／S、日期 20250509、多種費用欄位）。
 */
import type { TradeSide } from "@/lib/invest-types";

export type ParsedTrade = {
  /** 對帳單上的列號（1 起算），錯誤訊息與預覽用 */
  row: number;
  trade_date: string;
  symbol: string;
  name: string | null;
  side: TradeSide;
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  net_amount: number;
  currency: string;
  order_no: string | null;
  dedupe_key: string;
};

export type StatementParseResult = {
  headerFound: boolean;
  trades: ParsedTrade[];
  errors: { row: number; message: string }[];
};

type Field =
  | "date"
  | "product"
  | "symbol"
  | "name"
  | "side"
  | "quantity"
  | "price"
  | "amount"
  | "fee"
  | "tax"
  | "payable"
  | "receivable"
  | "orderNo"
  | "currency"
  | "net"
  | "market"
  | "settlement";

const HEADER_ALIASES: Record<Field, string[]> = {
  date: ["成交日", "成交日期", "交易日", "交易日期"],
  product: ["商品", "商品名稱", "股票"],
  symbol: ["代號", "股票代號", "證券代號"],
  name: ["名稱", "股票名稱", "證券名稱"],
  side: ["買賣", "買賣別", "交易類別", "交易別"],
  quantity: ["數量", "成交股數", "股數", "成交數量", "成交量"],
  price: ["成交價", "成交價格", "成交單價", "成交均價"],
  amount: ["價金", "成交金額", "成交價金"],
  fee: ["手續費"],
  tax: ["交易稅", "證交稅"],
  payable: ["應付金額"],
  receivable: ["應收金額"],
  orderNo: ["委託單號", "委託書號", "委託編號"],
  currency: ["幣別", "計價幣別"],
  net: ["淨收付", "淨收付金額"],
  market: ["市場"],
  settlement: ["交割方式"],
};

/** 複委託對帳單手續費以外的費用欄位，全部併入手續費 */
const EXTRA_FEE_HEADERS = ["印花稅", "交所稅", "匯費", "管理費", "服務費", "交易徵費"];

/** 帶市場後綴的代號，如 VT.US（複委託對帳單） */
const SUFFIXED_TICKER = /^([A-Za-z0-9][A-Za-z0-9-]*)\.US$/i;

const SUMMARY_LABELS = new Set(["合計", "小計", "總計"]);

/** 標題正規化：去空白（含全形）與括號註記，如「成交價（元）」→「成交價」 */
function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/[\s　]/g, "");
}

function findHeader(
  rows: unknown[][]
): { index: number; columns: Partial<Record<Field, number>>; extraFeeColumns: number[] } | null {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map(normalizeHeader);
    const columns: Partial<Record<Field, number>> = {};
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      const idx = cells.findIndex((c) => HEADER_ALIASES[field].includes(c));
      if (idx !== -1) columns[field] = idx;
    }
    const hasProduct = columns.product !== undefined || columns.symbol !== undefined;
    if (
      columns.date !== undefined &&
      columns.side !== undefined &&
      columns.quantity !== undefined &&
      columns.price !== undefined &&
      hasProduct
    ) {
      const extraFeeColumns = cells.flatMap((c, idx) => (EXTRA_FEE_HEADERS.includes(c) ? [idx] : []));
      return { index: i, columns, extraFeeColumns };
    }
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 支援 2024/05/07、2024-05-07、民國 113/05/07、20240507、民國 1130507、Excel 日期儲存格（Date 或序號） */
export function parseStatementDate(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // Excel 日期沒有時區，讀取套件以 UTC 午夜表示
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const text = String(v ?? "").trim();
  const m =
    text.match(/^(\d{2,4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/) ?? text.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 1000) y += 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isValidYmd(y, mo, d)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 數字欄位：容許千分位、NT$、空白；空字串或「-」視為沒有值 */
function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "")
    .replace(/[,\s　$]/g, "")
    .replace(/^NT/i, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseSide(v: unknown): TradeSide | "margin" | null {
  const s = String(v ?? "").trim();
  if (/^(B|BUY)$/i.test(s)) return "buy";
  if (/^(S|SELL)$/i.test(s)) return "sell";
  if (/[資券]/.test(s)) return "margin";
  if (s.includes("買")) return "buy";
  if (s.includes("賣")) return "sell";
  return null;
}

/** 「0050 元大台灣50」→ 代號 0050、名稱 元大台灣50 */
function splitProduct(v: unknown): { symbol: string; name: string | null } | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^([0-9A-Za-z][0-9A-Za-z.\-]*)(?:[\s　]+(.*))?$/);
  if (!m) return null;
  return { symbol: m[1].toUpperCase(), name: m[2]?.trim() || null };
}

export function tradeDedupeKey(t: {
  trade_date: string;
  order_no: string | null;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
}): string {
  return [t.trade_date, t.order_no ?? "", t.symbol, t.side, t.quantity, t.price].join("|");
}

export function parseStatementRows(rows: unknown[][]): StatementParseResult {
  const header = findHeader(rows);
  if (!header) return { headerFound: false, trades: [], errors: [] };
  const { columns: col, extraFeeColumns } = header;
  const cell = (row: unknown[], f: Field): unknown => (col[f] === undefined ? undefined : row[col[f]!]);

  const trades: ParsedTrade[] = [];
  const errors: StatementParseResult["errors"] = [];
  /** 同一份對帳單裡完全相同的成交（同單號、同價、同量分批成交）加序號，避免被當成重複 */
  const seen = new Map<string, number>();

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNo = i + 1;
    if (row.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
    const dateCell = cell(row, "date");
    if (SUMMARY_LABELS.has(String(dateCell ?? "").trim())) continue;

    const trade_date = parseStatementDate(dateCell);
    if (!trade_date) {
      errors.push({ row: rowNo, message: `成交日無法辨識：${String(dateCell ?? "")}` });
      continue;
    }

    let product: { symbol: string; name: string | null } | null;
    // 複委託對帳單的標題會錯一欄：「市場」欄放代號（VT.US）、「商品」欄放英文名稱
    const marketText = String(cell(row, "market") ?? "").trim();
    const productText = String(cell(row, "product") ?? "").trim();
    const marketTicker = marketText.match(SUFFIXED_TICKER);
    const productTicker = productText.match(SUFFIXED_TICKER);
    if (marketTicker) {
      product = { symbol: marketTicker[1].toUpperCase(), name: productText || null };
    } else if (productTicker) {
      product = { symbol: productTicker[1].toUpperCase(), name: null };
    } else if (col.symbol !== undefined) {
      const symbol = String(cell(row, "symbol") ?? "").trim().toUpperCase();
      const name = String(cell(row, "name") ?? "").trim();
      product = symbol ? { symbol, name: name || null } : null;
    } else {
      product = splitProduct(cell(row, "product"));
    }
    if (!product) {
      errors.push({ row: rowNo, message: `商品代號無法辨識：${String(cell(row, "product") ?? "")}` });
      continue;
    }

    const side = parseSide(cell(row, "side"));
    if (side === "margin") {
      errors.push({ row: rowNo, message: `融資融券交易目前不支援：${String(cell(row, "side"))}` });
      continue;
    }
    if (!side) {
      errors.push({ row: rowNo, message: `買賣別無法辨識：${String(cell(row, "side") ?? "")}` });
      continue;
    }

    const quantity = parseAmount(cell(row, "quantity"));
    const price = parseAmount(cell(row, "price"));
    if (!quantity || quantity <= 0 || price === null || price < 0) {
      errors.push({ row: rowNo, message: "數量或成交價不正確" });
      continue;
    }

    const amount = parseAmount(cell(row, "amount")) ?? quantity * price;
    const feeTotal =
      (parseAmount(cell(row, "fee")) ?? 0) + extraFeeColumns.reduce((sum, idx) => sum + (parseAmount(row[idx]) ?? 0), 0);
    // 多個費用相加的浮點殘差（0.27 + 0.01）四捨五入到 4 位，與資料庫精度一致
    const fee = Math.round(feeTotal * 10000) / 10000;
    const tax = parseAmount(cell(row, "tax")) ?? 0;
    const payable = parseAmount(cell(row, "payable"));
    const receivable = parseAmount(cell(row, "receivable"));
    // 淨收付（複委託：買進為負數）；台幣交割時淨收付是台幣、與計價幣別不同，改用價金與費用推算
    const netSigned = String(cell(row, "settlement") ?? "").includes("台幣") ? null : parseAmount(cell(row, "net"));
    const net_amount =
      netSigned !== null && netSigned !== 0
        ? Math.abs(netSigned)
        : side === "buy"
          ? payable && payable > 0
            ? payable
            : amount + fee + tax
          : receivable && receivable > 0
            ? receivable
            : amount - fee - tax;

    const orderNoRaw = String(cell(row, "orderNo") ?? "").trim();
    const currencyRaw = String(cell(row, "currency") ?? "").trim().toUpperCase();
    const base = {
      trade_date,
      symbol: product.symbol,
      name: product.name,
      side,
      quantity,
      price,
      amount,
      fee,
      tax,
      net_amount,
      currency: currencyRaw || "TWD",
      order_no: orderNoRaw || null,
    };
    const key = tradeDedupeKey(base);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    trades.push({ ...base, row: rowNo, dedupe_key: n === 1 ? key : `${key}#${n}` });
  }

  return { headerFound: true, trades, errors };
}
