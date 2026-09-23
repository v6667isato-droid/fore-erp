import { describe, expect, it } from "vitest";
import {
  diffCustomerFields,
  findCustomerMatches,
  normalizeAddress,
  pickDefaultMatch,
  normalizeNameKey,
  phoneKeys,
  sanitizeIntakeResult,
  searchCustomers,
  surnameKey,
  type MatchableCustomer,
} from "@/lib/customer-intake";

describe("phoneKeys", () => {
  it("不同寫法的同一支手機得到相同鍵", () => {
    const expected = ["912345678"];
    expect(phoneKeys("0912-345-678")).toEqual(expected);
    expect(phoneKeys("0912 345 678")).toEqual(expected);
    expect(phoneKeys("+886 912 345 678")).toEqual(expected);
    expect(phoneKeys("+886-912-345678")).toEqual(expected);
    expect(phoneKeys("０９１２３４５６７８")).toEqual(expected);
  });

  it("市話含區碼、括號、分機", () => {
    expect(phoneKeys("(06)234-5678")).toEqual(["062345678"]);
    expect(phoneKeys("06-2345678#12")).toEqual(["062345678"]);
    expect(phoneKeys("02-2345-6789 分機 301")).toEqual(["223456789"]);
    expect(phoneKeys("+886-2-23456789")).toEqual(["223456789"]);
  });

  it("一欄多支號碼", () => {
    expect(phoneKeys("0912-345-678 / 06-2345678")).toEqual(["912345678", "062345678"]);
    expect(phoneKeys("0912345678 0922333444")).toEqual(["912345678", "922333444"]);
  });

  it("太短或空白不算", () => {
    expect(phoneKeys("2345678")).toEqual([]);
    expect(phoneKeys("")).toEqual([]);
    expect(phoneKeys(null)).toEqual([]);
  });
});

describe("normalizeNameKey / normalizeAddress", () => {
  it("去掉稱謂與公司型態、全形半形與臺台統一", () => {
    expect(normalizeNameKey("王小明 先生")).toBe("王小明");
    expect(normalizeNameKey("陳小姐")).toBe("陳");
    expect(normalizeNameKey("木木設計有限公司")).toBe("木木設計");
    expect(normalizeNameKey("ＦＯＲＥ Studio")).toBe("forestudio");
  });

  it("地址去掉郵遞區號、台灣前綴與空白", () => {
    expect(normalizeAddress("701 臺南市東區大學路 1 號 5 樓")).toBe(normalizeAddress("台南市東區大學路1號5樓"));
    expect(normalizeAddress("台灣 70101 台南市東區大學路1號5樓")).toBe(normalizeAddress("台南市東區大學路1號5樓"));
  });
});

const customers: MatchableCustomer[] = [
  {
    id: "c1",
    name: "王小明",
    phone: "0912-345-678",
    delivery_address: "台南市東區大學路1號5樓",
  },
  { id: "c2", name: "木木設計", company: "木木設計有限公司", tax_id: "12345678" },
  { id: "c3", name: "陳小姐", phone: "0933-111-222", line_id: "@chen.home" },
  { id: "c4", name: "王小明設計", alias: "小明" },
  { id: "c5", name: "林大華", ig_account: "lin.dahua" },
];

