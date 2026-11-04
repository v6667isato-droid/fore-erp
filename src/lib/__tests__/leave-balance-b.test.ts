import { describe, expect, it } from "vitest";
import {
  approvalHoursAdjustment,
  postCreationHolidayHits,
  type HolidayRecord,
} from "@/lib/leave-holiday-refund";
import {
  computeLeaveSalarySettlement,
  formatPriorLeaveAdjustmentLines,
  type LeaveSettlementItem,
} from "@/lib/leave-salary-settlement";
import {
  annualLeaveUsedDays,
  formatLedgerRemarkLines,
  unbilledLedgerEntries,
  withLedgerRemarkLines,
  type LeaveLedgerEntry,
} from "@/lib/leave-ledger";
import { buildLeaveHolidayLookup } from "@/lib/employee-leave-time";

/** 2026 年 10 月行事曆：10/9 國慶補假、10/26 光復節補假（年初建立）、10/23 颱風假（10/26 補登） */
const HOLIDAYS: HolidayRecord[] = [
  { date: "2026-10-09", name: "國慶日補假", isWorkday: false, createdAt: "2026-03-21T07:38:56Z" },
  { date: "2026-10-23", name: "颱風假", isWorkday: false, createdAt: "2026-10-26T13:21:00Z" },
  { date: "2026-10-26", name: "臺灣光復節補假", isWorkday: false, createdAt: "2026-03-21T07:38:56Z" },
];

describe("颱風假回補：找出假單送出後才新增的放假日", () => {
  it("俞庭邦 特休 10/21–10/28（40h，7 月送出）→ 10/23 回補 8 小時；10/26 年初就有，不算", () => {
    const row = {
      id: "a",
      start_date: "2026-10-21",
      end_date: "2026-10-28",
      hours_count: 40,
      created_at: "2026-07-21T04:49:08Z",
    };
    expect(postCreationHolidayHits(row, HOLIDAYS)).toEqual([{ date: "2026-10-23", name: "颱風假", hours: 8 }]);
  });

  it("陳柏璁 特休 10/20–11/4（88h，5 月送出）→ 10/23 回補 8 小時", () => {
    const row = {
      id: "b",
      start_date: "2026-10-20",
      end_date: "2026-11-04",
      hours_count: 88,
      created_at: "2026-05-05T13:48:35Z",
    };
    expect(postCreationHolidayHits(row, HOLIDAYS)).toEqual([{ date: "2026-10-23", name: "颱風假", hours: 8 }]);
  });

  it("颱風假之後才送出的假單（已排除）→ 不需回補", () => {
    const row = { id: "c", start_date: "2026-10-22", end_date: "2026-10-27", hours_count: 24, created_at: "2026-10-27T01:00:00Z" };
    expect(postCreationHolidayHits(row, HOLIDAYS)).toEqual([]);
  });

  it("已核准回補過的日期不再重複", () => {
    const row = { id: "a", start_date: "2026-10-21", end_date: "2026-10-28", hours_count: 32, created_at: "2026-07-21T04:49:08Z" };
    expect(postCreationHolidayHits(row, HOLIDAYS, new Set(["2026-10-23"]))).toEqual([]);
  });

  it("待審假單核准時：扣掉颱風假，並產生系統備註", () => {
    const row = { id: "d", start_date: "2026-10-21", end_date: "2026-10-23", hours_count: 24, created_at: "2026-10-20T01:00:00Z" };
    const adj = approvalHoursAdjustment(row, HOLIDAYS);
    expect(adj?.hours).toBe(16);
    expect(adj?.note).toBe("【系統】核准時已排除 10/23 颱風假 1 天（原 3 天）");
  });
});

const ratioOf = (t: string) => (t === "事假" ? 1 : t === "病假" ? 0.5 : 0);

