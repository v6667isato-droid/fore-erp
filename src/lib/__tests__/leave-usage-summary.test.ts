import { describe, expect, it } from "vitest";
import { summarizeLeaveUsage, type UsageLeave } from "@/lib/leave-usage-summary";

const base = { leaveId: "this", year: "2026", statutoryDays: null as number | null };

describe("審核卡片：剩餘／已請時數", () => {
  it("特休：目前剩餘、核准後剩餘、另有待審", () => {
    const leaves: UsageLeave[] = [
      { id: "this", leave_type: "特休", status: "pending", start_date: "2026-11-20", hours: 8 },
      { id: "p2", leave_type: "特休", status: "pending", start_date: "2026-12-01", hours: 4 },
    ];
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "特休", thisHours: 8, employeeLeaves: leaves, balanceHours: 20 }),
    ).toEqual({ text: "特休剩餘：2 天 4 小時（核准後剩 1 天 4 小時；另有待審 0 天 4 小時）", warn: false });
  });

  it("補休不足時標示警告；餘額未設定也警告", () => {
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "補休", thisHours: 8, employeeLeaves: [], balanceHours: 4 })?.warn,
    ).toBe(true);
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "補休", thisHours: 8, employeeLeaves: [], balanceHours: null }),
    ).toEqual({ text: "補休餘額：尚未設定", warn: true });
  });

  it("婚假：累計已核准（不分年度）／法定 8 天", () => {
    const leaves: UsageLeave[] = [
      { id: "m1", leave_type: "婚假", status: "approved", start_date: "2025-12-20", hours: 24 },
    ];
    const s = summarizeLeaveUsage({
      ...base,
      leaveType: "婚假",
      thisHours: 48,
      employeeLeaves: leaves,
      balanceHours: undefined,
      statutoryDays: 8,
    });
    expect(s).toEqual({ text: "累計已核准婚假：3 天／法定 8 天", warn: true });
  });

  it("喪假：今年已核准／法定天數", () => {
    const leaves: UsageLeave[] = [
      { id: "f1", leave_type: "喪假(3日)", status: "approved", start_date: "2025-03-01", hours: 24 },
    ];
    expect(
      summarizeLeaveUsage({
        ...base,
        leaveType: "喪假(3日)",
        thisHours: 16,
        employeeLeaves: leaves,
        balanceHours: undefined,
        statutoryDays: 3,
      }),
    ).toEqual({ text: "今年已核准喪假(3日)：0 天／法定 3 天", warn: false });
  });

  it("事假＋家庭照顧假合併計入 14 天", () => {
    const leaves: UsageLeave[] = [
      { id: "a", leave_type: "事假", status: "approved", start_date: "2026-03-01", hours: 80 },
      { id: "b", leave_type: "家庭照顧假", status: "approved", start_date: "2026-05-01", hours: 24 },
      { id: "c", leave_type: "事假", status: "revoked", start_date: "2026-06-01", hours: 8 },
    ];
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "事假", thisHours: 8, employeeLeaves: leaves, balanceHours: undefined }),
    ).toEqual({ text: "今年已核准事假＋家照：13 天／上限 14 天", warn: false });
  });

  it("病假交給原本含保護線的區塊；其他假別沒用過不顯示", () => {
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "病假", thisHours: 8, employeeLeaves: [], balanceHours: undefined }),
    ).toBeNull();
    expect(
      summarizeLeaveUsage({ ...base, leaveType: "公假", thisHours: 8, employeeLeaves: [], balanceHours: undefined }),
    ).toBeNull();
  });
});
