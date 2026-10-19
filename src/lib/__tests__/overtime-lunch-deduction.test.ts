import { describe, expect, it } from "vitest";
import {
  computeOvertimeNetHours,
  isOvertimeLunchDeducted,
  overtimeCoversLunch,
} from "@/lib/employee-overtime-requests";

describe("加班申報：扣除午休", () => {
  it("假日 09:00–17:00 中間休息 → 勾選扣午休計 7 小時", () => {
    expect(computeOvertimeNetHours("09:00", "17:00", true)).toBe(7);
  });

  it("取消勾選（中午沒休息）→ 照起訖計 8 小時", () => {
    expect(computeOvertimeNetHours("09:00", "17:00", false)).toBe(8);
  });

  it("下班後加班不涵蓋午休，即使勾選也不扣", () => {
    expect(overtimeCoversLunch("18:00", "20:00")).toBe(false);
    expect(computeOvertimeNetHours("18:00", "20:00", true)).toBe(2);
  });

  it("剛好 12:00–13:00 視為涵蓋午休；只碰到一部分不扣", () => {
    expect(overtimeCoversLunch("12:00", "13:00")).toBe(true);
    expect(overtimeCoversLunch("09:00", "12:30")).toBe(false);
    expect(overtimeCoversLunch("12:30", "17:00")).toBe(false);
    expect(computeOvertimeNetHours("12:30", "17:00", true)).toBe(4.5);
  });

  it("結束不晚於開始回 null", () => {
    expect(computeOvertimeNetHours("17:00", "09:00", true)).toBeNull();
  });

  it("審核端判斷申報時數已扣午休", () => {
    expect(isOvertimeLunchDeducted({ start_time: "09:00", end_time: "17:00", hours: 7 })).toBe(
      true,
    );
    expect(isOvertimeLunchDeducted({ start_time: "09:00", end_time: "17:00", hours: 8 })).toBe(
      false,
    );
    expect(isOvertimeLunchDeducted({ start_time: "18:00", end_time: "20:00", hours: 2 })).toBe(
      false,
    );
  });
});
