import { normalizeInvoiceNumber } from "@/lib/accounting-invoice";
import type { EInvoiceQrData } from "@/lib/e-invoice-qr";

/**
 * 發票勾稽引擎：以 QR 解碼結果為 ground truth，交叉比對 OCR 辨識值與表單目前輸入，
 * 再加上金額算式與字軌期別檢核。純函式，UI 與存檔記錄共用。
 */

/** OCR 辨識值（日期需已轉西元 YYYY-MM-DD，呼叫端先過 fixRocDate） */
export interface AuditOcrValues {
  invoice_number: string | null;
  invoice_date: string | null;
  seller_tax_id: string | null;
  amount_ex_tax: number | null;
  tax_amount: number | null;
  amount_inc_tax: number | null;
}

/** 表單目前輸入值 */
export interface AuditFormValues {
  invoiceNumber: string;
  invoiceDate: string;
  sellerTaxId: string;
  amountExTax: number | null;
  taxAmount: number | null;
  amountIncTax: number | null;
  /** 課稅別：1 應稅／2 零稅率／3 免稅 */
  taxType: number;
}

/** 發票期別（證明聯開頭「115年07-08月」） */
export interface InvoicePeriod {
  rocYear: number;
  startMonth: number;
  endMonth: number;
}

export type AuditStatus = "pass" | "warn" | "skip";

export type AuditCheckKey =
  | "invoice_number"
  | "invoice_date"
  | "amount_inc_tax"
  | "seller_tax_id"
  | "amount_sum"
  | "tax_rate"
  | "period";

export interface AuditCheck {
  key: AuditCheckKey;
  label: string;
  status: AuditStatus;
  /** 不一致原因（例：「QR: 260 / OCR: 280」）；pass／skip 時可省略 */
  detail?: string;
}

export interface AuditResult {
  checks: AuditCheck[];
  passCount: number;
  warnCount: number;
  /** QR 是否成功解碼（有 ground truth 可勾稽） */
  qrVerified: boolean;
  /** 沒有任何警告（skip 不算警告） */
  allPass: boolean;
}

/** 金額進位容差（±1 元） */
export const AMOUNT_TOLERANCE = 1;

function fmtAmount(n: number): string {
  return `$${n.toLocaleString()}`;
}

/** 交叉比對多來源字串值：全部一致→pass、有出入→warn 並列出各來源、可比對來源不足→skip */
function crossCheck(
  key: AuditCheckKey,
  label: string,
  sources: { name: string; value: string | null }[],
  format: (v: string) => string = (v) => v,
): AuditCheck {
  const present = sources.filter((s): s is { name: string; value: string } => {
    return s.value != null && s.value !== "";
  });
  if (present.length < 2) return { key, label, status: "skip" };
  const distinct = new Set(present.map((s) => s.value));
  if (distinct.size === 1) return { key, label, status: "pass" };
  return {
    key,
    label,
    status: "warn",
    detail: present.map((s) => `${s.name}: ${format(s.value)}`).join(" / "),
  };
}

