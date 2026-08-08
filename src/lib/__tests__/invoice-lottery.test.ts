import { describe, expect, it } from "vitest";
import {
  checkInvoiceLottery,
  evaluateInvoiceLottery,
  invoiceLotteryDigits,
  lotteryDrawDate,
  lotteryPeriodLabel,
  lotteryPeriodOfDate,
  parseLotteryFeed,
  type InvoiceLotteryDraw,
} from "@/lib/invoice-lottery";

/** 115年 05~06月（財政部公布號碼） */
const DRAW: InvoiceLotteryDraw = {
  period: "2026-05",
  label: "115年 05~06月",
  special_prize: "38548029",
  grand_prize: "10138845",
  first_prizes: ["24121106", "28589937", "83663333"],
  sixth_extra_prizes: [],
};

describe("invoiceLotteryDigits（取對獎的 8 碼）", () => {
  it("接受 XX-12345678 與純數字", () => {
    expect(invoiceLotteryDigits("AB-24121106")).toBe("24121106");
    expect(invoiceLotteryDigits("24121106")).toBe("24121106");
  });

  it("碼數不足或缺漏回傳 null", () => {
    expect(invoiceLotteryDigits("AB-1234567")).toBeNull();
    expect(invoiceLotteryDigits("")).toBeNull();
    expect(invoiceLotteryDigits(null)).toBeNull();
  });
});

describe("lotteryPeriodOfDate（發票日期→期別）", () => {
  it("兩個月一期，以奇數月起算", () => {
    expect(lotteryPeriodOfDate("2026-05-01")).toBe("2026-05");
    expect(lotteryPeriodOfDate("2026-06-30")).toBe("2026-05");
    expect(lotteryPeriodOfDate("2026-01-15")).toBe("2026-01");
    expect(lotteryPeriodOfDate("2026-12-31")).toBe("2026-11");
  });

  it("日期無效回傳 null", () => {
    expect(lotteryPeriodOfDate(null)).toBeNull();
    expect(lotteryPeriodOfDate("2026")).toBeNull();
  });
});

describe("lotteryPeriodLabel／lotteryDrawDate", () => {
  it("期別轉民國標籤", () => {
    expect(lotteryPeriodLabel("2026-05")).toBe("115年 05~06月");
    expect(lotteryPeriodLabel("2025-11")).toBe("114年 11~12月");
  });

  it("開獎日為期別結束後次月 25 日（跨年進位）", () => {
    expect(lotteryDrawDate("2026-05")).toBe("2026-07-25");
    expect(lotteryDrawDate("2026-11")).toBe("2027-01-25");
  });
});

describe("checkInvoiceLottery（各獎項比對）", () => {
  it("8 碼全對特別獎／特獎", () => {
    expect(checkInvoiceLottery("AB-38548029", DRAW)?.level).toBe("special");
    expect(checkInvoiceLottery("AB-10138845", DRAW)?.level).toBe("grand");
  });

  it("末幾碼與頭獎相同對應頭獎至六獎", () => {
    expect(checkInvoiceLottery("AB-24121106", DRAW)?.level).toBe("first"); // 全 8 碼
    expect(checkInvoiceLottery("AB-94121106", DRAW)?.level).toBe("second"); // 末 7
    expect(checkInvoiceLottery("AB-99121106", DRAW)?.level).toBe("third"); // 末 6
    expect(checkInvoiceLottery("AB-99921106", DRAW)?.level).toBe("fourth"); // 末 5
    expect(checkInvoiceLottery("AB-99991106", DRAW)?.level).toBe("fifth"); // 末 4
    expect(checkInvoiceLottery("AB-99999106", DRAW)?.level).toBe("sixth"); // 末 3
  });

  it("多組頭獎取相符碼數最多者", () => {
    // 末 3 碼對 24121106，但末 4 碼對 83663333
    expect(checkInvoiceLottery("AB-99993333", DRAW)?.level).toBe("fifth");
  });

  it("末兩碼相同不中獎", () => {
    expect(checkInvoiceLottery("AB-99999906", DRAW)).toBeNull();
  });

  it("增開六獎比對末 3 碼", () => {
    const draw = { ...DRAW, sixth_extra_prizes: ["888"] };
    expect(checkInvoiceLottery("AB-12345888", draw)?.level).toBe("sixth_extra");
    expect(checkInvoiceLottery("AB-12345889", draw)).toBeNull();
  });
});

describe("evaluateInvoiceLottery（含開獎狀態）", () => {
  const draws = new Map([[DRAW.period, DRAW]]);

  it("已開獎：中獎／未中獎", () => {
    expect(evaluateInvoiceLottery("AB-38548029", "2026-06-10", draws, "2026-08-08")).toMatchObject({
      state: "won",
    });
    expect(evaluateInvoiceLottery("AB-11111111", "2026-06-10", draws, "2026-08-08")).toMatchObject({
      state: "lost",
    });
  });

  it("尚未開獎的期別回 pending 並附開獎日", () => {
    expect(evaluateInvoiceLottery("AB-11111111", "2026-07-10", draws, "2026-08-08")).toMatchObject({
      state: "pending",
      drawDate: "2026-09-25",
    });
  });

  it("已開獎但本機沒號碼回 no_data", () => {
    expect(evaluateInvoiceLottery("AB-11111111", "2026-03-10", draws, "2026-08-08")).toMatchObject({
      state: "no_data",
      period: "2026-03",
    });
  });

  it("號碼或日期不完整回 unknown", () => {
    expect(evaluateInvoiceLottery("", "2026-06-10", draws, "2026-08-08")).toMatchObject({ state: "unknown" });
    expect(evaluateInvoiceLottery("AB-38548029", null, draws, "2026-08-08")).toMatchObject({ state: "unknown" });
  });
});

describe("parseLotteryFeed（財政部 RSS）", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title><![CDATA[統一發票中獎號碼]]></title>
    <item>
      <title><![CDATA[115年 05~06月]]></title>
      <link><![CDATA[https://www.etax.nat.gov.tw/etw-main/ETW183W2_11505]]></link>
      <description><![CDATA[<p>特別獎：38548029</p><p>特獎：10138845</p><p>頭獎：24121106、28589937、83663333</p>]]></description>
    </item>
    <item>
      <title><![CDATA[114年 11~12月]]></title>
      <link><![CDATA[https://www.etax.nat.gov.tw/etw-main/ETW183W2_11411]]></link>
      <description><![CDATA[<p>特別獎：97023797</p><p>特獎：00507588</p><p>頭獎：92377231、05232592、78125249</p><p>增開六獎：123、456</p>]]></description>
    </item>
  </channel>
</rss>`;

  it("解析期別與各獎號碼", () => {
    const draws = parseLotteryFeed(xml);
    expect(draws).toHaveLength(2);
    expect(draws[0]).toMatchObject({
      period: "2026-05",
      label: "115年 05~06月",
      special_prize: "38548029",
      grand_prize: "10138845",
      first_prizes: ["24121106", "28589937", "83663333"],
      sixth_extra_prizes: [],
    });
    expect(draws[1]).toMatchObject({ period: "2025-11", sixth_extra_prizes: ["123", "456"] });
  });

  it("格式不符（缺特別獎／特獎）不產生資料", () => {
    expect(parseLotteryFeed("<rss><channel></channel></rss>")).toHaveLength(0);
    expect(
      parseLotteryFeed(
        "<item><title><![CDATA[115年 05~06月]]></title><description><![CDATA[<p>頭獎：24121106</p>]]></description></item>",
      ),
    ).toHaveLength(0);
  });
});
