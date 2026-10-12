import { describe, expect, it } from "vitest";
import { planOrderItemSave, workOrderPatch } from "@/lib/order-items-save";

const row = (id: string) => ({ id });

describe("planOrderItemSave", () => {
  it("新增訂單：全部新增，依表單順序給 line_order", () => {
    const plan = planOrderItemSave([], [row("item-0"), row("item-1")]);
    expect(plan.keep).toEqual([]);
    expect(plan.insert.map((x) => [x.item.id, x.lineOrder])).toEqual([
      ["item-0", 0],
      ["item-1", 1],
    ]);
    expect(plan.removeIds).toEqual([]);
  });

  it("編輯訂單：原品項沿用 id、新列新增、被移除的列刪除", () => {
    const plan = planOrderItemSave(["a", "b", "c"], [row("item-123"), row("c"), row("a")]);
    expect(plan.keep.map((x) => [x.id, x.lineOrder])).toEqual([
      ["c", 1],
      ["a", 2],
    ]);
    expect(plan.insert.map((x) => [x.item.id, x.lineOrder])).toEqual([["item-123", 0]]);
    expect(plan.removeIds).toEqual(["b"]);
  });

  it("同一個原 id 出現兩次：第二次視為新增", () => {
    const plan = planOrderItemSave(["a"], [row("a"), row("a")]);
    expect(plan.keep.map((x) => x.lineOrder)).toEqual([0]);
    expect(plan.insert.map((x) => x.lineOrder)).toEqual([1]);
    expect(plan.removeIds).toEqual([]);
  });
});

describe("workOrderPatch", () => {
  const base = { stage: "砂磨中" as const, assignee_id: "e1", planned_end_date: "2026-10-30" };

  it("沒改任何欄位：不寫入（保留工廠在表單開啟期間推進的工序）", () => {
    expect(workOrderPatch(base, { ...base })).toEqual({});
  });

  it("只寫入有改的欄位", () => {
    expect(workOrderPatch(base, { ...base, assignee_id: null })).toEqual({ assignee_id: null });
    expect(workOrderPatch(base, { ...base, stage: "組裝中(一)" })).toEqual({ stage: "組裝中(一)" });
  });

  it("原本沒有預計完工日、這次帶入訂單交期：寫入", () => {
    expect(
      workOrderPatch({ ...base, planned_end_date: null }, { ...base, planned_end_date: "2026-11-01" }),
    ).toEqual({ planned_end_date: "2026-11-01" });
  });

  it("不知道原值：全部寫入", () => {
    expect(workOrderPatch(undefined, base)).toEqual(base);
  });
});
