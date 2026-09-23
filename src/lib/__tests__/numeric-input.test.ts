import { describe, expect, it } from "vitest";
import {
  formatNumericValue,
  isAllowedNumericKey,
  parseNumericText,
  sanitizeNumericText,
  toNumericText,
} from "@/lib/numeric-input";

const INT = {};
const DEC = { allowDecimal: true };
const NEG = { allowNegative: true };

describe("formatNumericValue", () => {
  it("0 與空值顯示為空白", () => {
    expect(formatNumericValue(0)).toBe("");
    expect(formatNumericValue(null)).toBe("");
    expect(formatNumericValue(undefined)).toBe("");
    expect(formatNumericValue(Number.NaN)).toBe("");
  });

  it("keepZero 時 0 照常顯示，空值仍空白", () => {
    expect(formatNumericValue(0, true)).toBe("0");
    expect(formatNumericValue(null, true)).toBe("");
    expect(formatNumericValue("0", true)).toBe("0");
    expect(formatNumericValue("", true)).toBe("");
  });

  it("接受字串 state", () => {
    expect(formatNumericValue("0")).toBe("");
    expect(formatNumericValue("")).toBe("");
    expect(formatNumericValue(" 12.50 ")).toBe("12.50");
    expect(formatNumericValue("abc")).toBe("");
  });

  it("其他數值原樣顯示", () => {
    expect(formatNumericValue(1500)).toBe("1500");
    expect(formatNumericValue(2.5)).toBe("2.5");
  });
});

describe("parseNumericText", () => {
  it("空白回傳 null", () => {
    expect(parseNumericText("", INT)).toBeNull();
    expect(parseNumericText("  ", DEC)).toBeNull();
  });

  it("整數模式截斷小數", () => {
    expect(parseNumericText("1500", INT)).toBe(1500);
    expect(parseNumericText("12.9", INT)).toBe(12);
  });

  it("小數模式保留小數", () => {
    expect(parseNumericText("12.5", DEC)).toBe(12.5);
  });

  it("不允許負數時負值歸 0，允許時保留", () => {
    expect(parseNumericText("-5", INT)).toBe(0);
    expect(parseNumericText("-5", NEG)).toBe(-5);
  });

  it("無法解析回傳 null", () => {
    expect(parseNumericText("abc", INT)).toBeNull();
  });
});

describe("sanitizeNumericText", () => {
  it("移除文字與千分位", () => {
    expect(sanitizeNumericText("NT$ 1,500 元", INT)).toBe("1500");
    expect(sanitizeNumericText("abc", INT)).toBe("");
    expect(sanitizeNumericText("1e5", INT)).toBe("15");
    expect(sanitizeNumericText("-300", INT)).toBe("300");
  });

  it("allowNegative 保留開頭負號（含全形）", () => {
    expect(sanitizeNumericText("-300", NEG)).toBe("-300");
    expect(sanitizeNumericText("－１，２００", NEG)).toBe("-1200");
    expect(sanitizeNumericText("NT$ -50", NEG)).toBe("50");
    expect(sanitizeNumericText("-", NEG)).toBe("");
  });

  it("全形數字轉半形", () => {
    expect(sanitizeNumericText("１，５００", INT)).toBe("1500");
    expect(sanitizeNumericText("１２．５", DEC)).toBe("12.5");
  });

  it("整數模式遇小數點截斷", () => {
    expect(sanitizeNumericText("1500.00", INT)).toBe("1500");
  });

  it("小數模式只留第一個小數點", () => {
    expect(sanitizeNumericText("1.2.3", DEC)).toBe("1.23");
  });
});

describe("isAllowedNumericKey", () => {
  it("放行數字與功能鍵", () => {
    expect(isAllowedNumericKey("7", INT)).toBe(true);
    expect(isAllowedNumericKey("Backspace", INT)).toBe(true);
    expect(isAllowedNumericKey("ArrowLeft", INT)).toBe(true);
    expect(isAllowedNumericKey("Tab", INT)).toBe(true);
  });

  it("擋掉文字與符號", () => {
    for (const key of ["a", "e", "E", "+", "-", ",", " ", "元"]) {
      expect(isAllowedNumericKey(key, INT)).toBe(false);
    }
  });

  it("負號只在 allowNegative 放行", () => {
    expect(isAllowedNumericKey("-", INT)).toBe(false);
    expect(isAllowedNumericKey("-", NEG)).toBe(true);
  });

  it("小數點只在小數模式放行", () => {
    expect(isAllowedNumericKey(".", INT)).toBe(false);
    expect(isAllowedNumericKey(".", DEC)).toBe(true);
  });
});

describe("toNumericText", () => {
  it("null 轉空字串，數值轉字串", () => {
    expect(toNumericText(null)).toBe("");
    expect(toNumericText(0)).toBe("0");
    expect(toNumericText(-12.5)).toBe("-12.5");
  });
});