describe("扣薪假結算與跨月對帳", () => {
  it("本月：事假 4 小時、病假 8 小時（半薪）→ 月薪 36,000 扣 600 + 600", () => {
    const s = computeLeaveSalarySettlement({
      period: "2026-11",
      monthlyWage: 36000,
      ratioOf,
      paidSlips: [],
      leaves: [
        { id: "x", leave_type: "事假", status: "approved", start_date: "2026-11-05", end_date: "2026-11-05", hours_count: 4 },
        { id: "y", leave_type: "病假", status: "approved", start_date: "2026-11-06", end_date: "2026-11-06", hours_count: 8 },
        { id: "z", leave_type: "特休", status: "approved", start_date: "2026-11-09", end_date: "2026-11-09", hours_count: 8 },
        { id: "w", leave_type: "事假", status: "pending", start_date: "2026-11-10", end_date: "2026-11-10", hours_count: 8 },
      ],
    });
    expect(s.total).toBe(1200);
    expect(s.current.map((i) => i.leave_request_id)).toEqual(["x", "y"]);
    expect(s.adjustments).toEqual([]);
  });

  const novSlip = (items: LeaveSettlementItem[]) => ({ period: "2026-11", baseSalary: 36000, items });

  it("11 月已發放後才核准的 11 月事假 → 12 月前期補扣", () => {
    const s = computeLeaveSalarySettlement({
      period: "2026-12",
      monthlyWage: 38000,
      ratioOf,
      paidSlips: [novSlip([])],
      leaves: [{ id: "late", leave_type: "事假", status: "approved", start_date: "2026-11-20", end_date: "2026-11-20", hours_count: 8 }],
    });
    expect(s.adjustments).toHaveLength(1);
    expect(s.adjustments[0]).toMatchObject({ period: "2026-11", hours: 8 });
    // 以 11 月月薪計：36000 / 240 × 8 = 1200
    expect(s.total).toBe(1200);
    expect(formatPriorLeaveAdjustmentLines(s.adjustments)).toEqual([
      "前期請假調整：11 月 事假 1 天（發薪後才核准）補扣 NT$1,200",
    ]);
  });

  it("11 月已結算的事假，發薪後撤銷 → 12 月補發", () => {
    const s = computeLeaveSalarySettlement({
      period: "2026-12",
      monthlyWage: 36000,
      ratioOf,
      paidSlips: [
        novSlip([{ leave_request_id: "r", period: "2026-11", leave_type: "事假", hours: 8, ratio: 1, amount: 1200 }]),
      ],
      leaves: [{ id: "r", leave_type: "事假", status: "revoked", start_date: "2026-11-20", end_date: "2026-11-20", hours_count: 8 }],
    });
    expect(s.total).toBe(-1200);
    expect(s.adjustments[0].hours).toBe(-8);
  });

  it("颱風假回補後時數減少（40 → 32）→ 補發 8 小時；已調整過的不重複", () => {
    const leaves = [{ id: "p", leave_type: "事假", status: "approved", start_date: "2026-11-16", end_date: "2026-11-20", hours_count: 32 }];
    const first = computeLeaveSalarySettlement({
      period: "2026-12",
      monthlyWage: 36000,
      ratioOf,
      paidSlips: [novSlip([{ leave_request_id: "p", period: "2026-11", leave_type: "事假", hours: 40, ratio: 1, amount: 6000 }])],
      leaves,
    });
    expect(first.total).toBe(-1200);
    // 12 月已把 −8 小時記入，1 月不再重複
    const second = computeLeaveSalarySettlement({
      period: "2027-01",
      monthlyWage: 36000,
      ratioOf,
      paidSlips: [
        novSlip([{ leave_request_id: "p", period: "2026-11", leave_type: "事假", hours: 40, ratio: 1, amount: 6000 }]),
        { period: "2026-12", baseSalary: 36000, items: first.adjustments },
      ],
      leaves,
    });
    expect(second.adjustments).toEqual([]);
  });

  it("上線前的舊薪資單（沒有明細）不對帳", () => {
    const s = computeLeaveSalarySettlement({
      period: "2026-11",
      monthlyWage: 36000,
      ratioOf,
      paidSlips: [{ period: "2026-10", baseSalary: 36000, items: null }],
      leaves: [{ id: "old", leave_type: "事假", status: "approved", start_date: "2026-10-20", end_date: "2026-10-20", hours_count: 8 }],
    });
    expect(s.adjustments).toEqual([]);
    expect(s.total).toBe(0);
  });

  it("跨月事假依各月工時分攤", () => {
    const lookup = buildLeaveHolidayLookup([]);
    const s = computeLeaveSalarySettlement({
      period: "2026-11",
      monthlyWage: 36000,
      ratioOf,
      holidayLookup: lookup,
      paidSlips: [],
      leaves: [{ id: "c", leave_type: "事假", status: "approved", start_date: "2026-10-30", end_date: "2026-11-02", hours_count: 16 }],
    });
    expect(s.currentHours).toBe(8);
    expect(s.total).toBe(1200);
  });
});

