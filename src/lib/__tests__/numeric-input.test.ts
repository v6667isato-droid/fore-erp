import { describe, expect, it } from "vitest";
import {
  formatNumericValue,
  isAllowedNumericKey,
  parseNumericText,
  sanitizeNumericText,
} from "@/lib/numeric-input";

describe("formatNumericValue", () => {
  it("0 與空值顯示為空白", () => {
    expect(formatNumericValue(0)).toBe("");
    expect(formatNumericValue(null)).toBe("");
    expect(formatNumericValue(undefined)).toBe("");
    expect(formatNumericValue(Number.NaN)).toBe("");
  });

  it("其他數值原樣顯示", () => {
    expect(formatNumericValue(1500)).toBe("1500");
    expect(formatNumericValue(2.5)).toBe("2.5");
  });
});

describe("parseNumericText", () => {
  it("空白回傳 null", () => {
    expect(parseNumericText("", false)).toBeNull();
    expect(parseNumericText("  ", true)).toBeNull();
  });

  it("整數模式截斷小數", () => {
    expect(parseNumericText("1500", false)).toBe(1500);
    expect(parseNumericText("12.9", false)).toBe(12);
  });

  it("小數模式保留小數", () => {
    expect(parseNumericText("12.5", true)).toBe(12.5);
  });

  it("無法解析回傳 null", () => {
    expect(parseNumericText("abc", false)).toBeNull();
  });
});

describe("sanitizeNumericText", () => {
  it("移除文字與千分位", () => {
    expect(sanitizeNumericText("NT$ 1,500 元", false)).toBe("1500");
    expect(sanitizeNumericText("abc", false)).toBe("");
    expect(sanitizeNumericText("1e5", false)).toBe("15");
    expect(sanitizeNumericText("-300", false)).toBe("300");
  });

  it("全形數字轉半形", () => {
    expect(sanitizeNumericText("１，５００", false)).toBe("1500");
    expect(sanitizeNumericText("１２．５", true)).toBe("12.5");
  });

  it("整數模式遇小數點截斷", () => {
    expect(sanitizeNumericText("1500.00", false)).toBe("1500");
  });

  it("小數模式只留第一個小數點", () => {
    expect(sanitizeNumericText("1.2.3", true)).toBe("1.23");
  });
});

describe("isAllowedNumericKey", () => {
  it("放行數字與功能鍵", () => {
    expect(isAllowedNumericKey("7", false)).toBe(true);
    expect(isAllowedNumericKey("Backspace", false)).toBe(true);
    expect(isAllowedNumericKey("ArrowLeft", false)).toBe(true);
    expect(isAllowedNumericKey("Tab", false)).toBe(true);
  });

  it("擋掉文字與符號", () => {
    for (const key of ["a", "e", "E", "+", "-", ",", " ", "元"]) {
      expect(isAllowedNumericKey(key, false)).toBe(false);
    }
  });

  it("小數點只在小數模式放行", () => {
    expect(isAllowedNumericKey(".", false)).toBe(false);
    expect(isAllowedNumericKey(".", true)).toBe(true);
  });
});
