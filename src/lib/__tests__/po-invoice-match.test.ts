import { describe, expect, it } from "vitest";
import {
  computePoInvoiceMatches,
  type InvoiceForPoMatch,
  type PoForInvoiceMatch,
} from "@/lib/po-invoice-match";

function po(overrides: Partial<PoForInvoiceMatch> & { key: string }): PoForInvoiceMatch {
  return {
    purchase_order_id: overrides.key,
    purchase_date: "2026-07-10",
    total_inc_tax: 1050,
    total_ex_tax: 1000,
    ...overrides,
  };
}

function inv(overrides: Partial<InvoiceForPoMatch> & { id: string }): InvoiceForPoMatch {
  return {
    invoice_number: "AB-12345678",
    invoice_date: "2026-07-10",
    seller_name: "測試賣方",
    amount_inc_tax: 1050,
    amount_ex_tax: 1000,
    buyer_tax_id: "85601237",
    purchase_order_id: null,
    ...overrides,
  };
}

describe("computePoInvoiceMatches（採購單→發票三態）", () => {
  it("已有發票對應此採購單 → matched", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1" })],
      [inv({ id: "i1", purchase_order_id: "po1" })],
    );
    expect(matches.get("po1")?.state).toBe("matched");
    expect(matches.get("po1")?.detail).toContain("AB-12345678");
  });

  it("未對應但有日期金額相符的發票 → candidate；金額不符 → none", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1" }), po({ key: "po2", total_inc_tax: 9999, total_ex_tax: 9000 })],
      [inv({ id: "i1" })],
    );
    expect(matches.get("po1")?.state).toBe("candidate");
    expect(matches.get("po2")?.state).toBe("none");
  });

  it("日期差超過 7 天不算相符", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1" })],
      [inv({ id: "i1", invoice_date: "2026-07-20" })],
    );
    expect(matches.get("po1")?.state).toBe("none");
  });

  it("家庭發票（無買方統編）不參與相符判斷", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1" })],
      [inv({ id: "i1", buyer_tax_id: null })],
    );
    expect(matches.get("po1")?.state).toBe("none");
  });

  it("已對應到其他採購單的發票不再提示", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1" })],
      [inv({ id: "i1", purchase_order_id: "other-po" })],
    );
    expect(matches.get("po1")?.state).toBe("none");
  });

  it("一張發票只提示給一張採購單（日期較近者優先）", () => {
    const matches = computePoInvoiceMatches(
      [
        po({ key: "po-old", purchase_date: "2026-07-05" }),
        po({ key: "po-new", purchase_date: "2026-07-10" }),
      ],
      [inv({ id: "i1", invoice_date: "2026-07-10" })],
    );
    expect(matches.get("po-new")?.state).toBe("candidate");
    expect(matches.get("po-old")?.state).toBe("none");
  });

  it("未稅金額相符（含稅不符）也算 candidate", () => {
    const matches = computePoInvoiceMatches(
      [po({ key: "po1", total_inc_tax: 1049 })],
      [inv({ id: "i1", amount_inc_tax: 1055, amount_ex_tax: 1000 })],
    );
    expect(matches.get("po1")?.state).toBe("candidate");
  });
});
