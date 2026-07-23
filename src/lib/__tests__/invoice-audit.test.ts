import { describe, expect, it } from "vitest";
import type { EInvoiceQrData } from "@/lib/e-invoice-qr";
import {
  auditInvoice,
  isDateInPeriod,
  type AuditFormValues,
  type AuditOcrValues,
} from "@/lib/invoice-audit";

const qr: EInvoiceQrData = {
  invoice_number: "CU-30589146",
  invoice_date: "2026-07-07",
  random_code: "9000",
  amount_ex_tax: 100,
  amount_inc_tax: 105,
  buyer_tax_id: null,
  seller_tax_id: "69500825",
};

const ocr: AuditOcrValues = {
  invoice_number: "CU30589146",
  invoice_date: "2026-07-07",
  seller_tax_id: "69500825",
  amount_ex_tax: 100,
  tax_amount: 5,
  amount_inc_tax: 105,
};

const form: AuditFormValues = {
  invoiceNumber: "CU-30589146",
  invoiceDate: "2026-07-07",
  sellerTaxId: "69500825",
  amountExTax: 100,
  taxAmount: 5,
  amountIncTax: 105,
  taxType: 1,
};

function check(result: ReturnType<typeof auditInvoice>, key: string) {
  const c = result.checks.find((c) => c.key === key);
  if (!c) throw new Error(`missing check: ${key}`);
  return c;
}

describe("auditInvoice：QR／OCR／表單交叉比對", () => {
  it("三來源一致時全數通過", () => {
    const r = auditInvoice({ qr, ocr, form, period: { rocYear: 115, startMonth: 7, endMonth: 8 } });
    expect(r.qrVerified).toBe(true);
    expect(r.warnCount).toBe(0);
    expect(r.allPass).toBe(true);
    expect(check(r, "invoice_number").status).toBe("pass");
    expect(check(r, "amount_inc_tax").status).toBe("pass");
    expect(check(r, "seller_tax_id").status).toBe("pass");
    expect(check(r, "period").status).toBe("pass");
  });

  it("發票號碼格式差異（有無連字號）視為一致", () => {
    const r = auditInvoice({ qr, ocr: { ...ocr, invoice_number: "cu-30589146" }, form });
    expect(check(r, "invoice_number").status).toBe("pass");
  });

  it("QR 與 OCR 金額不一致時標警告並列出各來源", () => {
    const r = auditInvoice({ qr, ocr: { ...ocr, amount_inc_tax: 280 }, form: { ...form, amountIncTax: 105 } });
    const c = check(r, "amount_inc_tax");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("QR: $105");
    expect(c.detail).toContain("OCR: $280");
    expect(r.allPass).toBe(false);
  });

  it("QR 解碼失敗時仍比對 OCR 與表單，qrVerified 為 false", () => {
    const r = auditInvoice({ qr: null, ocr, form });
    expect(r.qrVerified).toBe(false);
    expect(check(r, "invoice_number").status).toBe("pass"); // OCR vs 表單一致
  });

  it("只有單一來源可比對時 skip", () => {
    const r = auditInvoice({
      qr: null,
      ocr: { ...ocr, invoice_number: null, seller_tax_id: null },
      form: { ...form, sellerTaxId: "" },
    });
    expect(check(r, "seller_tax_id").status).toBe("skip");
  });
});

describe("auditInvoice：金額算式容差邊界", () => {
  it("未稅＋稅額＝含稅：差 1 元內通過、超過警告", () => {
    const base = { qr: null, ocr: null };
    expect(check(auditInvoice({ ...base, form }), "amount_sum").status).toBe("pass");
    expect(
      check(auditInvoice({ ...base, form: { ...form, amountIncTax: 106 } }), "amount_sum").status,
    ).toBe("pass"); // 差 1 元 = 容差邊界
    expect(
      check(auditInvoice({ ...base, form: { ...form, amountIncTax: 107 } }), "amount_sum").status,
    ).toBe("warn"); // 差 2 元
  });

  it("稅額≈含稅×5/105：差 1 元內通過、超過警告", () => {
    const base = { qr: null, ocr: null };
    const f = { ...form, amountExTax: 1000, amountIncTax: 1050 };
    expect(check(auditInvoice({ ...base, form: { ...f, taxAmount: 50 } }), "tax_rate").status).toBe("pass");
    expect(check(auditInvoice({ ...base, form: { ...f, taxAmount: 49 } }), "tax_rate").status).toBe("pass"); // 差 1 元
    expect(check(auditInvoice({ ...base, form: { ...f, taxAmount: 48 } }), "tax_rate").status).toBe("warn"); // 差 2 元
  });

  it("金額缺漏時 skip 不誤報", () => {
    const r = auditInvoice({ qr: null, ocr: null, form: { ...form, amountExTax: null } });
    expect(check(r, "amount_sum").status).toBe("skip");
  });

  it("零稅率／免稅：稅額 0 通過、非 0 警告", () => {
    const base = { qr: null, ocr: null };
    expect(
      check(auditInvoice({ ...base, form: { ...form, taxType: 2, taxAmount: 0 } }), "tax_rate").status,
    ).toBe("pass");
    expect(
      check(auditInvoice({ ...base, form: { ...form, taxType: 3, taxAmount: 5 } }), "tax_rate").status,
    ).toBe("warn");
  });
});

describe("字軌期別判斷", () => {
  const period = { rocYear: 115, startMonth: 7, endMonth: 8 };

  it("日期落在期別內", () => {
    expect(isDateInPeriod("2026-07-01", period)).toBe(true);
    expect(isDateInPeriod("2026-08-31", period)).toBe(true);
  });

  it("月份或年度不符", () => {
    expect(isDateInPeriod("2026-06-30", period)).toBe(false);
    expect(isDateInPeriod("2026-09-01", period)).toBe(false);
    expect(isDateInPeriod("2025-07-15", period)).toBe(false); // 民國 114 年
  });

  it("日期格式不合法回傳 null", () => {
    expect(isDateInPeriod("2026/07/01", period)).toBeNull();
  });

  it("勾稽整合：期別不符標警告、無期別資訊 skip", () => {
    const warn = auditInvoice({ qr, ocr, form: { ...form, invoiceDate: "2026-09-01" }, period });
    expect(check(warn, "period").status).toBe("warn");
    const skip = auditInvoice({ qr, ocr, form, period: null });
    expect(check(skip, "period").status).toBe("skip");
  });
});
