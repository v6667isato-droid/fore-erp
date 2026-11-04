import { describe, expect, it } from "vitest";
import {
  formatLeaveHoursLabel,
  hourlyWageFromMonthly,
  leaveRequestHoursInRange,
  leaveRequestTotalHours,
} from "@/lib/leave-hours";
import {
  availableLeaveHours,
  emptyLeaveBalanceCommitments,
  leaveBalanceErrorMessage,
} from "@/lib/leave-balance-availability";
import { buildLeaveHolidayLookup } from "@/lib/employee-leave-time";

const NOV = ["2026-11-01", "2026-11-30"] as const;
const OCT = ["2026-10-01", "2026-10-31"] as const;

describe("請假扣薪：時薪", () => {
  it("月薪 36,000 → 時薪 150（÷30÷8）", () => {
    expect(hourlyWageFromMonthly(36000)).toBe(150);
  });
});

describe("請假時數：同月假單直接用 hours_count", () => {
  it("事假 4 小時只算 4 小時，不再算成 1 天", () => {
    const row = { start_date: "2026-11-05", end_date: "2026-11-05", hours_count: 4 };
    expect(leaveRequestHoursInRange(row, ...NOV)).toBe(4);
  });

  it("週五到週一（實際 16 小時）不把週末算進去", () => {
    const row = { start_date: "2026-11-06", end_date: "2026-11-09", hours_count: 16 };
    expect(leaveRequestHoursInRange(row, ...NOV)).toBe(16);
  });

  it("假單不在區間內 → 0", () => {
    const row = { start_date: "2026-11-05", end_date: "2026-11-05", hours_count: 4 };
    expect(leaveRequestHoursInRange(row, ...OCT)).toBe(0);
  });
});

describe("請假時數：跨月依各月工時分攤", () => {
  it("有完整起訖時間：10/30 09:30 → 11/2 18:00，10 月 7.5h、11 月 8h", () => {
    const row = {
      start_date: "2026-10-30",
      end_date: "2026-11-02",
      start_time: "09:30:00",
      end_time: "18:00:00",
      hours_count: 15.5,
    };
    expect(leaveRequestHoursInRange(row, ...OCT)).toBeCloseTo(7.5, 6);
    expect(leaveRequestHoursInRange(row, ...NOV)).toBeCloseTo(8, 6);
  });

  it("舊假單只有整點欄位：各月比例分攤，合計仍等於 hours_count", () => {
    const row = {
      start_date: "2026-10-30",
      end_date: "2026-11-02",
      start_day_start_hour: 9,
      end_day_end_hour: 18,
      hours_count: 15.5,
    };
    const oct = leaveRequestHoursInRange(row, ...OCT);
    const nov = leaveRequestHoursInRange(row, ...NOV);
    expect(oct + nov).toBeCloseTo(15.5, 6);
    expect(oct).toBeCloseTo(7.75, 6);
  });

  it("跨年遇元旦放假：12/31 → 1/4 各 8 小時", () => {
    const lookup = buildLeaveHolidayLookup([{ holiday_date: "2027-01-01", is_workday: false }]);
    const row = {
      start_date: "2026-12-31",
      end_date: "2027-01-04",
      start_time: "09:00",
      end_time: "18:00",
      hours_count: 16,
    };
    expect(leaveRequestHoursInRange(row, "2026-12-01", "2026-12-31", lookup)).toBeCloseTo(8, 6);
    expect(leaveRequestHoursInRange(row, "2027-01-01", "2027-01-31", lookup)).toBeCloseTo(8, 6);
  });
});

describe("請假總時數 fallback", () => {
  it("沒有 hours_count 時用 total_days × 8", () => {
    expect(leaveRequestTotalHours({ start_date: "2026-11-05", total_days: 1.5 })).toBe(12);
  });

  it("都沒有時以起訖工作日 × 8", () => {
    expect(leaveRequestTotalHours({ start_date: "2026-11-06", end_date: "2026-11-09" })).toBe(16);
  });
});

describe("時數顯示", () => {
  it.each([
    [4, "4 小時"],
    [7.5, "7.5 小時"],
    [8, "1 天"],
    [12, "1 天 4 小時"],
  ])("%s 小時 → %s", (h, label) => {
    expect(formatLeaveHoursLabel(h)).toBe(label);
  });
});

describe("特休／補休可申請額度（核准即扣：餘額 − 待審）", () => {
  it("特休：剩餘天數 × 8 − 待審時數", () => {
    const c = emptyLeaveBalanceCommitments();
    c.annual.pendingHours = 8;
    // 2.5 × 8 − 8 = 12
    expect(availableLeaveHours("annual", 2.5, c)).toBe(12);
  });

  it("補休：剩餘時數 − 待審時數", () => {
    const c = emptyLeaveBalanceCommitments();
    c.comp.pendingHours = 3;
    expect(availableLeaveHours("comp", 10, c)).toBe(7);
  });

  it("餘額未設定不可申請", () => {
    const c = emptyLeaveBalanceCommitments();
    expect(availableLeaveHours("annual", null, c)).toBeNull();
    expect(leaveBalanceErrorMessage("annual", "特休", null, c, 4)).toContain("尚未設定");
  });

  it("已送出待審的時數要一起算：兩張各 6 小時、補休剩 10 小時 → 第二張擋下", () => {
    const c = emptyLeaveBalanceCommitments();
    expect(leaveBalanceErrorMessage("comp", "補休", 10, c, 6)).toBeNull();
    c.comp.pendingHours = 6;
    expect(leaveBalanceErrorMessage("comp", "補休", 10, c, 6)).toContain("超過補休可申請額度");
  });

  it("剛好等於額度可送出；歸零時任何時數都擋", () => {
    const c = emptyLeaveBalanceCommitments();
    expect(leaveBalanceErrorMessage("annual", "特休", 1, c, 8)).toBeNull();
    expect(leaveBalanceErrorMessage("annual", "特休", 0, c, 1)).toContain("已用完");
  });
});
