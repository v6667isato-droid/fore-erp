import { describe, expect, it } from "vitest";
import {
  buildOrderHistory,
  formatHistoryDate,
  groupHistoryByDate,
  type OrderHistoryInput,
} from "@/lib/order-history";

// 時間都取 UTC 12:00：在 UTC-11～UTC+11 之間本地日期不變，測試不受時區影響
const T = (ymd: string, hhmm = "12:00") => `${ymd}T${hhmm}:00Z`;

function baseInput(): OrderHistoryInput {
  return {
    order: {
      created_at: T("2026-09-01"),
      deposit_amount: 12000,
      deposit_date: "2026-09-02",
      final_payment_amount: 0,
      final_payment_date: null,
      shipped_date: null,
    },
    items: [
      { id: "i1", label: "CH03 扶手椅 × 2" },
      { id: "i2", label: "DT01 餐桌 × 1" },
    ],
    workOrders: [
      { id: "w1", order_item_id: "i1" },
      { id: "w2", order_item_id: "i2" },
    ],
    stageHistory: [],
    statusHistory: [],
    photos: [],
    returns: [],
    invoices: [],
  };
}

describe("buildOrderHistory", () => {
  it("狀態歷程第一筆（old_status 為空）當作建立訂單，其餘為狀態變更", () => {
    const input = baseInput();
    input.statusHistory = [
      { old_status: "報價中", new_status: "排程中", changed_at: T("2026-09-03"), changed_by_user_id: "u2", actor_label: null },
      { old_status: null, new_status: "報價中", changed_at: T("2026-09-01"), changed_by_user_id: "u1", actor_label: null },
    ];
    const events = buildOrderHistory(input);
    expect(events.map((e) => [e.kind, e.title])).toEqual([
      ["created", "建立訂單"],
      ["payment", "訂金 NT$12,000"],
      ["status", "報價中 → 排程中"],
    ]);
    expect(events[0].subject).toBe("狀態：報價中");
    expect(events[0].actor?.userId).toBe("u1");
    expect(events[0].time).not.toBeNull();
    expect(events[1].time).toBeNull();
  });

  it("沒有狀態歷程（舊訂單）時以 created_at 建立事件", () => {
    const events = buildOrderHistory(baseInput());
    expect(events[0]).toMatchObject({ kind: "created", title: "建立訂單", date: "2026-09-01" });
  });

  it("同一人同時把多個品項推到同一站別合併成一筆；全部品項時顯示「全部品項」", () => {
    const input = baseInput();
    input.stageHistory = [
      // 建立工單時的「待排程」不列
      { work_order_id: "w1", old_stage: null, new_stage: "待排程", changed_at: T("2026-09-01"), changed_by_user_id: null, changed_by_employee_id: null },
      { work_order_id: "w1", old_stage: "待排程", new_stage: "備料中", changed_at: T("2026-09-05", "12:00"), changed_by_user_id: "u1", changed_by_employee_id: "e1" },
      { work_order_id: "w2", old_stage: "待排程", new_stage: "備料中", changed_at: T("2026-09-05", "12:01"), changed_by_user_id: "u1", changed_by_employee_id: "e1" },
      { work_order_id: "w1", old_stage: "備料中", new_stage: "砂磨中", changed_at: T("2026-09-08"), changed_by_user_id: "u3", changed_by_employee_id: "e3" },
    ];
    const stages = buildOrderHistory(input).filter((e) => e.kind === "stage");
    expect(stages.map((e) => [e.title, e.subject])).toEqual([
      ["備料中", "全部品項（2 項）"],
      ["砂磨中", "CH03 扶手椅 × 2"],
    ]);
    expect(stages[1].actor).toEqual({ userId: "u3", employeeId: "e3" });
  });

  it("舊版編輯訂單重建的工單：首筆不是待排程且晚於建單，加註先前時間未保留", () => {
    const input = baseInput();
    input.stageHistory = [
      { work_order_id: "w2", old_stage: null, new_stage: "組裝中(一)", changed_at: T("2026-09-20"), changed_by_user_id: "u1", changed_by_employee_id: null },
    ];
    const [stage] = buildOrderHistory(input).filter((e) => e.kind === "stage");
    expect(stage.subject).toBe("DT01 餐桌 × 1");
    expect(stage.notes[0]).toMatch(/未保留/);
  });

  it("完工照片依品項＋日期合併；品項已移除顯示「已移除的品項」，未掛品項為整張訂單", () => {
    const input = baseInput();
    input.photos = [
      { id: "p1", order_item_id: "i1", taken_on: "2026-09-25", created_at: T("2026-09-26"), uploaded_by: "u1" },
      { id: "p2", order_item_id: "i1", taken_on: "2026-09-25", created_at: T("2026-09-26"), uploaded_by: "u1" },
      { id: "p3", order_item_id: "gone", taken_on: "2026-09-25", created_at: T("2026-09-26"), uploaded_by: "u1" },
      { id: "p4", order_item_id: null, taken_on: null, created_at: T("2026-09-27"), uploaded_by: "u1" },
    ];
    const photos = buildOrderHistory(input).filter((e) => e.kind === "photos");
    expect(photos.map((e) => [e.date, e.title, e.subject, e.photoIds])).toEqual([
      ["2026-09-25", "2 張", "CH03 扶手椅 × 2", ["p1", "p2"]],
      ["2026-09-25", "1 張", "已移除的品項", ["p3"]],
      ["2026-09-27", "1 張", "整張訂單", ["p4"]],
    ]);
  });

  it("出貨日與「已出貨」狀態同一天時不重複列；發票草稿不列、作廢加註", () => {
    const input = baseInput();
    input.order.shipped_date = "2026-10-01";
    input.statusHistory = [
      { old_status: "已完工", new_status: "已出貨", changed_at: T("2026-10-01"), changed_by_user_id: "u1", actor_label: null },
    ];
    input.invoices = [
      { id: "v1", invoice_number: "AB12345678", invoice_date: "2026-10-02", status: "voided", amount_inc_tax: 52500, void_date: "2026-10-03" },
      { id: "v2", invoice_number: null, invoice_date: "2026-10-02", status: "draft", amount_inc_tax: 52500, void_date: null },
    ];
    const events = buildOrderHistory(input);
    expect(events.filter((e) => e.kind === "shipped")).toHaveLength(0);
    const invoices = events.filter((e) => e.kind === "invoice");
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ title: "開立 AB12345678", subject: "NT$52,500", notes: ["已作廢（2026-10-03）"] });
  });

  it("沒有狀態歷程時仍以出貨日列出出貨；退貨列退款金額與原因", () => {
    const input = baseInput();
    input.order.shipped_date = "2026-10-01";
    input.returns = [{ id: "r1", return_date: "2026-10-05", refund_amount: 3000, reason: "椅腳刮傷" }];
    const tail = buildOrderHistory(input).slice(-2);
    expect(tail.map((e) => [e.kind, e.title, e.subject])).toEqual([
      ["shipped", "出貨", undefined],
      ["return", "退款 NT$3,000", "椅腳刮傷"],
    ]);
  });
});

describe("groupHistoryByDate / formatHistoryDate", () => {
  it("依日期分組並保留順序", () => {
    const input = baseInput();
    input.order.final_payment_date = "2026-09-02";
    input.order.final_payment_amount = 40000;
    const groups = groupHistoryByDate(buildOrderHistory(input));
    expect(groups.map((g) => [g.date, g.events.length])).toEqual([
      ["2026-09-01", 1],
      ["2026-09-02", 2],
    ]);
  });

  it("日期標題含星期", () => {
    expect(formatHistoryDate("2026-10-12")).toBe("2026/10/12（一）");
  });
});
