import { describe, expect, it } from "vitest";
import {
  buildOrderTrail,
  collectReferenceIds,
  describeActorLabel,
  type AuditRow,
  type TrailLookups,
} from "@/lib/order-audit-trail";
import chairFixture from "./fixtures/order-audit-trail-chair.json";

const FABRIC = "0059f6c2-f98a-41dd-b513-598bd5ce1c35";
const RATTAN = "c2fbcf42-5c40-42ec-b8c7-26a1995f577b";

const lookups: TrailLookups = {
  variants: {
    [FABRIC]: "CH03 扶手椅 布墊-F（CH03-W-F）",
    [RATTAN]: "CH03 扶手椅 藤編-R（CH03-W-R）",
  },
  employees: { "1c22317a-a079-4cd5-adf3-cd0f319e0366": "木工師傅" },
  customers: { "3847f45a-d0d8-4290-bde8-cbec7df59ea0": "通路客戶" },
};

const rows = chairFixture as AuditRow[];

describe("buildOrderTrail：椅子布墊→藤編→布墊", () => {
  const events = buildOrderTrail(rows, lookups);
  const chronological = [...events].reverse();

  it("刪除＋新增重建合併成 7 個事件（新到舊）", () => {
    expect(events).toHaveLength(7);
    expect(Date.parse(events[0].at)).toBeGreaterThan(Date.parse(events[6].at));
  });

  it("建立訂單事件含訂單摘要與新增品項、工單", () => {
    const [created] = chronological;
    expect(created.actorLabel).toMatch(/^portal:/);
    expect(created.entries.map((e) => e.title)).toEqual(["建立訂單", "新增品項"]);
    expect(created.entries[0].changes).toContainEqual({ label: "客戶", to: "通路客戶" });
    expect(created.entries[0].changes).toContainEqual({ label: "總額", to: "14,400" });
    expect(created.entries[1].subject).toBe("椅 · CH03 扶手椅 布墊-F（CH03-W-F） × 1");
    expect(created.entries[1].notes).toEqual(["建立工單（待排程）"]);
  });

  it("通路改數量：只列總額、數量、備註，工單標示隨品項重建", () => {
    const e = chronological[1];
    expect(e.entries.map((x) => x.title)).toEqual(["修改訂單", "修改品項"]);
    expect(e.entries[0].changes).toEqual([{ label: "總額", from: "14,400", to: "28,800" }]);
    expect(e.entries[1].changes).toEqual([
      { label: "數量", from: "1", to: "2" },
      { label: "備註", from: "1J4AUA04CJO NK4", to: "布面灰色" },
    ]);
    expect(e.entries[1].notes).toEqual(["工單隨品項重建（階段保留：待排程）"]);
  });

  it("訂單狀態與工單階段同一次操作", () => {
    const e = chronological[2];
    expect(e.entries.map((x) => x.title)).toEqual(["修改訂單", "工單異動"]);
    expect(e.entries[0].changes).toEqual([{ label: "狀態", from: "排程中", to: "生產中" }]);
    expect(e.entries[1].subject).toBe("椅 · CH03 扶手椅 布墊-F（CH03-W-F） × 2");
    expect(e.entries[1].changes).toEqual([{ label: "階段", from: "待排程", to: "備料中" }]);
  });

  it("工單負責人以員工姓名顯示", () => {
    expect(chronological[3].entries[0].changes).toEqual([
      { label: "負責人", from: "—", to: "木工師傅" },
    ]);
  });

  it("改成藤編：規格、木種、尺寸變動", () => {
    const e = chronological[4];
    expect(e.actorEmail).toBe("manager@example.com");
    expect(e.entries).toHaveLength(1);
    const [item] = e.entries;
    expect(item.title).toBe("修改品項");
    expect(item.subject).toBe("椅 · CH03 扶手椅 藤編-R（CH03-W-R） × 2");
    expect(item.changes).toEqual([
      {
        label: "規格",
        from: "CH03 扶手椅 布墊-F（CH03-W-F）",
        to: "CH03 扶手椅 藤編-R（CH03-W-R）",
      },
      { label: "木種", from: "—", to: "胡桃木" },
      { label: "尺寸", from: "—", to: "60×56×78 cm" },
    ]);
    expect(item.notes).toEqual(["工單隨品項重建（階段保留：備料中）"]);
  });

  it("改回布墊", () => {
    const [item] = chronological[5].entries;
    expect(item.changes).toEqual([
      {
        label: "規格",
        from: "CH03 扶手椅 藤編-R（CH03-W-R）",
        to: "CH03 扶手椅 布墊-F（CH03-W-F）",
      },
    ]);
  });

  it("連續改交期合併成淨變動", () => {
    const e = chronological[6];
    expect(e.rows).toHaveLength(3);
    expect(e.entries[0].changes).toEqual([
      { label: "預計交期", from: "2026/10/03", to: "2026/11/13" },
    ]);
  });
});

