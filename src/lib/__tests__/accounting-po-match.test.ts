import { describe, expect, it } from "vitest";
import { suggestPos, type PoOption } from "@/lib/accounting-po-match";

function po(partial: Partial<PoOption> & { id: string }): PoOption {
  return {
    po_number: partial.id,
    purchase_date: "2026-07-20",
    vendor_name: "宏益木業",
    total_inc_tax: 10000,
    total_ex_tax: 9524,
    ...partial,
  } as PoOption;
}

const input = {
  sellerName: "宏益木業",
  invoiceDate: "2026-07-20",
  amountIncTax: 10000,
  amountExTax: null,
};

describe("suggestPos：加權評分（金額 50%／日期 30%／賣方 20%）", () => {
  it("金額完全一致優先於賣方同名但金額差 $476（原排序問題案例）", () => {
    const near = po({ id: "near", total_inc_tax: 10476 }); // 同日同賣方、金額差 476
    const exact = po({ id: "exact", purchase_date: "2026-07-17" }); // 金額一致但早 3 天
    const out = suggestPos(input, [near, exact]);
    expect(out[0].po.id).toBe("exact");
    expect(out[0].amountExact).toBe(true);
    expect(out[1].po.id).toBe("near");
    expect(out[1].amountExact).toBe(false);
  });

  it("日期 ±3 天內線性遞減：同金額同賣方時日期近的在前", () => {
    const sameDay = po({ id: "same-day" });
    const twoDays = po({ id: "two-days", purchase_date: "2026-07-18" });
    const out = suggestPos(input, [twoDays, sameDay]);
    expect(out.map((s) => s.po.id)).toEqual(["same-day", "two-days"]);
  });

  it("賣方不符且金額不一致的候選被過濾", () => {
    const unrelated = po({ id: "x", vendor_name: "毫無關係公司", total_inc_tax: 10476 });
    expect(suggestPos(input, [unrelated])).toHaveLength(0);
  });

  it("匹配明細：vendorMatch／dateDiffDays／amountDiff", () => {
    const cand = po({ id: "c", purchase_date: "2026-07-19", total_inc_tax: 9524 });
    const [s] = suggestPos(input, [cand]);
    expect(s.vendorMatch).toBe(true);
    expect(s.dateDiffDays).toBe(-1); // 採購比發票早 1 天
    expect(s.amountDiff).toBe(-476); // 採購單比發票少 476
    expect(s.amountExact).toBe(false);
  });

  it("未稅金額吻合也算金額一致（發票只有未稅時）", () => {
    const cand = po({ id: "ex", total_inc_tax: 0, total_ex_tax: 9524 });
    const [s] = suggestPos({ ...input, amountIncTax: null, amountExTax: 9524 }, [cand]);
    expect(s.amountExact).toBe(true);
  });
});
