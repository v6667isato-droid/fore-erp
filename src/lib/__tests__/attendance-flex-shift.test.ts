import { describe, expect, it } from "vitest";
import type { AttendanceDayRow } from "@/lib/attendance-csv";
import {
  appendMakeupPunchTags,
  buildWarRoomRows,
  flexShiftOf,
  isOffFixedShift,
} from "@/lib/attendance-war-room";
import { warRoomRowToDailyAttendancePayload } from "@/lib/daily-attendance";
import { buildPayslipAttendanceRemarks } from "@/lib/payslip-attendance-remarks";

const NAME_BY_UID = new Map([["7", { employeeId: "emp-1", name: "王小明" }]]);
const BOUNDS = { start: "2026-09-01", end: "2026-09-30" };

/** 2026-09-03 為週四；2026-09-05 為週六 */
function tagIdsFor(clockIn: string | null, clockOut: string | null, date = "2026/9/3"): string[] {
  const row: AttendanceDayRow = {
    uid: "7",
    displayName: "王小明",
    date,
    clockIn,
    clockOut,
    missingPunch: (clockIn == null) !== (clockOut == null),
  };
  return buildWarRoomRows([row], NAME_BY_UID, [])[0]!.tags.map((t) => t.id);
}

describe("flexShiftOf", () => {
  it("早上班 08:00–17:00、晚上班 10:00–19:00", () => {
    expect(flexShiftOf("08:00", "17:00")).toBe("early");
    expect(flexShiftOf("10:00:00", "19:00:00")).toBe("late");
  });

  it("沿用 15 分鐘裕度", () => {
    expect(flexShiftOf("08:15", "16:45")).toBe("early");
    expect(flexShiftOf("08:16", "17:00")).toBeNull();
    expect(flexShiftOf("08:00", "16:44")).toBeNull();
    expect(flexShiftOf("10:15", "18:45")).toBe("late");
    expect(flexShiftOf("10:16", "19:30")).toBeNull();
    expect(flexShiftOf("10:00", "18:44")).toBeNull();
  });

  it("固定班 9:00–18:00 已正常時不算彈性工時", () => {
    expect(flexShiftOf("08:00", "18:00")).toBeNull();
    expect(flexShiftOf("09:00", "19:00")).toBeNull();
  });

  it("缺卡或下班早於上班不算", () => {
    expect(flexShiftOf("08:00", null)).toBeNull();
    expect(flexShiftOf("17:00", "08:00")).toBeNull();
  });
});

describe("戰情列：彈性工時取代遲到／早退", () => {
  it("08:00–17:00 → 彈性工時（早上班），不標早退", () => {
    expect(tagIdsFor("08:00", "17:00")).toEqual(["flex_early"]);
  });

  it("10:00–19:00 → 彈性工時（晚上班），不標遲到", () => {
    expect(tagIdsFor("10:00", "19:00")).toEqual(["flex_late"]);
  });

  it("工時不足仍照常判斷", () => {
    expect(tagIdsFor("08:10", "16:50")).toEqual(["flex_early", "short"]);
  });

  it("兩種彈性班都不符 → 照舊標遲到／早退", () => {
    expect(tagIdsFor("09:30", "17:00")).toEqual(
      expect.arrayContaining(["late", "early"]),
    );
    expect(tagIdsFor("09:30", "17:00")).not.toContain("flex_early");
    expect(tagIdsFor("10:20", "19:30")).toContain("late");
  });

  it("週末出勤不判彈性工時", () => {
    expect(tagIdsFor("08:00", "17:00", "2026/9/5")).toEqual(["weekend"]);
  });

  it("寫入 daily_attendance 時不算異常", () => {
    const row: AttendanceDayRow = {
      uid: "7",
      displayName: "王小明",
      date: "2026/9/3",
      clockIn: "08:00",
      clockOut: "17:00",
      missingPunch: false,
    };
    const war = buildWarRoomRows([row], NAME_BY_UID, [])[0]!;
    const payload = warRoomRowToDailyAttendancePayload(war)!;
    expect(payload.is_abnormal).toBe(false);
    expect(payload.status_tags).toEqual(["🕗 彈性工時（早上班）"]);
  });

  it("補卡後符合彈性班：維持已補卡＋彈性工時，不改標特殊出勤", () => {
    const row: AttendanceDayRow = {
      uid: "7",
      displayName: "王小明",
      date: "2026/9/3",
      clockIn: "08:00",
      clockOut: "17:00",
      missingPunch: false,
    };
    const war = appendMakeupPunchTags(
      buildWarRoomRows([row], NAME_BY_UID, []),
      new Set(["emp-1\t2026-09-03"]),
    );
    expect(war[0]!.tags.map((t) => t.id)).toEqual(["flex_early", "makeup"]);
    expect(isOffFixedShift("08:00", "17:00")).toBe(false);
    expect(isOffFixedShift("09:30", "18:30")).toBe(true);
  });
});

describe("薪資發放備註", () => {
  it("彈性工時列出「M/D 彈性工時（早上班／晚上班）」", () => {
    const remarks = buildPayslipAttendanceRemarks("emp-1", {
      bounds: BOUNDS,
      attendanceRows: [
        {
          employee_id: "emp-1",
          attendance_date: "2026-09-03",
          clock_in: "08:00:00",
          clock_out: "17:00:00",
          is_abnormal: false,
          status_tags: ["🕗 彈性工時（早上班）"],
        },
        {
          employee_id: "emp-1",
          attendance_date: "2026-09-04",
          clock_in: "10:02:00",
          clock_out: "19:05:00",
          is_abnormal: false,
          status_tags: ["🕙 彈性工時（晚上班）"],
        },
      ],
      leaveRows: [],
      overtimeRows: [],
    });
    expect(remarks).toBe("9/3 彈性工時（早上班）, 9/4 彈性工時（晚上班）");
  });

  it("補打卡且符合彈性班：寫補打卡＋彈性工時，不寫特殊出勤", () => {
    const remarks = buildPayslipAttendanceRemarks("emp-1", {
      bounds: BOUNDS,
      attendanceRows: [
        {
          employee_id: "emp-1",
          attendance_date: "2026-09-03",
          clock_in: "08:00:00",
          clock_out: "17:00:00",
          is_abnormal: false,
          status_tags: ["🕗 彈性工時（早上班）", "📝 已補卡"],
        },
      ],
      leaveRows: [],
      overtimeRows: [],
      makeupPunchRows: [
        { employee_id: "emp-1", punch_date: "2026-09-03", clock_in: "08:00:00", clock_out: null },
      ],
    });
    expect(remarks).not.toContain("特殊出勤");
    expect(remarks).toContain("9/3 彈性工時（早上班）");
    expect(remarks).toContain("9/3 補打卡");
  });
});