describe("findCustomerMatches", () => {
  it("電話相同為確定比對，排第一", () => {
    const res = findCustomerMatches({ name: "王先生", phone: "+886 912 345 678" }, customers);
    expect(res[0].customer.id).toBe("c1");
    expect(res[0].strong).toBe(true);
    expect(res[0].reasons).toContain("phone");
  });

  it("統編相同", () => {
    const res = findCustomerMatches({ name: "某某", tax_id: "12345678" }, customers);
    expect(res.map((m) => m.customer.id)).toEqual(["c2"]);
    expect(res[0].reasons).toEqual(["tax_id"]);
  });

  it("LINE ID、IG 忽略 @ 與大小寫", () => {
    expect(findCustomerMatches({ line_id: "Chen.Home" }, customers)[0].customer.id).toBe("c3");
    expect(findCustomerMatches({ ig_account: "@LIN.dahua" }, customers)[0].customer.id).toBe("c5");
    expect(
      findCustomerMatches({ ig_account: "https://www.instagram.com/lin.dahua" }, customers)[0].customer.id
    ).toBe("c5");
  });

  it("名稱相同／相近只算可能，名稱相同分數較高", () => {
    const res = findCustomerMatches({ name: "王小明" }, customers);
    expect(res.map((m) => m.customer.id)).toEqual(["c1", "c4"]);
    expect(res[0].reasons).toEqual(["name"]);
    expect(res[1].reasons).toEqual(["name_partial"]);
    expect(res.every((m) => !m.strong)).toBe(true);
  });

  it("公司名稱去掉型態後比對", () => {
    const res = findCustomerMatches({ company: "木木設計股份有限公司" }, customers);
    expect(res[0].customer.id).toBe("c2");
    expect(res[0].reasons).toEqual(["name"]);
  });

  it("只有姓氏加稱謂不算名稱相同，改列為同姓", () => {
    const res = findCustomerMatches({ name: "陳小姐" }, customers);
    expect(res.map((m) => m.customer.id)).toEqual(["c3"]);
    expect(res[0].reasons).toEqual(["surname"]);
    expect(res[0].strong).toBe(false);
  });

  it("地址相同", () => {
    const res = findCustomerMatches({ delivery_address: "701臺南市東區大學路1號5樓" }, customers);
    expect(res[0].customer.id).toBe("c1");
    expect(res[0].reasons).toEqual(["address"]);
  });

  it("多個條件分數相加", () => {
    const res = findCustomerMatches(
      { name: "王小明", phone: "0912345678", delivery_address: "台南市東區大學路1號5樓" },
      customers
    );
    expect(res[0].customer.id).toBe("c1");
    expect(res[0].reasons).toEqual(["phone", "name", "address"]);
  });

  it("沒有任何線索時不回傳", () => {
    expect(findCustomerMatches({}, customers)).toEqual([]);
    expect(findCustomerMatches({ name: "完全不相干" }, customers)).toEqual([]);
  });
});

describe("同姓比對", () => {
  const list: MatchableCustomer[] = [
    { id: "t1", name: "曾建華", phone: "0911-111-111" },
    { id: "t2", name: "曾小姐" },
    { id: "t3", name: "王曾", contact_person: "曾美玲" },
    { id: "t4", name: "木曾設計" },
    { id: "t5", name: "林大華" },
  ];

  it("surnameKey：姓＋稱謂或單一字", () => {
    expect(surnameKey("曾先生")).toBe("曾");
    expect(surnameKey("歐陽小姐")).toBe("歐陽");
    expect(surnameKey("曾")).toBe("曾");
    expect(surnameKey("曾建華")).toBe("");
    expect(surnameKey("Mr. Tseng")).toBe("");
    expect(surnameKey(null)).toBe("");
  });

  it("「曾先生」列出姓曾的客戶（名稱或聯絡人），名稱中間有曾字的不算", () => {
    const res = findCustomerMatches({ name: "曾先生", contact_person: "曾先生" }, list, 10);
    expect(res.map((m) => m.customer.id)).toEqual(["t1", "t2", "t3"]);
    expect(res.every((m) => m.reasons.join() === "surname" && !m.strong)).toBe(true);
    // 同姓不自動選取
    expect(pickDefaultMatch(res, {})).toBeNull();
  });

  it("主檔記「曾小姐」、訊息是完整姓名「曾美華」也列為同姓", () => {
    const res = findCustomerMatches({ name: "曾美華" }, list, 10);
    expect(res.map((m) => m.customer.id)).toContain("t2");
  });

  it("已有電話相同時不再標同姓", () => {
    const res = findCustomerMatches({ name: "曾先生", phone: "0911111111" }, list, 10);
    expect(res[0]).toMatchObject({ reasons: ["phone"], strong: true });
  });
});

describe("searchCustomers", () => {
  const list: MatchableCustomer[] = [
    { id: "s1", name: "曾建華", phone: "0911-222-333", delivery_address: "臺南市東區大學路1號" },
    { id: "s2", name: "木木設計", company: "木木設計有限公司", tax_id: "12345678", notes: "喜歡胡桃木" },
    { id: "s3", name: "陳小姐", contact_person: "曾美玲", line_id: "@chen.home" },
  ];

  it("比對名稱、公司、統編、地址（臺台不分）、備註、LINE", () => {
    expect(searchCustomers("木木", list).map((c) => c.id)).toEqual(["s2"]);
    expect(searchCustomers("12345678", list).map((c) => c.id)).toEqual(["s2"]);
    expect(searchCustomers("台南市東區", list).map((c) => c.id)).toEqual(["s1"]);
    expect(searchCustomers("胡桃木", list).map((c) => c.id)).toEqual(["s2"]);
    expect(searchCustomers("chen.home", list).map((c) => c.id)).toEqual(["s3"]);
  });

  it("電話忽略 - 與空白", () => {
    expect(searchCustomers("0911222", list).map((c) => c.id)).toEqual(["s1"]);
    expect(searchCustomers("222 333", list).map((c) => c.id)).toEqual(["s1"]);
  });

  it("姓＋稱謂列出同姓（含聯絡人）", () => {
    expect(searchCustomers("曾先生", list).map((c) => c.id)).toEqual(["s1", "s3"]);
    expect(searchCustomers("曾", list).map((c) => c.id)).toEqual(["s1", "s3"]);
  });

  it("空白關鍵字不回傳、筆數有上限", () => {
    expect(searchCustomers("  ", list)).toEqual([]);
    expect(searchCustomers("曾", list, 1)).toHaveLength(1);
  });
});

