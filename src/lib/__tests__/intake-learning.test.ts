import { describe, expect, it } from "vitest";
import type { IntakeCustomer } from "@/lib/customer-intake";
import {
  diffIntakeCustomer,
  diffIntakeOrder,
  formatDimensions,
  formatRulesForPrompt,
  mentionedInText,
  MAX_PROMPT_RULES,
  type IntakeOrderSnapshot,
} from "@/lib/intake-learning";

const TEXT = `曾先生開立新訂單
cb05 訂製款 尺寸w60 d45 h100 煙燻白橡木，交期約12月30
製作費用為41,000，木質展覽優惠95%=38950，帶入訂金
品項備註
層板可自由調整`;

function customer(partial: Partial<IntakeCustomer>): IntakeCustomer {
  return {
    name: null,
    contact_person: null,
    phone: null,
    delivery_address: null,
    has_elevator: null,
    company: null,
    tax_id: null,
    brand_name: null,
    line_id: null,
    ig_account: null,
    source: null,
    customer_type: null,
    contact_method: null,
    notes: null,
    ...partial,
  };
}

describe("mentionedInText", () => {
  it("文字忽略大小寫與空白、數字忽略千分位", () => {
    expect(mentionedInText("CB05", TEXT)).toBe(true);
    expect(mentionedInText("層板可自由調整", TEXT)).toBe(true);
    expect(mentionedInText("41000", TEXT)).toBe(true);
    expect(mentionedInText("38950", TEXT)).toBe(true);
    // 「95%」裡的 5 不算提到 5
    expect(mentionedInText("5", TEXT)).toBe(false);
    expect(mentionedInText("0912345678", TEXT)).toBe(false);
  });
});

describe("diffIntakeCustomer", () => {
  it("推斷型欄位（客戶來源）改了就列入", () => {
    const diffs = diffIntakeCustomer(
      TEXT,
      customer({ name: "曾先生", source: null }),
      customer({ name: "曾先生", source: "展覽(木質生活)" })
    );
    expect(diffs).toEqual([{ field: "客戶來源", before: null, after: "展覽(木質生活)" }]);
  });

  it("AI 留白、員工例行補上客戶種類／聯絡方式：訊息沒有相關字眼就不學", () => {
    expect(
      diffIntakeCustomer(TEXT, customer({}), customer({ customer_type: "一般民眾", contact_method: "line" }))
    ).toEqual([]);
    expect(
      diffIntakeCustomer("室內設計公司 LINE 詢價", customer({}), customer({ customer_type: "室內設計師", contact_method: "line" }))
    ).toEqual([
      { field: "客戶種類", before: null, after: "室內設計師" },
      { field: "聯絡方式", before: null, after: "line" },
    ]);
  });

  it("AI 填錯推斷型欄位一定學", () => {
    expect(
      diffIntakeCustomer(TEXT, customer({ customer_type: "室內設計師" }), customer({ customer_type: "一般民眾" }))
    ).toEqual([{ field: "客戶種類", before: "室內設計師", after: "一般民眾" }]);
  });

  it("員工補上訊息裡沒有的電話不算解析錯誤", () => {
    expect(diffIntakeCustomer(TEXT, customer({}), customer({ phone: "0912-345-678" }))).toEqual([]);
  });

  it("相同值不同寫法不算修正；清空 AI 多抓的值要列入", () => {
    expect(
      diffIntakeCustomer("王小明 0912345678", customer({ phone: "0912345678" }), customer({ phone: "0912-345-678" }))
    ).toEqual([]);
    expect(diffIntakeCustomer(TEXT, customer({ brand_name: "木質展覽" }), customer({}))).toEqual([
      { field: "品牌名稱", before: "木質展覽", after: null },
    ]);
  });
});

const baseDraft: IntakeOrderSnapshot = {
  items: [
    {
      ref: "item-intake-0",
      product: "CB05-C",
      quantity: 1,
      unit_price: 41000,
      wood_type: "煙燻白橡木",
      dimensions: "60×45×100",
      notes: "煙燻白橡木，層板可自由調整",
    },
  ],
  expected_delivery_date: "2026-12-30",
  discount_percent: 5,
  deposit_percent: 50,
  shipping_fee: null,
  notes: null,
};