function parseIsoDate(value: string): { year: number; month: number } | null {
  const m = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** 日期是否落在字軌期別內（民國年＋起訖月） */
export function isDateInPeriod(isoDate: string, period: InvoicePeriod): boolean | null {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return null;
  if (parsed.year - 1911 !== period.rocYear) return false;
  return parsed.month >= period.startMonth && parsed.month <= period.endMonth;
}

export interface AuditInput {
  qr: EInvoiceQrData | null;
  ocr: AuditOcrValues | null;
  form: AuditFormValues;
  period?: InvoicePeriod | null;
}

export function auditInvoice({ qr, ocr, form, period }: AuditInput): AuditResult {
  const checks: AuditCheck[] = [];
  const normalize = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s ? normalizeInvoiceNumber(s) : null;
  };
  const numStr = (v: number | null | undefined) => (v != null ? String(v) : null);

  checks.push(
    crossCheck("invoice_number", "發票號碼", [
      { name: "QR", value: qr ? qr.invoice_number : null },
      { name: "OCR", value: normalize(ocr?.invoice_number) },
      { name: "表單", value: normalize(form.invoiceNumber) },
    ]),
  );

  checks.push(
    crossCheck("invoice_date", "發票日期", [
      { name: "QR", value: qr ? qr.invoice_date : null },
      { name: "OCR", value: ocr?.invoice_date ?? null },
      { name: "表單", value: form.invoiceDate.trim() || null },
    ]),
  );

  checks.push(
    crossCheck(
      "amount_inc_tax",
      "含稅金額",
      [
        { name: "QR", value: qr ? String(qr.amount_inc_tax) : null },
        { name: "OCR", value: numStr(ocr?.amount_inc_tax) },
        { name: "表單", value: numStr(form.amountIncTax) },
      ],
      (v) => fmtAmount(Number(v)),
    ),
  );

  checks.push(
    crossCheck("seller_tax_id", "賣方統編", [
      { name: "QR", value: qr ? qr.seller_tax_id : null },
      { name: "OCR", value: ocr?.seller_tax_id?.trim() || null },
      { name: "表單", value: form.sellerTaxId.trim() || null },
    ]),
  );

  // 未稅＋稅額＝含稅（±1 元進位容差）
  if (form.amountExTax != null && form.taxAmount != null && form.amountIncTax != null) {
    const sum = form.amountExTax + form.taxAmount;
    const diff = Math.abs(sum - form.amountIncTax);
    checks.push(
      diff <= AMOUNT_TOLERANCE
        ? { key: "amount_sum", label: "未稅＋稅額＝含稅", status: "pass" }
        : {
            key: "amount_sum",
            label: "未稅＋稅額＝含稅",
            status: "warn",
            detail: `未稅＋稅額 ${fmtAmount(sum)} ≠ 含稅 ${fmtAmount(form.amountIncTax)}`,
          },
    );
  } else {
    checks.push({ key: "amount_sum", label: "未稅＋稅額＝含稅", status: "skip" });
  }

  // 稅額檢核：應稅≈含稅×5/105（±1）；零稅率／免稅應為 0
  if (form.taxType === 1) {
    if (form.amountIncTax != null && form.taxAmount != null) {
      const expected = (form.amountIncTax * 5) / 105;
      const diff = Math.abs(form.taxAmount - expected);
      checks.push(
        diff <= AMOUNT_TOLERANCE
          ? { key: "tax_rate", label: "稅額≈含稅×5/105", status: "pass" }
          : {
              key: "tax_rate",
              label: "稅額≈含稅×5/105",
              status: "warn",
              detail: `稅額 ${fmtAmount(form.taxAmount)}，依含稅 5% 推算應約 ${fmtAmount(Math.round(expected))}`,
            },
      );
    } else {
      checks.push({ key: "tax_rate", label: "稅額≈含稅×5/105", status: "skip" });
    }
  } else if (form.taxType === 2 || form.taxType === 3) {
    if (form.taxAmount != null && form.taxAmount !== 0) {
      checks.push({
        key: "tax_rate",
        label: "零稅率／免稅稅額",
        status: "warn",
        detail: `課稅別為${form.taxType === 2 ? "零稅率" : "免稅"}，稅額應為 $0（目前 ${fmtAmount(form.taxAmount)}）`,
      });
    } else {
      checks.push({ key: "tax_rate", label: "零稅率／免稅稅額", status: "pass" });
    }
  } else {
    checks.push({ key: "tax_rate", label: "稅額檢核", status: "skip" });
  }

  // 字軌期別 vs 發票日期
  const dateForPeriod = form.invoiceDate.trim() || (qr ? qr.invoice_date : null);
  if (period && dateForPeriod) {
    const inPeriod = isDateInPeriod(dateForPeriod, period);
    if (inPeriod == null) {
      checks.push({ key: "period", label: "字軌期別", status: "skip" });
    } else {
      checks.push(
        inPeriod
          ? { key: "period", label: "字軌期別", status: "pass" }
          : {
              key: "period",
              label: "字軌期別",
              status: "warn",
              detail: `期別 ${period.rocYear} 年 ${String(period.startMonth).padStart(2, "0")}-${String(period.endMonth).padStart(2, "0")} 月，發票日期 ${dateForPeriod} 不在期別內`,
            },
      );
    }
  } else {
    checks.push({ key: "period", label: "字軌期別", status: "skip" });
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  return {
    checks,
    passCount,
    warnCount,
    qrVerified: qr != null,
    allPass: warnCount === 0,
  };
}

/** 存入 accounting_invoices.review_checks 的存檔記錄（追溯用） */
export interface StoredReviewChecks {
  checked_at: string;
  qr_verified: boolean;
  all_pass: boolean;
  checks: { key: AuditCheckKey; label: string; status: AuditStatus; detail?: string }[];
  [key: string]: unknown;
}

export function toStoredReviewChecks(result: AuditResult): StoredReviewChecks {
  return {
    checked_at: new Date().toISOString(),
    qr_verified: result.qrVerified,
    all_pass: result.allPass,
    checks: result.checks.map(({ key, label, status, detail }) => ({
      key,
      label,
      status,
      ...(detail ? { detail } : {}),
    })),
  };
}