describe("pickDefaultMatch", () => {
  it("電話等確定相同 → 選分數最高者", () => {
    const matches = findCustomerMatches({ name: "王先生", phone: "0912345678" }, customers);
    expect(pickDefaultMatch(matches, { phone: "0912345678" })?.id).toBe("c1");
  });

  it("只有名稱：恰好一位同名客戶 → 選他（「蕭雅文要開新訂單」）", () => {
    const list: MatchableCustomer[] = [
      { id: "x1", name: "蕭雅文", phone: "0955-111-222" },
      { id: "x2", name: "蕭雅文設計" },
    ];
    const matches = findCustomerMatches({ name: "蕭雅文" }, list);
    expect(pickDefaultMatch(matches, {})?.id).toBe("x1");
  });

  it("同名兩位以上、或電話跟主檔不同 → 不自動選", () => {
    const twins: MatchableCustomer[] = [
      { id: "a", name: "林小美" },
      { id: "b", name: "林小美" },
    ];
    expect(pickDefaultMatch(findCustomerMatches({ name: "林小美" }, twins), {})).toBeNull();

    const one: MatchableCustomer[] = [{ id: "a", name: "林小美", phone: "0911-000-111" }];
    expect(pickDefaultMatch(findCustomerMatches({ name: "林小美", phone: "0922333444" }, one), { phone: "0922333444" }))
      .toBeNull();
  });

  it("只有名稱相近不自動選", () => {
    expect(pickDefaultMatch(findCustomerMatches({ name: "王小明" }, [{ id: "a", name: "王小明設計" }]), {})).toBeNull();
    expect(pickDefaultMatch([], {})).toBeNull();
  });
});

describe("diffCustomerFields", () => {
  it("主檔空白補上、不同值列為更新、相同值略過", () => {
    const updates = diffCustomerFields(
      { phone: "0912-345-678", delivery_address: "台南市東區大學路1號5樓", tax_id: null, has_elevator: null },
      {
        phone: "0912345678",
        delivery_address: "台南市北區公園路2號",
        tax_id: "12345678",
        has_elevator: true,
      }
    );
    expect(updates).toEqual([
      {
        field: "delivery_address",
        kind: "change",
        current: "台南市東區大學路1號5樓",
        next: "台南市北區公園路2號",
      },
      { field: "has_elevator", kind: "fill", current: null, next: true },
      { field: "tax_id", kind: "fill", current: null, next: "12345678" },
    ]);
  });

  it("聯絡人只有姓＋稱謂時不建議寫回主檔", () => {
    expect(diffCustomerFields({ contact_person: null }, { contact_person: "曾先生" })).toEqual([]);
    expect(diffCustomerFields({ contact_person: null }, { contact_person: "曾建華" })).toEqual([
      { field: "contact_person", kind: "fill", current: null, next: "曾建華" },
    ]);
  });

  it("主檔記多支電話，新號碼已在其中時不列", () => {
    expect(diffCustomerFields({ phone: "0912-345-678 / 06-2345678" }, { phone: "06-2345678" })).toEqual([]);
  });

  it("AI 推斷的來源／種類只補空白，不建議覆蓋", () => {
    expect(
      diffCustomerFields({ source: "親友", customer_type: null }, { source: "網路", customer_type: "一般民眾" })
    ).toEqual([{ field: "customer_type", kind: "fill", current: null, next: "一般民眾" }]);
  });

  it("客情備註附加在後，已包含則略過", () => {
    expect(diffCustomerFields({ notes: "喜歡胡桃木" }, { notes: "預算 5 萬" })).toEqual([
      { field: "notes", kind: "append", current: "喜歡胡桃木", next: "喜歡胡桃木\n預算 5 萬" },
    ]);
    expect(diffCustomerFields({ notes: "喜歡胡桃木，預算 5 萬" }, { notes: "預算5萬" })).toEqual([]);
  });

  it("電梯：主檔 false 視同未填（DB 預設值），有電梯才補上", () => {
    expect(diffCustomerFields({ has_elevator: false }, { has_elevator: true })).toEqual([
      { field: "has_elevator", kind: "fill", current: null, next: true },
    ]);
    expect(diffCustomerFields({ has_elevator: false }, { has_elevator: false })).toEqual([]);
    expect(diffCustomerFields({ has_elevator: true }, { has_elevator: false })).toEqual([
      { field: "has_elevator", kind: "change", current: true, next: false },
    ]);
  });
});