describe("diffIntakeOrder", () => {
  it("沒有修改回傳空陣列（不呼叫 AI）", () => {
    expect(diffIntakeOrder(TEXT, baseDraft, structuredClone(baseDraft))).toEqual([]);
  });

  it("備註改成訊息裡的原文 → 列入", () => {
    const final = structuredClone(baseDraft);
    final.items[0].notes = "層板可自由調整";
    expect(diffIntakeOrder(TEXT, baseDraft, final)).toEqual([
      { field: "品項1（CB05-C）備註", before: "煙燻白橡木，層板可自由調整", after: "層板可自由調整" },
    ]);
  });

  it("議價改成訊息沒有的價格、加上訊息沒有的運費 → 不列入", () => {
    const final = structuredClone(baseDraft);
    final.items[0].unit_price = 40000;
    final.shipping_fee = 1500;
    expect(diffIntakeOrder(TEXT, baseDraft, final)).toEqual([]);
  });

  it("單價改成訊息裡的另一個數字、折扣與品項對應改了 → 列入", () => {
    const draft = structuredClone(baseDraft);
    draft.items[0].unit_price = 38950;
    draft.items[0].product = "系列：CB05 電視櫃/邊櫃 Flow（未選規格）";
    draft.discount_percent = null;
    const diffs = diffIntakeOrder(TEXT, draft, baseDraft);
    expect(diffs.map((d) => d.field)).toEqual(["品項1（系列：CB05 電視櫃/邊櫃 Flow（未選規格））品項", "品項1（系列：CB05 電視櫃/邊櫃 Flow（未選規格））單價", "折扣 %"]);
  });

  it("交期、折扣、訂金：AI 留白時看訊息有沒有提到", () => {
    const blank: IntakeOrderSnapshot = {
      ...structuredClone(baseDraft),
      expected_delivery_date: null,
      discount_percent: null,
      deposit_percent: null,
    };
    // 訊息有「12月30」「優惠95%」「帶入訂金」→ 都算 AI 漏抓
    expect(diffIntakeOrder(TEXT, blank, baseDraft).map((d) => d.field)).toEqual(["希望交期", "折扣 %", "訂金比例 %"]);
    // 訊息完全沒提到 → 員工自己加的，不學
    const plain = "曾先生 CB05 訂製款 41000";
    expect(diffIntakeOrder(plain, blank, { ...baseDraft, expected_delivery_date: "2026-11-15" })).toEqual([]);
  });

  it("刪除品項一定列入；新增品項只在訊息有提到時列入", () => {
    const final: IntakeOrderSnapshot = {
      ...structuredClone(baseDraft),
      items: [
        { ref: "item-new-1", product: "CB05-W-180", quantity: 1, unit_price: 65000, wood_type: null, dimensions: null, notes: null },
        { ref: "item-new-2", product: "TB01-O-W180D85", quantity: 1, unit_price: 50000, wood_type: null, dimensions: null, notes: null },
      ],
    };
    expect(diffIntakeOrder(TEXT, baseDraft, final)).toEqual([
      { field: "品項1（CB05-C）", before: "有此品項", after: "員工刪除" },
      { field: "新增品項", before: null, after: "CB05-W-180" },
    ]);
  });
});

describe("formatDimensions / formatRulesForPrompt", () => {
  it("尺寸字串", () => {
    expect(formatDimensions(60, 45, 100)).toBe("60×45×100");
    expect(formatDimensions(180, null, 0)).toBe("180×—×—");
    expect(formatDimensions(null, null, null)).toBeNull();
  });

  it("規則段落：沒有規則回傳空字串、超過上限只取前面", () => {
    expect(formatRulesForPrompt([])).toBe("");
    const out = formatRulesForPrompt(["『製作費用』是品項單價", " "]);
    expect(out).toContain("- 『製作費用』是品項單價");
    expect(out.match(/^- /gm)).toHaveLength(1);
    const many = formatRulesForPrompt(Array.from({ length: MAX_PROMPT_RULES + 5 }, (_, i) => `規則${i}`));
    expect(many.match(/^- /gm)).toHaveLength(MAX_PROMPT_RULES);
  });
});
