import { describe, expect, it } from "vitest";
import {
  formatSalaryAdjustmentRemark,
  nextMonth,
  overtimeDailyRateFromWage,
  payrollProfileForPeriod,
  type SalaryAdjustment,
} from "@/lib/salary-adjustments";

const adj = (a: Partial<SalaryAdjustment> & { effective_month: string }): SalaryAdjustment => ({
  id: a.effective_month,
  employee_id: "E",
  old_wage: 0,
  new_wage: 0,
  old_labor_insurance_bracket: null,
  new_labor_insurance_bracket: null,
  old_labor_employee_burden: null,
  new_labor_employee_burden: null,
  old_health_employee_burden: null,
  new_health_employee_burden: null,
  reason: "",
  applied_at: null,
  created_at: "",
  ...a,
});

// 2026-11 調 36,000 → 38,000（勞保自付 915 → 955）；2027-01 調 38,000 → 40,000（健保自付 563 → 600，尚未生效）
const HISTORY = [
  adj({ effective_month: "2026-11", old_wage: 36000, new_wage: 38000, old_labor_employee_burden: 915, new_labor_employee_burden: 955 }),
  adj({ effective_month: "2027-01", old_wage: 38000, new_wage: 40000, old_health_employee_burden: 563, new_health_employee_burden: 600 }),
];
// 目前資料：2026-11 那筆已寫入，2027-01 尚未
const CURRENT = { wage: 38000, laborInsuranceBracket: 38200, laborEmployeeBurden: 955, healthEmployeeBurden: 563 };

describe("結算月份適用的月薪與勞健保", () => {
  it("調薪前的月份用舊月薪與舊勞保", () => {
    expect(payrollProfileForPeriod(HISTORY, "2026-10", CURRENT)).toMatchObject({
      wage: 36000,
      laborEmployeeBurden: 915,
      healthEmployeeBurden: 563,
    });
  });

  it("生效當月起用新月薪；健保在 2027-01 才變", () => {
    expect(payrollProfileForPeriod(HISTORY, "2026-12", CURRENT)).toMatchObject({
      wage: 38000,
      laborEmployeeBurden: 955,
      healthEmployeeBurden: 563,
    });
  });

  it("提前登記的調薪：2027-01 起用新月薪與新健保（即使目前資料還沒更新）", () => {
    expect(payrollProfileForPeriod(HISTORY, "2027-01", CURRENT)).toMatchObject({
      wage: 40000,
      laborEmployeeBurden: 955,
      healthEmployeeBurden: 600,
    });
  });

  it("沒有調薪紀錄就用目前資料", () => {
    expect(payrollProfileForPeriod([], "2026-11", CURRENT)).toEqual(CURRENT);
  });
});

describe("調薪相關小工具", () => {
  it("加班日費率與資料庫產生欄位同公式（月薪 36,000 → 1,900）", () => {
    // 150 × 4/3 × 2 + 150 × 5/3 × 6 = 400 + 1500 = 1900
    expect(overtimeDailyRateFromWage(36000)).toBe(1900);
  });

  it("下個月（跨年）", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2026-10")).toBe("2026-11");
  });

  it("薪資單備註", () => {
    expect(formatSalaryAdjustmentRemark({ ...HISTORY[0], reason: "年度調薪" })).toBe(
      "調薪：月薪 36,000 → 38,000（2026-11 起；年度調薪；勞保自付 915 → 955）",
    );
    expect(formatSalaryAdjustmentRemark({ ...HISTORY[1], reason: "升任組長" })).toBe(
      "調薪：月薪 38,000 → 40,000（2027-01 起；升任組長；健保自付 563 → 600）",
    );
  });
});
