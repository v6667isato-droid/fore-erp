import { describe, expect, it } from "vitest";
import {
  buildPayslipAttendanceRemarks,
  sumOvertimeHoursByDateAndKind,
} from "@/lib/payslip-attendance-remarks";
import {
  hasOvertimeTimeOverlap,
  type OvertimeRequestRow,
} from "@/lib/employee-overtime-requests";

const BOUNDS = { start: "2026-09-01", end: "2026-09-30" };

function otRecord(hours: number, reason: string) {
  return {
    employee_id: "emp-1",
    overtime_date: "2026-09-16",
    hours,
    reason,
  };
}

describe("同日多段加班：備註時數合併", () => {
  it("同日兩段轉補休合併為一行總時數", () => {
    const rows = [
      otRecord(1, "【補休】提早到班 07:00–08:00"),
      otRecord(1, "【補休】趕工 18:00–19:00"),
    ];
    const sums = [...sumOvertimeHoursByDateAndKind("emp-1", rows).values()];
    expect(sums).toEqual([{ dateIso: "2026-09-16", isPay: false, hours: 2 }]);
  });

  it("同日「加班費」與「補休」各自合計，互不混算", () => {
    const rows = [
      otRecord(1.5, "【加班費】提早到班 06:30–08:00"),
      otRecord(2, "【補休】趕工 18:00–20:00"),
      otRecord(0.5, "【加班費】收尾 20:00–20:30"),
    ];
    const sums = sumOvertimeHoursByDateAndKind("emp-1", rows);
    expect(sums.get("2026-09-16\tpay")?.hours).toBe(2);
    expect(sums.get("2026-09-16\tcomp")?.hours).toBe(2);
  });

  it("備註不再因兩段時數相同而被去重少算", () => {
    const remarks = buildPayslipAttendanceRemarks("emp-1", {
      bounds: BOUNDS,
      attendanceRows: [],
      leaveRows: [],
      overtimeRows: [
        otRecord(1, "【補休】提早到班 07:00–08:00"),
        otRecord(1, "【補休】趕工 18:00–19:00"),
      ],
    });
    expect(remarks).toBe("9/16 加班轉補休 2hr");
  });
});

function request(
  start: string,
  end: string,
  status: OvertimeRequestRow["status"] = "pending",
  date = "2026-09-16",
): Pick<OvertimeRequestRow, "overtime_date" | "start_time" | "end_time" | "status"> {
  return { overtime_date: date, start_time: start, end_time: end, status };
}

describe("同日多段加班：申報時段重疊檢查", () => {
  const morning = request("07:00", "08:00", "approved");

  it("早上一段、下班後一段不重疊，可再申報", () => {
    expect(
      hasOvertimeTimeOverlap([morning], {
        overtimeDate: "2026-09-16",
        startTime: "18:00",
        endTime: "20:00",
      }),
    ).toBe(false);
  });

  it("時段相交時擋下", () => {
    expect(
      hasOvertimeTimeOverlap([morning], {
        overtimeDate: "2026-09-16",
        startTime: "07:30",
        endTime: "09:00",
      }),
    ).toBe(true);
  });

  it("首尾相接（08:00 接 08:00）不算重疊", () => {
    expect(
      hasOvertimeTimeOverlap([morning], {
        overtimeDate: "2026-09-16",
        startTime: "08:00",
        endTime: "09:00",
      }),
    ).toBe(false);
  });

  it("已退回／已撤銷的申報不擋新申報", () => {
    const rows = [request("18:00", "20:00", "rejected"), request("18:00", "20:00", "revoked")];
    expect(
      hasOvertimeTimeOverlap(rows, {
        overtimeDate: "2026-09-16",
        startTime: "18:00",
        endTime: "20:00",
      }),
    ).toBe(false);
  });

  it("不同日期不互相干擾", () => {
    expect(
      hasOvertimeTimeOverlap([morning], {
        overtimeDate: "2026-09-17",
        startTime: "07:00",
        endTime: "08:00",
      }),
    ).toBe(false);
  });
});