const entry = (e: Partial<LeaveLedgerEntry>): LeaveLedgerEntry => ({
  id: e.id ?? "id",
  employee_id: "E",
  kind: e.kind ?? "annual",
  delta_hours: e.delta_hours ?? 0,
  balance_after_hours: null,
  reason: e.reason ?? "leave_approved",
  leave_request_id: e.leave_request_id ?? null,
  ref_id: e.ref_id ?? null,
  note: e.note ?? null,
  payslip_period: e.payslip_period ?? null,
  created_at: e.created_at ?? "2026-11-05T02:00:00Z",
});

describe("特休／補休異動備註", () => {
  const leaves = new Map([
    ["L1", { leave_type: "特休", start_date: "2026-10-21", end_date: "2026-10-28" }],
    ["L2", { leave_type: "特休", start_date: "2026-11-06", end_date: "2026-11-06" }],
  ]);
  const grants = new Map([["G1", { milestone_years: 1, days: 10, statutory_days: 7 }]]);

  it("各種異動的備註文字", () => {
    const lines = formatLedgerRemarkLines(
      [
        entry({ id: "3", reason: "annual_grant", delta_hours: 80, ref_id: "G1", note: "入職約定 10 天", created_at: "2026-11-10T02:00:00Z" }),
        entry({ id: "1", reason: "leave_approved", delta_hours: -1, leave_request_id: "L2", created_at: "2026-11-03T02:00:00Z" }),
        entry({ id: "2", reason: "holiday_refund", delta_hours: 8, leave_request_id: "L1", note: "10/23 颱風假", created_at: "2026-11-05T02:00:00Z" }),
        entry({ id: "4", kind: "comp", reason: "manual_adjust", delta_hours: -2, note: "更正", created_at: "2026-11-12T02:00:00Z" }),
      ],
      leaves,
      grants,
    );
    expect(lines).toEqual([
      "特休異動 11/3：核准 特休 11/6（−1 小時）",
      "特休異動 11/5：10/23 颱風假回補，特休 10/21–10/28（+1 天）",
      "特休異動 11/10：年資新增 滿1年（+10 天；法定 7 天，入職約定 10 天）",
      "補休異動 11/12：人工調整（−2 小時；更正）",
    ]);
  });

  it("重新產生備註時取代舊的異動行，保留其他備註", () => {
    const notes = "10/23 颱風假\n特休異動 11/3：舊的\n遲到 1 次";
    expect(withLedgerRemarkLines(notes, ["特休異動 11/5：新的"])).toBe("10/23 颱風假\n遲到 1 次\n特休異動 11/5：新的");
  });

  it("特休淨使用天數不含年資新增與人工調整", () => {
    const es = [
      entry({ reason: "leave_approved", delta_hours: -16 }),
      entry({ reason: "holiday_refund", delta_hours: 8 }),
      entry({ reason: "annual_grant", delta_hours: 80 }),
      entry({ reason: "manual_adjust", delta_hours: 8 }),
    ];
    expect(annualLeaveUsedDays(es)).toBe(1);
  });

  it("尚未列入薪資單、且在結算月結束前的異動", () => {
    const es = [
      entry({ id: "a", created_at: "2026-11-05T00:00:00Z" }),
      entry({ id: "b", created_at: "2026-11-05T00:00:00Z", payslip_period: "2026-11" }),
      entry({ id: "c", created_at: "2026-12-02T00:00:00Z" }),
    ];
    expect(unbilledLedgerEntries(es, "2026-11-30T16:00:00Z").map((e) => e.id)).toEqual(["a"]);
  });
});