function row(partial: Partial<AuditRow> & Pick<AuditRow, "id" | "table_name" | "action">): AuditRow {
  return {
    happened_at: "2026-09-01T00:00:00Z",
    record_id: null,
    actor_id: null,
    actor_email: "a@example.com",
    actor_label: null,
    changed_fields: null,
    old_data: null,
    new_data: null,
    ...partial,
  };
}

function item(id: string, lineOrder: number, name: string, qty: number) {
  return {
    id,
    order_id: "o1",
    line_order: lineOrder,
    custom_name: name,
    custom_category: "桌",
    quantity: qty,
    unit_price: 1000,
  };
}

describe("buildOrderTrail：品項配對", () => {
  const empty: TrailLookups = { variants: {}, employees: {}, customers: {} };

  it("原樣重建的存檔不列出", () => {
    const events = buildOrderTrail(
      [
        row({ id: 1, table_name: "order_items", action: "DELETE", record_id: "i1", old_data: item("i1", 0, "A", 1) }),
        row({ id: 2, table_name: "order_items", action: "INSERT", record_id: "i2", new_data: item("i2", 0, "A", 1) }),
      ],
      empty,
    );
    expect(events).toEqual([]);
  });

  it("刪掉中間品項、另一項改數量時不會錯配", () => {
    const events = buildOrderTrail(
      [
        row({ id: 1, table_name: "order_items", action: "DELETE", record_id: "x", old_data: item("x", 0, "X", 1) }),
        row({ id: 2, table_name: "order_items", action: "DELETE", record_id: "y", old_data: item("y", 1, "Y", 1) }),
        row({ id: 3, table_name: "order_items", action: "DELETE", record_id: "z", old_data: item("z", 2, "Z", 1) }),
        row({ id: 4, table_name: "order_items", action: "INSERT", record_id: "x2", new_data: item("x2", 0, "X", 1) }),
        row({ id: 5, table_name: "order_items", action: "INSERT", record_id: "z2", new_data: item("z2", 1, "Z", 3) }),
      ],
      empty,
    );
    expect(events).toHaveLength(1);
    const entries = events[0].entries;
    expect(entries.map((e) => [e.title, e.subject])).toEqual([
      ["修改品項", "Z × 3"],
      ["刪除品項", "Y × 1"],
    ]);
    expect(entries[0].changes).toEqual([{ label: "數量", from: "1", to: "3" }]);
  });

  it("不同操作者或間隔過久不合併", () => {
    const events = buildOrderTrail(
      [
        row({ id: 1, table_name: "orders", action: "UPDATE", record_id: "o1", happened_at: "2026-09-01T00:00:00Z", changed_fields: ["status"], old_data: { status: "A" }, new_data: { status: "B" } }),
        row({ id: 2, table_name: "orders", action: "UPDATE", record_id: "o1", happened_at: "2026-09-01T00:00:05Z", actor_email: "b@example.com", changed_fields: ["status"], old_data: { status: "B" }, new_data: { status: "C" } }),
        row({ id: 3, table_name: "orders", action: "UPDATE", record_id: "o1", happened_at: "2026-09-01T00:05:00Z", actor_email: "b@example.com", changed_fields: ["status"], old_data: { status: "C" }, new_data: { status: "D" } }),
      ],
      empty,
    );
    expect(events).toHaveLength(3);
  });

  it("軟刪除顯示為刪除訂單", () => {
    const [e] = buildOrderTrail(
      [
        row({ id: 1, table_name: "orders", action: "UPDATE", record_id: "o1", changed_fields: ["deleted_at"], old_data: { deleted_at: null }, new_data: { deleted_at: "2026-09-01T00:00:00Z" } }),
      ],
      empty,
    );
    expect(e.entries).toEqual([{ title: "刪除訂單", tone: "delete", changes: [], notes: [] }]);
  });
});

describe("collectReferenceIds", () => {
  it("收集規格、負責人、客戶 ID", () => {
    const ids = collectReferenceIds(rows);
    expect(ids.variantIds.sort()).toEqual([FABRIC, RATTAN].sort());
    expect(ids.employeeIds).toEqual(["1c22317a-a079-4cd5-adf3-cd0f319e0366"]);
    expect(ids.customerIds).toEqual(["3847f45a-d0d8-4290-bde8-cbec7df59ea0"]);
  });
});

describe("describeActorLabel", () => {
  it("通路下單帶通路名稱", () => {
    expect(describeActorLabel("portal:c1", { c1: "某通路" })).toBe("通路下單（某通路）");
    expect(describeActorLabel("cron:weekly", {})).toBe("排程（weekly）");
    expect(describeActorLabel("", {})).toBe("系統");
  });
});
