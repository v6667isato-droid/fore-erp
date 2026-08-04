import { createHash } from "node:crypto";

/**
 * 光賀（Amego）電子發票 API 伺服器端 client。
 * 僅限 API route 使用（含 App Key，不可打包進前端）。
 *
 * 簽章規則：sign = md5(data(JSON字串) + unix時間 + AppKey)，
 * POST application/x-www-form-urlencoded，time 與伺服器誤差需在 ±60 秒內。
 * 文件：https://invoice.amego.tw/api_doc/
 */

const API_BASE = "https://invoice-api.amego.tw";

/** 文件公開的測試環境帳號（未設定正式環境變數時使用） */
const TEST_BAN = "12345678";
const TEST_APP_KEY = "sHeq7t8G1wiQvhAuIM27";

export type AmegoEnvironment = "test" | "production";

export interface AmegoCredentials {
  ban: string;
  appKey: string;
  environment: AmegoEnvironment;
}

/** 讀取憑證：AMEGO_BAN＋AMEGO_APP_KEY 都設定時走正式，否則退回公開測試帳號 */
export function getAmegoCredentials(): AmegoCredentials {
  const ban = process.env.AMEGO_BAN?.trim();
  const appKey = process.env.AMEGO_APP_KEY?.trim();
  if (ban && appKey) return { ban, appKey, environment: "production" };
  return { ban: TEST_BAN, appKey: TEST_APP_KEY, environment: "test" };
}

export interface AmegoResponse {
  code: number;
  msg: string;
  [key: string]: unknown;
}

/** 呼叫光賀 API；回傳解析後 JSON（code=0 為成功），網路／格式錯誤時 throw */
export async function callAmego(path: string, data: unknown, creds: AmegoCredentials): Promise<AmegoResponse> {
  const dataStr = JSON.stringify(data);
  const time = Math.floor(Date.now() / 1000);
  const sign = createHash("md5").update(dataStr + time + creds.appKey, "utf8").digest("hex");
  const body = new URLSearchParams({
    invoice: creds.ban,
    data: dataStr,
    time: String(time),
    sign,
  });
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as AmegoResponse;
  } catch {
    throw new Error(`光賀 API 回應異常（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

/** Unix 時間戳記 → 台北時區 YYYY-MM-DD */
export function timestampToTaipeiDate(ts: number): string {
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → 光賀用 YYYYMMDD 數字 */
export function dateToYmd(date: string): number {
  return Number(date.replaceAll("-", ""));
}

export interface AmegoInvoiceInput {
  /** 訂單編號（光賀端唯一鍵），用發票 UUID */
  orderId: string;
  invoiceType: "B2B" | "B2C";
  taxType: number;
  buyerTaxId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  carrierType: string | null;
  carrierId: string | null;
  donationCode: string | null;
  notes: string | null;
  items: { description: string; quantity: number; unit: string | null; unit_price: number | null; amount: number }[];
}

/**
 * 組 f0401（自動配號開立）payload。
 * B2B 明細未稅（DetailVat=0，稅額＝銷售額×5%）；B2C 明細含稅、TaxAmount=0，
 * 與 calcInvoiceTotals 的慣例一致。
 */
export function buildIssuePayload(inv: AmegoInvoiceInput): Record<string, unknown> {
  const isB2B = inv.invoiceType === "B2B";
  const lineSum = Math.round(inv.items.reduce((acc, it) => acc + it.amount, 0));

  const salesAmount = inv.taxType === 1 ? lineSum : 0;
  const freeTaxAmount = inv.taxType === 3 ? lineSum : 0;
  const zeroTaxAmount = inv.taxType === 2 ? lineSum : 0;
  const taxAmount = isB2B && inv.taxType === 1 ? Math.round(salesAmount * 0.05) : 0;

  return {
    OrderId: inv.orderId,
    BuyerIdentifier: isB2B ? (inv.buyerTaxId ?? "") : "0000000000",
    BuyerName: inv.buyerName?.trim() || (isB2B ? inv.buyerTaxId ?? "" : "客人"),
    BuyerAddress: "",
    BuyerTelephoneNumber: "",
    BuyerEmailAddress: inv.buyerEmail?.trim() ?? "",
    MainRemark: (inv.notes ?? "").slice(0, 200),
    CarrierType: !isB2B && inv.carrierType ? inv.carrierType : "",
    CarrierId1: !isB2B && inv.carrierType ? inv.carrierId ?? "" : "",
    CarrierId2: !isB2B && inv.carrierType ? inv.carrierId ?? "" : "",
    NPOBAN: !isB2B ? inv.donationCode ?? "" : "",
    ProductItem: inv.items.map((it) => ({
      Description: it.description.slice(0, 256),
      Quantity: it.quantity,
      Unit: (it.unit ?? "").slice(0, 6),
      UnitPrice: it.unit_price ?? (it.quantity !== 0 ? Math.round((it.amount / it.quantity) * 100) / 100 : it.amount),
      Amount: it.amount,
      Remark: "",
      TaxType: inv.taxType,
    })),
    SalesAmount: salesAmount,
    FreeTaxSalesAmount: freeTaxAmount,
    ZeroTaxSalesAmount: zeroTaxAmount,
    TaxType: inv.taxType,
    TaxRate: "0.05",
    TaxAmount: taxAmount,
    TotalAmount: salesAmount + freeTaxAmount + zeroTaxAmount + taxAmount,
    ...(isB2B ? { DetailVat: 0, DetailAmountRound: 1 } : {}),
  };
}
