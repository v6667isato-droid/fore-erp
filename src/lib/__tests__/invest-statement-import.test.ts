import { describe, expect, it } from "vitest";
import { parseStatementDate, parseStatementRows } from "@/lib/invest-statement-import";

const HEADER = [
  "成交日", "商品", "買賣", "數量", "成交價", "價金", "手續費", "交易稅", "應付金額", "應收金額",
  "融資金額", "保證金", "利息", "融券手續費", "委託單號", "幣別", "總投入",
];

describe("parseStatementRows", () => {
  it("券商買賣對帳單：略過合計列，依標題對應欄位", () => {
    const rows = [
      HEADER,
      ["合計", null, null, 2000, null, 200_000, 285, 100, 100_142, 99_815, null, null, null, null, null, null, 285],
      ["2024/05/07", "0050 元大台灣50", "現買", 1000, 100, 100_000, 142, 0, 100_142, 0, 0, 0, 0, 0, "IY356", "TWD", null],
      ["2024/05/08", "00865B 國泰US短期公債", "現賣", 1000, 100, 100_000, 143, 0, 0, 99_857, 0, 0, 0, 0, "WU079", "TWD", null],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ];
    const r = parseStatementRows(rows);
    expect(r.headerFound).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.trades).toEqual([
      {
        row: 3,
        trade_date: "2024-05-07",
        symbol: "0050",
        name: "元大台灣50",
        side: "buy",
        quantity: 1000,
        price: 100,
        amount: 100_000,
        fee: 142,
        tax: 0,
        net_amount: 100_142,
        currency: "TWD",
        order_no: "IY356",
        dedupe_key: "2024-05-07|IY356|0050|buy|1000|100",
      },
      {
        row: 4,
        trade_date: "2024-05-08",
        symbol: "00865B",
        name: "國泰US短期公債",
        side: "sell",
        quantity: 1000,
        price: 100,
        amount: 100_000,
        fee: 143,
        tax: 0,
        net_amount: 99_857,
        currency: "TWD",
        order_no: "WU079",
        dedupe_key: "2024-05-08|WU079|00865B|sell|1000|100",
      },
    ]);
  });

  it("標題不在第一列、欄位順序不同、數字含千分位也能讀", () => {
    const r = parseStatementRows([
      ["證券買賣對帳單"],
      [],
      ["委託單號", "成交日期", "股票代號", "股票名稱", "買賣別", "成交股數", "成交價格（元）", "手續費"],
      ["A1", "113/08/02", "2330", "台積電", "買進", "1,000", "927.5", "1,321"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.trades[0]).toMatchObject({
      trade_date: "2024-08-02",
      symbol: "2330",
      name: "台積電",
      side: "buy",
      quantity: 1000,
      price: 927.5,
      amount: 927_500,
      fee: 1321,
      net_amount: 928_821,
      order_no: "A1",
    });
  });

  it("沒有應收金額時，賣出淨額＝價金－手續費－交易稅", () => {
    const r = parseStatementRows([
      ["成交日", "商品", "買賣", "數量", "成交價", "價金", "手續費", "交易稅"],
      ["2024/09/25", "2330 台積電", "現賣", 10, 999, 9990, 14, 29],
    ]);
    expect(r.trades[0].net_amount).toBe(9947);
  });

  it("同一份對帳單裡完全相同的兩筆成交都保留，dedupe_key 加序號", () => {
    const row = ["2024/09/04", "2330 台積電", "現買", 10, 895, 8950, 12, 0, 8962, 0];
    const r = parseStatementRows([HEADER.slice(0, 10), row, row]);
    expect(r.trades.map((t) => t.dedupe_key)).toEqual([
      "2024-09-04||2330|buy|10|895",
      "2024-09-04||2330|buy|10|895#2",
    ]);
  });

  it("融資融券與無法辨識的列列為錯誤，不中斷其他列", () => {
    const r = parseStatementRows([
      HEADER.slice(0, 5),
      ["2024/01/02", "2330 台積電", "資買", 1000, 600],
      ["2024/13/02", "2330 台積電", "現買", 1000, 600],
      ["2024/01/03", "台積電", "現買", 1000, 600],
      ["2024/01/04", "2330 台積電", "配股", 1000, 600],
      ["2024/01/05", "2330 台積電", "現買", 0, 600],
      ["2024/01/06", "2330 台積電", "現買", 1000, 600],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.errors[0].message).toContain("融資融券");
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].trade_date).toBe("2024-01-06");
  });

  it("找不到標題列時回 headerFound=false", () => {
    expect(parseStatementRows([["日期", "摘要", "金額"]]).headerFound).toBe(false);
  });
});

describe("parseStatementDate", () => {
  it("各種日期格式", () => {
    expect(parseStatementDate("2024/05/07")).toBe("2024-05-07");
    expect(parseStatementDate("2024-5-7")).toBe("2024-05-07");
    expect(parseStatementDate("113/05/07")).toBe("2024-05-07");
    expect(parseStatementDate("2024年5月7日")).toBe("2024-05-07");
    expect(parseStatementDate(new Date(Date.UTC(2024, 4, 7)))).toBe("2024-05-07");
    expect(parseStatementDate(45419)).toBe("2024-05-07");
    expect(parseStatementDate("2024/02/30")).toBeNull();
    expect(parseStatementDate("合計")).toBeNull();
  });
});