describe("sanitizeIntakeResult", () => {
  it("選項外的值、格式不符的統編與日期改 null，數量至少 1", () => {
    const res = sanitizeIntakeResult({
      customer: {
        name: "  王小明 ",
        phone: "0912345678",
        tax_id: "１２３４-５６７８",
        source: "路過",
        customer_type: "一般民眾",
        contact_method: "LINE",
        has_elevator: "yes",
        notes: "",
      },
      order: {
        items: [
          { name: "胡桃木餐桌", category: "桌", quantity: 1, dimension_w: 180, dimension_d: 90 },
          { name: "餐椅", category: "沙發", quantity: 0 },
          { name: "  ", quantity: 3 },
          { name: "長凳", quantity: "2.4" },
        ],
        expected_delivery_date: "2026-02-30",
      },
    });
    expect(res.customer).toMatchObject({
      name: "王小明",
      tax_id: "12345678",
      source: null,
      customer_type: "一般民眾",
      contact_method: "line",
      has_elevator: null,
      notes: null,
    });
    expect(res.order.items).toHaveLength(3);
    expect(res.order.items[0]).toMatchObject({ name: "胡桃木餐桌", category: "桌", dimension_w: 180, dimension_h: null });
    expect(res.order.items[1]).toMatchObject({ name: "餐椅", category: null, quantity: 1 });
    expect(res.order.items[2].quantity).toBe(2);
    expect(res.order.expected_delivery_date).toBeNull();
  });

  it("聯絡方式大小寫不同也能對上既有選項值", () => {
    expect(sanitizeIntakeResult({ customer: { contact_method: "bingxueline" } }).customer.contact_method).toBe(
      "bingxueLine"
    );
  });

  it("壞掉的輸入不丟例外", () => {
    const res = sanitizeIntakeResult(null);
    expect(res.customer.name).toBeNull();
    expect(res.order.items).toEqual([]);
    expect(sanitizeIntakeResult({ order: { items: "x", expected_delivery_date: "2026-10-31" } }).order).toEqual({
      items: [],
      expected_delivery_date: "2026-10-31",
      notes: null,
      discount_percent: null,
      discount_amount: null,
      deposit_requested: false,
      deposit_percent: null,
      deposit_amount: null,
      shipping_fee: null,
    });
  });

  it("品項編號、訂製、單價；折扣、訂金、運費", () => {
    const res = sanitizeIntakeResult({
      order: {
        items: [
          { name: "CB05 訂製款", product_code: " CB05 ", custom_made: true, unit_price: 52000.4, seat_height_cm: 0 },
          { name: "餐椅", custom_made: "yes", unit_price: -1 },
        ],
        discount_percent: 5,
        discount_amount: 0,
        deposit_requested: true,
        deposit_percent: 150,
        shipping_fee: "1500",
      },
    });
    expect(res.order.items[0]).toMatchObject({
      product_code: "CB05",
      custom_made: true,
      unit_price: 52000,
      seat_height_cm: null,
    });
    expect(res.order.items[1]).toMatchObject({ custom_made: false, unit_price: null });
    expect(res.order).toMatchObject({
      discount_percent: 5,
      discount_amount: null,
      deposit_requested: true,
      deposit_percent: null,
      shipping_fee: 1500,
    });
  });

  it("有寫訂金比例或金額也算要求帶入訂金", () => {
    expect(sanitizeIntakeResult({ order: { deposit_percent: 30 } }).order.deposit_requested).toBe(true);
    expect(sanitizeIntakeResult({ order: { deposit_amount: 10000 } }).order.deposit_requested).toBe(true);
  });
});
