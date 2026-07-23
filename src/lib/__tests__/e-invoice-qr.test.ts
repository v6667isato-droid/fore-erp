import { describe, expect, it } from "vitest";
import {
  hexAmountToNumber,
  isRightQr,
  parseEInvoiceQr,
  rocCompactDateToIso,
} from "@/lib/e-invoice-qr";

describe("hexAmountToNumber（十六進位金額轉十進位）", () => {
  it("轉換 8 位十六進位", () => {
    expect(hexAmountToNumber("00000064")).toBe(100);
    expect(hexAmountToNumber("00000069")).toBe(105);
    expect(hexAmountToNumber("000003e8")).toBe(1000);
    expect(hexAmountToNumber("000003E8")).toBe(1000); // 大小寫皆可
    expect(hexAmountToNumber("00000000")).toBe(0);
  });

  it("非十六進位回傳 null", () => {
    expect(hexAmountToNumber("0000GGGG")).toBeNull();
    expect(hexAmountToNumber("")).toBeNull();
    expect(hexAmountToNumber("12 45678")).toBeNull();
  });
});

describe("rocCompactDateToIso（民國 YYYMMDD 轉西元）", () => {
  it("正常轉換", () => {
    expect(rocCompactDateToIso("1150707")).toBe("2026-07-07");
    expect(rocCompactDateToIso("1140101")).toBe("2025-01-01");
    expect(rocCompactDateToIso("1131231")).toBe("2024-12-31");
  });

  it("不合法日期回傳 null", () => {
    expect(rocCompactDateToIso("1151307")).toBeNull(); // 13 月
    expect(rocCompactDateToIso("1150732")).toBeNull(); // 32 日
    expect(rocCompactDateToIso("1150230")).toBeNull(); // 2 月 30 日不存在
    expect(rocCompactDateToIso("115070")).toBeNull(); // 位數不足
    expect(rocCompactDateToIso("115O707")).toBeNull(); // 混入英文字母
  });
});

/** 組一段結構正確的左 QR 內容（前 77 碼＋明細尾段） */
function buildLeftQr(overrides?: {
  number?: string;
  date?: string;
  random?: string;
  exHex?: string;
  incHex?: string;
  buyer?: string;
  seller?: string;
}): string {
  const o = {
    number: "CU30589146",
    date: "1150707",
    random: "9000",
    exHex: "00000064", // 100
    incHex: "00000069", // 105
    buyer: "00000000",
    seller: "69500825",
    ...overrides,
  };
  const aes = "A".repeat(24);
  return `${o.number}${o.date}${o.random}${o.exHex}${o.incHex}${o.buyer}${o.seller}${aes}:**********:1:1:1:`;
}

describe("parseEInvoiceQr（左 QR 前 77 碼解析）", () => {
  it("解析完整左 QR", () => {
    const data = parseEInvoiceQr(buildLeftQr());
    expect(data).not.toBeNull();
    expect(data!.invoice_number).toBe("CU-30589146");
    expect(data!.invoice_date).toBe("2026-07-07");
    expect(data!.random_code).toBe("9000");
    expect(data!.amount_ex_tax).toBe(100);
    expect(data!.amount_inc_tax).toBe(105);
    expect(data!.buyer_tax_id).toBeNull(); // 00000000 → 無買方統編
    expect(data!.seller_tax_id).toBe("69500825");
  });

  it("買方統編非 00000000 時保留", () => {
    const data = parseEInvoiceQr(buildLeftQr({ buyer: "12345678" }));
    expect(data!.buyer_tax_id).toBe("12345678");
  });

  it("右 QR（** 開頭）不解析", () => {
    expect(isRightQr("**foo")).toBe(true);
    expect(parseEInvoiceQr("**" + buildLeftQr())).toBeNull();
  });

  it("結構不符回傳 null", () => {
    expect(parseEInvoiceQr("")).toBeNull();
    expect(parseEInvoiceQr("CU30589146")).toBeNull(); // 長度不足
    expect(parseEInvoiceQr(buildLeftQr({ number: "1U30589146" }))).toBeNull(); // 號碼格式錯
    expect(parseEInvoiceQr(buildLeftQr({ date: "1151307" }))).toBeNull(); // 日期不合法
    expect(parseEInvoiceQr(buildLeftQr({ incHex: "0000GGGG" }))).toBeNull(); // 金額非十六進位
    expect(parseEInvoiceQr(buildLeftQr({ seller: "6950082X" }))).toBeNull(); // 統編非數字
  });
});
