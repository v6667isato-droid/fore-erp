import { normalizeInvoiceNumber } from "@/lib/accounting-invoice";

/**
 * 台灣電子發票證明聯左側 QR code 解析（財政部規格，前 77 碼固定版面）：
 *   1–10  發票號碼（2 英文＋8 數字）
 *  11–17  開立日期（民國年月日 YYYMMDD）
 *  18–21  隨機碼
 *  22–29  銷售額（未稅，8 位十六進位）
 *  30–37  總計額（含稅，8 位十六進位）
 *  38–45  買方統編（無則 00000000）
 *  46–53  賣方統編
 *  54–77  AES 加密驗證資訊（忽略）
 * 其後以「:」分隔的明細欄位忽略。右側 QR 以「**」開頭，為明細接續，不解析。
 */
export interface EInvoiceQrData {
  /** 正規化後的發票號碼（XX-12345678） */
  invoice_number: string;
  /** 開立日期（西元 YYYY-MM-DD） */
  invoice_date: string;
  random_code: string;
  /** 銷售額（未稅） */
  amount_ex_tax: number;
  /** 總計額（含稅） */
  amount_inc_tax: number;
  /** 買方統編；QR 內為 00000000（無買方）時為 null */
  buyer_tax_id: string | null;
  seller_tax_id: string;
}

/** 民國 YYYMMDD → 西元 YYYY-MM-DD；日期不合法回傳 null */
export function rocCompactDateToIso(roc: string): string | null {
  const m = roc.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${m[2]}-${m[3]}`;
  // 用 Date 驗證實際存在的日期（如 2 月 30 日會被 normalize 掉）
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return iso;
}

/** 8 位十六進位金額 → 十進位；非十六進位回傳 null */
export function hexAmountToNumber(hex: string): number | null {
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

/** 是否為右側 QR（明細接續，以 ** 開頭） */
export function isRightQr(text: string): boolean {
  return text.startsWith("**");
}

/**
 * 解析左側 QR 內容；非左 QR、長度不足或欄位格式不符時回傳 null。
 * 只信任結構完全正確的內容（作為 ground truth，寧缺勿錯）。
 */
export function parseEInvoiceQr(text: string): EInvoiceQrData | null {
  if (!text || isRightQr(text)) return null;
  const head = text.slice(0, 77);
  if (head.length < 77) return null;

  const rawNumber = head.slice(0, 10);
  if (!/^[A-Z]{2}\d{8}$/.test(rawNumber)) return null;

  const isoDate = rocCompactDateToIso(head.slice(10, 17));
  if (!isoDate) return null;

  const randomCode = head.slice(17, 21);
  if (!/^\d{4}$/.test(randomCode)) return null;

  const exTax = hexAmountToNumber(head.slice(21, 29));
  const incTax = hexAmountToNumber(head.slice(29, 37));
  if (exTax == null || incTax == null) return null;

  const buyerRaw = head.slice(37, 45);
  const sellerRaw = head.slice(45, 53);
  if (!/^\d{8}$/.test(buyerRaw) || !/^\d{8}$/.test(sellerRaw)) return null;

  return {
    invoice_number: normalizeInvoiceNumber(rawNumber),
    invoice_date: isoDate,
    random_code: randomCode,
    amount_ex_tax: exTax,
    amount_inc_tax: incTax,
    buyer_tax_id: buyerRaw === "00000000" ? null : buyerRaw,
    seller_tax_id: sellerRaw,
  };
}
