import { describe, expect, it } from "vitest";
import type { AttendanceDayRow } from "@/lib/attendance-csv";
import {
  appendOnlinePunchTags,
  applyApprovedMakeupPunches,
  applyOnlinePunches,
  buildWarRoomRows,
  summarizeOnlinePunchLogs,
  type OnlinePunchSpan,
} from "@/lib/attendance-war-room";

const EMP_BY_UID = new Map([["7", { id: "emp-1", name: "王小明" }]]);
const NAMES = new Map([
  ["emp-1", "王小明"],
  ["emp-2", "陳小華"],
]);

function csvRow(date: string, clockIn: string | null, clockOut: string | null): AttendanceDayRow {
  return {
    uid: "7",
    displayName: "王小明",
    date,
    clockIn,
    clockOut,
    missingPunch: (clockIn == null) !== (clockOut == null),
  };
}

function online(
  date: string,
  clockIn: string | null,
  clockOut: string | null,
  employeeId = "emp-1",
): OnlinePunchSpan {
  return { employee_id: employeeId, punch_date: date, clock_in: clockIn, clock_out: clockOut };
}

describe("summarizeOnlinePunchLogs", () => {
  it("同日多筆：上班取最早、下班取最晚，日期與時間以台北時區計", () => {
    const spans = summarizeOnlinePunchLogs([
      { employee_id: "emp-1", check_type: "out", created_at: "2026-09-07T10:10:00Z" },
      { employee_id: "emp-1", check_type: "in", created_at: "2026-09-07T00:55:00Z" },
      { employee_id: "emp-1", check_type: "in", created_at: "2026-09-07T00:50:00Z" },
      { employee_id: "emp-1", check_type: "out", created_at: "2026-09-07T10:02:00Z" },
    ]);
    expect(spans).toEqual([online("2026-09-07", "08:50", "18:10")]);
  });

  it("UTC 前一天 23 點後的打卡歸到台北隔天", () => {
    const spans = summarizeOnlinePunchLogs([
      { employee_id: "emp-1", check_type: "in", created_at: "2026-09-06T22:30:00Z" },
    ]);
    expect(spans).toEqual([online("2026-09-07", "06:30", null)]);
  });

  it("略過無法辨識的打卡類型與時間", () => {
    const spans = summarizeOnlinePunchLogs([
      { employee_id: "emp-1", check_type: "break", created_at: "2026-09-07T00:50:00Z" },
      { employee_id: "emp-1", check_type: "in", created_at: "not-a-date" },
    ]);
    expect(spans).toEqual([]);
  });
});

describe("applyOnlinePunches：CSV 優先，只補缺卡那側", () => {
  it("CSV 缺下班卡 → 補線上下班；已有的上班卡不被覆蓋", () => {
    const res = applyOnlinePunches(
      [csvRow("2026/9/7", "08:55", null)],
      [online("2026-09-07", "08:40", "18:05")],
      EMP_BY_UID,
      NAMES,
    );
    expect(res.rows[0]).toMatchObject({ clockIn: "08:55", clockOut: "18:05", missingPunch: false });
    expect(res.patchedSides.get("emp-1\t2026-09-07")).toEqual({ in: false, out: true });
  });

  it("CSV 上下班都有 → 不動，也不標線上打卡", () => {
    const rows = [csvRow("2026/9/7", "08:55", "18:01")];
    const res = applyOnlinePunches(rows, [online("2026-09-07", "08:40", "18:05")], EMP_BY_UID);
    expect(res.rows[0]).toEqual(rows[0]);
    expect(res.patchedSides.size).toBe(0);
  });

  it("CSV 該日無該員之列 → 以線上打卡合成一列", () => {
    const res = applyOnlinePunches([], [online("2026-09-08", "08:50", "18:00")], EMP_BY_UID);
    expect(res.rows).toEqual([
      {
        uid: "7",
        displayName: "王小明",
        date: "2026-09-08",
        clockIn: "08:50",
        clockOut: "18:00",
        missingPunch: false,
      },
    ]);
    expect(res.patchedSides.get("emp-1\t2026-09-08")).toEqual({ in: true, out: true });
  });

  it("員工未設 timeclock_uid → 合成列使用 online: uid 並帶出姓名", () => {
    const res = applyOnlinePunches(
      [],
      [online("2026-09-08", "08:50", null, "emp-2")],
      EMP_BY_UID,
      NAMES,
    );
    expect(res.rows[0]).toMatchObject({ uid: "online:emp-2", displayName: "陳小華" });
    expect(res.extraNameByUid.get("online:emp-2")).toEqual({ employeeId: "emp-2", name: "陳小華" });
  });
});

describe("線上打卡與補卡單併用", () => {
  it("線上打卡先補，補卡單只補仍缺的那側", () => {
    const step1 = applyOnlinePunches(
      [csvRow("2026/9/7", null, "18:02")],
      [online("2026-09-07", "08:45", null)],
      EMP_BY_UID,
    );
    const step2 = applyApprovedMakeupPunches(
      step1.rows,
      [online("2026-09-07", "09:00", "18:00")],
      EMP_BY_UID,
    );
    expect(step2.rows[0]).toMatchObject({ clockIn: "08:45", clockOut: "18:02" });
    expect(step2.patchedKeys.size).toBe(0);
  });

  it("線上打卡合成之 online: 列，補卡單補在同一列而非再合成一列", () => {
    const step1 = applyOnlinePunches(
      [],
      [online("2026-09-08", "08:50", null, "emp-2")],
      EMP_BY_UID,
      NAMES,
    );
    const step2 = applyApprovedMakeupPunches(
      step1.rows,
      [online("2026-09-08", null, "18:00", "emp-2")],
      EMP_BY_UID,
      NAMES,
    );
    expect(step2.rows).toHaveLength(1);
    expect(step2.rows[0]).toMatchObject({ uid: "online:emp-2", clockIn: "08:50", clockOut: "18:00" });
    expect(step2.patchedKeys.has("emp-2\t2026-09-08")).toBe(true);
  });
});

describe("appendOnlinePunchTags", () => {
  it("補入後缺卡標籤消失，並標示補的是哪一側", () => {
    const res = applyOnlinePunches(
      [csvRow("2026/9/7", "08:55", null)],
      [online("2026-09-07", null, "18:05")],
      EMP_BY_UID,
    );
    const nameByUid = new Map([["7", { employeeId: "emp-1", name: "王小明" }]]);
    const war = appendOnlinePunchTags(
      buildWarRoomRows(res.rows, nameByUid, []),
      res.patchedSides,
    );
    const ids = war[0]!.tags.map((t) => t.id);
    expect(ids).not.toContain("missing");
    expect(war[0]!.tags.find((t) => t.id === "online_punch")?.label).toBe("📱 線上打卡（下班）");
  });
});
