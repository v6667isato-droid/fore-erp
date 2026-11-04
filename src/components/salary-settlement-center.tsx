"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAllLeaveTypes, type LeaveTypeRow } from "@/lib/leave-types";
import {
  getSupabaseSession,
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Banknote, CalendarRange, Eye, Sparkles } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  buildPayslipAttendanceRemarks,
  isPayOvertimeRecord,
  overtimeHoursToHalfDaySteps,
} from "@/lib/payslip-attendance-remarks";
import {
  formatSemiAnnualBonusPayrollNote,
  formatSemiAnnualBonusRemark,
  loadSemiAnnualBonusesForPayroll,
  parsePayrollBonusFromNotes,
  SEMI_ANNUAL_BONUS_REMARK_RE,
  suggestBonusPeriodForPayMonth,
  type SemiAnnualBonusDetail,
} from "@/lib/performance-bonus-payroll";
import {
  annualLeaveUsedDays,
  fetchLeaveLedger,
  formatLedgerRemarkLines,
  LEAVE_LEDGER_REMARK_RE,
  ledgerNetHours,
  unbilledLedgerEntries,
  type LeaveLedgerEntry,
  type LedgerContext,
} from "@/lib/leave-ledger";
import {
  computeLeaveSalarySettlement,
  currentHoursByType,
  formatPriorLeaveAdjustmentLines,
  PRIOR_LEAVE_ADJUST_REMARK_RE,
  type LeaveSalarySettlement,
  type LeaveSettlementItem,
  type PaidSlipForSettlement,
} from "@/lib/leave-salary-settlement";
import { fetchEmployeeLeaveBalances } from "@/lib/leave-balance-availability";
import { markLedgerPayslipRpc } from "@/lib/leave-balance-rpc";
import {
  buildLeaveHolidayLookup,
  formatSignedDayDecimalAsDayHour,
  LEAVE_WORK_DAY_HOURS,
  type LeaveHolidayRow,
} from "@/lib/employee-leave-time";
import {
  formatLeaveHoursLabel,
  leaveRequestHoursInRange,
  leaveRequestTotalHours,
  type LeaveHolidayLookup,
} from "@/lib/leave-hours";
import { seniorityFromHire } from "@/lib/employee-seniority";
import { NumericInput } from "@/components/ui/numeric-input";

interface SettlementEmployee {
  id: string;
  name: string;
  /** 發薪通知用；payroll_notification_email 空則用此 */
  email: string | null;
  payroll_notification_email: string | null;
  remittance_bank: string | null;
  remittance_account: string | null;
  monthly_wage: number;
  labor_insurance: number;
  /** 健保自付「每人」金額（employees.health_employee_burden） */
  health_insurance_per_person: number;
  /** 健保自付扣款合計＝每人金額 × 加保人數（見 mapRowToSettlementEmployee） */
  health_insurance: number;
  /** employees.health_insured_persons，寫入薪資單快照 */
  health_insured_persons: number | null;
  overtime_rate: number | null;
  annual_leave_remaining: number | null;
  /** 補休金庫餘額（小時，employees.comp_leave_remaining）；舊 schema 查不到時為 null */
  comp_leave_remaining: number | null;
  hire_date: string | null;
  share_count: number;
  unpaid_leave_months: string[];
}

interface RowInputs {
  /** 考績／分潤／股份等獎金（發放寫入 payslips.payroll_bonus） */
  semiAnnualBonus: number;
  otherAdjust: number;
  /** 出勤備註（預設系統產生，老闆可改；發放寫入 payslips.notes） */
  attendanceNotes: string;
}

function defaultRowInputs(): RowInputs {
  return {
    semiAnnualBonus: 0,
    otherAdjust: 0,
    attendanceNotes: "",
  };
}

/**
 * 該員工本月核准加班統計（小時）：折抵方式由員工申報時決定
 * （overtime_records.reason 前綴【加班費】＝計薪；其餘含手動補登＝轉補休），
 * 管理端不再手動勾選。
 */
function overtimeMonthStats(
  employeeId: string,
  overtimeRows: Record<string, unknown>[],
): { total: number; pay: number; comp: number } {
  let total = 0;
  let pay = 0;
  let comp = 0;
  for (const r of overtimeRows) {
    if (String(r.employee_id ?? "") !== employeeId) continue;
    const h = num(r.hours, 0);
    if (h <= 0) continue;
    total += h;
    if (isPayOvertimeRecord(r)) pay += h;
    else comp += h;
  }
  return { total, pay, comp };
}

/** 加班費金額 = 折抵加班費時數 × 日費率 ÷ 8 */
function overtimePayAmount(payHours: number, dailyRate: number | null): number {
  const rate = dailyRate != null && dailyRate > 0 ? dailyRate : 0;
  return Math.round((rate * payHours) / 8);
}

/** 特休欄位精簡顯示：小數日 → 「4D4H」（1 天 = 8 小時；負值 −0D4H） */
function formatDayHourShort(daysDecimal: number): string {
  const sign = daysDecimal < 0 ? "−" : "";
  const abs = Math.abs(daysDecimal);
  let d = Math.floor(abs + 1e-9);
  let h = Math.round((abs - d) * 8 * 100) / 100;
  if (h >= 8) {
    d += 1;
    h = 0;
  }
  const hDisp = Number.isInteger(h) ? String(h) : String(h);
  return `${sign}${d}D${hDisp}H`;
}

function isPaidStatus(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "paid" || s === "已發放" || s === "發放";
}

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function monthBounds(ym: string): { start: string; end: string; label: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  const last = new Date(p.y, p.m, 0);
  const end = `${p.y}-${String(p.m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const start = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
  return { start, end, label: `${p.y} 年 ${p.m} 月` };
}

/** 結算月份之 created_at 篩選（本地日曆月：月初 00:00 至次月月初前） */
function monthCreatedAtFilterBounds(ym: string): { gte: string; lt: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  const start = new Date(p.y, p.m - 1, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(p.y, p.m, 1, 0, 0, 0, 0);
  return { gte: start.toISOString(), lt: nextMonthStart.toISOString() };
}

function parseLocalYmd(s: string): Date {
  const [yy, mm, dd] = s.slice(0, 10).split("-").map((x) => Number(x));
  return new Date(yy, mm - 1, dd);
}

function isLeaveApproved(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

function isLeavePending(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "pending" || s === "待審核" || s === "";
}

/** M/D（跨日為 M/D–M/D） */
function shortDateRange(start: string, end: string): string {
  const f = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  return start === end || !end ? f(start) : `${f(start)}–${f(end)}`;
}

function leaveTypeRaw(row: Record<string, unknown>): string {
  return String(row.leave_type ?? row.type_label ?? row.type ?? "").trim();
}

/**
 * 扣薪比例 = 1 − leave_types.pay_ratio（全薪 0、半薪 0.5、不給薪 1）。
 * leave_types 未載入或查無該假別時退回舊規則：事假全扣、病假半薪、其餘不扣。
 * 注意：產假 pay_ratio 存 1.0（未滿一年半薪需依年資人工用「調整」欄處理）。
 */
function leaveDeductionRatio(
  name: string,
  typeByName: Map<string, LeaveTypeRow> | null,
): number {
  const t = name.trim();
  if (!t) return 0;
  const lt = typeByName?.get(t);
  if (lt) {
    const r = 1 - lt.pay_ratio;
    return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  }
  if (t.includes("事假")) return 1;
  if (t.includes("病假")) return 0.5;
  return 0;
}

/** 待審假單（發放前提醒；發放後才核准者不會列入本月結算） */
type PendingLeaveInfo = {
  type: string;
  start: string;
  end: string;
  hours: number;
};

/** 單一員工當月請假統計（扣薪由 computeLeaveSalarySettlement 計算；特休／補休於核准時已扣） */
type LeaveMonthStats = {
  /** 其他假期（非事假病假：婚假、生理假、公假、特休、補休等）假別名稱 → 本月請假時數 */
  otherHoursByType: Map<string, number>;
  /** 本月相關的待審假單（扣薪與其他假別；特休／補休核准時才扣，與本月結算無關） */
  pending: PendingLeaveInfo[];
};

function emptyLeaveMonthStats(): LeaveMonthStats {
  return { otherHoursByType: new Map(), pending: [] };
}

function pendingLeaveLabel(p: PendingLeaveInfo): string {
  return `${p.type} ${shortDateRange(p.start, p.end)}（${formatLeaveHoursLabel(p.hours)}）`;
}

/** 其他假期彙整：{ days: 總天數（時數 ÷ 8）, detail: 「婚假 2 天、生理假 4 小時」} */
function summarizeOtherLeave(st: LeaveMonthStats): {
  days: number;
  detail: string | null;
} {
  let hours = 0;
  const parts: string[] = [];
  for (const [name, h] of st.otherHoursByType) {
    hours += h;
    parts.push(`${name} ${formatLeaveHoursLabel(h)}`);
  }
  return {
    days: hours / LEAVE_WORK_DAY_HOURS,
    detail: parts.length ? parts.join("、") : null,
  };
}

const EMPTY_SETTLEMENT: LeaveSalarySettlement = {
  current: [],
  adjustments: [],
  total: 0,
  currentHours: 0,
};

/** 請假扣款說明：「事假 4 小時 · 病假 1 天 · 前期調整 補發 1,200」 */
function settlementBreakdownLabel(s: LeaveSalarySettlement): string {
  const parts = [...currentHoursByType(s.current)].map(
    ([name, h]) => `${name} ${formatLeaveHoursLabel(h)}`,
  );
  if (s.adjustments.length > 0) {
    const adj = Math.round(s.adjustments.reduce((sum, a) => sum + a.amount, 0));
    parts.push(`前期調整 ${adj >= 0 ? "補扣" : "補發"} ${Math.abs(adj).toLocaleString("zh-TW")}`);
  }
  return parts.join(" · ");
}

/** 備註自動行（特休／補休異動、前期請假調整）：移除舊行後附上新的，其餘手寫備註保留 */
function withAutoRemarkLines(
  notes: string,
  lines: { ledger: readonly string[]; adjust: readonly string[] },
): string {
  const kept = notes
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !LEAVE_LEDGER_REMARK_RE.test(t) && !PRIOR_LEAVE_ADJUST_REMARK_RE.test(t);
    })
    .join("\n")
    .replace(/\n+$/, "");
  return [kept, ...lines.ledger, ...lines.adjust].filter(Boolean).join("\n");
}

/** leave_type 為「特休」 */
function isSpecialAnnualLeave(row: Record<string, unknown>): boolean {
  const v = row.leave_type;
  if (v == null) return false;
  return String(v).trim() === "特休";
}

/** leave_type 為「補休」（含「補休假」等變體） */
function isCompLeave(row: Record<string, unknown>): boolean {
  const v = row.leave_type;
  if (v == null) return false;
  return String(v).trim().startsWith("補休");
}

function leaveEmployeeId(row: Record<string, unknown>): string | null {
  const v = row.employee_id ?? row.employeeId;
  if (v == null || v === "") return null;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 已發放列顯示用：payslips 發放當下的假勤快照（舊資料無快照欄時為 null → 退回即時值） */
type PaidLeaveSnap = {
  /** special_leave_days_settled（天） */
  specialSettled: number | null;
  /** special_leave_remaining_after（天） */
  specialAfter: number | null;
  /** comp_leave_remaining_after（小時） */
  compAfter: number | null;
  /** leave_deduction（元）：已發放列顯示發放當下的請假扣款，不隨扣薪規則調整而變動 */
  leaveDeduction: number | null;
};

function isPayslipMissingColumnError(message: string): boolean {
  return /could not find|column .* does not exist|schema cache/i.test(message);
}

/** 資料列真的撞唯一鍵（duplicate key）。勿用 /unique/ 寬鬆比對，否則會把「ON CONFLICT 找不到唯一限制」誤當成重複發放。 */
function isPayslipDuplicateRowError(message: string): boolean {
  const m = message.toLowerCase();
  if (/no unique or exclusion constraint matching/i.test(m)) return false;
  return (
    /duplicate key value violates unique constraint/i.test(m) ||
    /\b23505\b/.test(m) ||
    /unique constraint.*violat/i.test(m)
  );
}

function isPayslipOnConflictTargetError(message: string): boolean {
  return /no unique or exclusion constraint matching/i.test(message);
}

/**
 * 若遠端 payslips 尚未建明細欄位，改寫入核心欄位以免發薪失敗。
 * 發薪成功後會再嘗試 UPDATE 補齊（欄位已存在時可自動寫回）。
 *
 * 完整寫入對照（insertPayload）：
 * - 識別／期間：employee_id, period_key, pay_period, month_label
 * - 金額：base_salary, net_pay, net_salary, bonus_and_overtime, leave_deduction, other_adjust
 * - 勞健保快照：labor_insurance_employee, health_insurance_employee, health_insured_persons
 * - 假勤／加班：overtime_days, special_leave_days_settled, special_leave_remaining_after,
 *   comp_leave_remaining_after, leave_days, other_leave_days, other_leave_detail
 * - 出勤備註：notes
 * 上述「明細快照」鍵若缺欄會先略過；bonus_and_overtime／leave_deduction 不在此列，fallback 時仍會寫入。
 */
const PAYSLIP_DETAIL_SNAPSHOT_KEYS = [
  "labor_insurance_employee",
  "health_insurance_employee",
  "health_insured_persons",
  "overtime_days",
  "special_leave_days_settled",
  "special_leave_remaining_after",
  "comp_leave_remaining_after",
  "leave_days",
  "other_leave_days",
  "other_leave_detail",
  "leave_settlement",
  "other_adjust",
] as const;

function mapRowToSettlementEmployee(r: Record<string, unknown>): SettlementEmployee {
  /** 與員工維護頁一致：labor_employee_burden / health_employee_burden / health_employee_burden_number */
  const labor = num(r.labor_employee_burden ?? r.labor_insurance, 0);
  const healthPerPerson = num(r.health_employee_burden ?? r.health_insurance, 0);
  const hipRaw = r.health_employee_burden_number ?? r.health_insured_persons;
  const healthInsuredPersons =
    hipRaw != null && hipRaw !== "" && Number.isFinite(Number(hipRaw))
      ? Math.max(0, Math.trunc(num(hipRaw)))
      : null;
  /** 與員工維護「健保自付額 × 健保投保人數」一致；人數未填或 ≤0 時乘數視為 1 */
  const healthMult =
    healthInsuredPersons != null && healthInsuredPersons > 0 ? healthInsuredPersons : 1;
  const healthTotal = Math.round(healthPerPerson * healthMult);
  const email =
    r.email != null && String(r.email).trim() !== "" ? String(r.email).trim() : null;
  const payrollNotify =
    r.payroll_notification_email != null && String(r.payroll_notification_email).trim() !== ""
      ? String(r.payroll_notification_email).trim()
      : null;
  const remittanceBank =
    r.remittance_bank != null && String(r.remittance_bank).trim() !== ""
      ? String(r.remittance_bank).trim()
      : null;
  const remittanceAccount =
    r.remittance_account != null && String(r.remittance_account).trim() !== ""
      ? String(r.remittance_account).trim()
      : null;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    email,
    payroll_notification_email: payrollNotify,
    remittance_bank: remittanceBank,
    remittance_account: remittanceAccount,
    monthly_wage: num(r.basic_salary ?? r.monthly_wage, 0),
    labor_insurance: labor,
    health_insurance_per_person: healthPerPerson,
    health_insurance: healthTotal,
    health_insured_persons: healthInsuredPersons,
    overtime_rate:
      r.overtime_rate != null && r.overtime_rate !== ""
        ? num(r.overtime_rate)
        : null,
    annual_leave_remaining:
      r.annual_leave_remaining != null && r.annual_leave_remaining !== ""
        ? num(r.annual_leave_remaining)
        : null,
    comp_leave_remaining:
      r.comp_leave_remaining != null && r.comp_leave_remaining !== ""
        ? num(r.comp_leave_remaining)
        : null,
    hire_date:
      r.hire_date != null && String(r.hire_date).trim() !== ""
        ? String(r.hire_date).slice(0, 10)
        : null,
    share_count:
      r.share_count != null && r.share_count !== ""
        ? Math.max(0, Math.trunc(num(r.share_count)))
        : 0,
    unpaid_leave_months: Array.isArray(r.unpaid_leave_months)
      ? (r.unpaid_leave_months as unknown[]).map(String)
      : [],
  };
}

const EMP_SELECT_ATTEMPTS = [
  "id, name, email, payroll_notification_email, remittance_bank, remittance_account, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, hire_date, share_count, unpaid_leave_months, employment_status, deleted_at",
  "id, name, email, payroll_notification_email, remittance_bank, remittance_account, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, email, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, employment_status",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, overtime_rate, annual_leave_remaining, employment_status",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, overtime_rate, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, overtime_rate, employment_status",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, employment_status, deleted_at",
  "id, name, monthly_wage, labor_employee_burden, health_employee_burden, employment_status",
  "id, name, monthly_wage, labor_insurance, health_insurance, health_insured_persons, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_insurance, health_insurance, health_insured_persons, overtime_rate, annual_leave_remaining, employment_status",
  "id, name, monthly_wage, labor_insurance, health_insurance, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, monthly_wage, labor_insurance, health_insurance, overtime_rate, annual_leave_remaining, employment_status",
];

export function SalarySettlementCenter() {
  const [payPeriod, setPayPeriod] = useState(ymNow);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<SettlementEmployee[]>([]);
  const [leaveRows, setLeaveRows] = useState<Record<string, unknown>[]>([]);
  /** 涵蓋結算月與跨月假單起訖的 public_holidays（放假＋補班），請假時數分攤用 */
  const [holidayRows, setHolidayRows] = useState<LeaveHolidayRow[]>([]);
  const holidayLookup: LeaveHolidayLookup = useMemo(
    () => buildLeaveHolidayLookup(holidayRows),
    [holidayRows],
  );
  const [attendanceRows, setAttendanceRows] = useState<Record<string, unknown>[]>(
    [],
  );
  const [overtimeRows, setOvertimeRows] = useState<Record<string, unknown>[]>([]);
  const [inputs, setInputs] = useState<Record<string, RowInputs>>({});
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [paidLeaveSnapByEmp, setPaidLeaveSnapByEmp] = useState<
    Map<string, PaidLeaveSnap>
  >(new Map());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [remarkDialog, setRemarkDialog] = useState<{
    open: boolean;
    name: string;
    empId: string | null;
  }>({ open: false, name: "", empId: null });
  /** 特休／補休異動紀錄（leave_balance_ledger）與備註用的假單／授予摘要 */
  const [ledger, setLedger] = useState<LedgerContext>({
    entries: [],
    leaves: new Map(),
    grants: new Map(),
    missing: false,
  });
  /** 其他已發放、有扣薪明細（leave_settlement）的薪資單：跨月補扣／補發對帳用 */
  const [paidSettlementSlips, setPaidSettlementSlips] = useState<
    Map<string, PaidSlipForSettlement[]>
  >(new Map());
  /** 對帳月份內的假單（不限本月），含撤銷者 */
  const [reconLeaveRows, setReconLeaveRows] = useState<Record<string, unknown>[]>([]);
  /** load 重設 inputs 後遞增，讓備註自動行重新套用 */
  const [inputsEpoch, setInputsEpoch] = useState(0);
  const [bonusImportLabel, setBonusImportLabel] = useState<string | null>(null);
  const [bonusDetailByEmp, setBonusDetailByEmp] = useState<
    Record<string, SemiAnnualBonusDetail>
  >({});
  const [importingBonus, setImportingBonus] = useState(false);
  /** 假別主檔（pay_ratio 扣薪比例）；載入失敗時為 null → 退回舊規則（事假全扣、病假半薪） */
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchAllLeaveTypes();
        if (!cancelled && list.length > 0) setLeaveTypes(list);
      } catch (e) {
        console.warn("[salary-settlement] leave_types 載入失敗，退回預設扣薪規則", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const leaveTypeByName = useMemo(() => {
    if (!leaveTypes) return null;
    const m = new Map<string, LeaveTypeRow>();
    for (const lt of leaveTypes) m.set(lt.name, lt);
    return m;
  }, [leaveTypes]);

  const bounds = useMemo(() => monthBounds(payPeriod), [payPeriod]);

  /** 年資里程碑判斷基準：結算月份月底 */
  const monthEndDate = useMemo(
    () => (bounds ? parseLocalYmd(bounds.end) : new Date()),
    [bounds],
  );

  const leaveStatsByEmployee = useMemo(() => {
    const map = new Map<string, LeaveMonthStats>();
    if (!bounds) return map;
    for (const raw of leaveRows) {
      const status = String(raw.status ?? "");
      const approved = isLeaveApproved(status);
      const pending = !approved && isLeavePending(status);
      if (!approved && !pending) continue;
      const eid = leaveEmployeeId(raw);
      if (!eid) continue;
      const start = String(raw.start_date ?? raw.start ?? "").slice(0, 10);
      const end = String(raw.end_date ?? raw.end ?? start).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;

      /** 本月請假時數（跨月假單依各月工時比例分攤） */
      const hoursInMonth = leaveRequestHoursInRange(raw, bounds.start, bounds.end, holidayLookup);
      if (hoursInMonth <= 0) continue;
      const cur = map.get(eid) ?? emptyLeaveMonthStats();
      const name = leaveTypeRaw(raw) || "請假";
      const balanceType = isSpecialAnnualLeave(raw) || isCompLeave(raw);

      if (pending) {
        // 特休／補休核准時才扣餘額，不影響本月結算；其餘假別發放後才核准者於下次結算補扣
        if (!balanceType) {
          cur.pending.push({ type: name, start, end, hours: leaveRequestTotalHours(raw, holidayLookup) });
          map.set(eid, cur);
        }
        continue;
      }

      // 其他假期（婚假、生理假、公假、特休、補休等）：記錄假別與本月時數，
      // 發放時寫入 payslips.other_leave_days / other_leave_detail 供薪資單備註
      if (name !== "事假" && name !== "病假") {
        cur.otherHoursByType.set(name, (cur.otherHoursByType.get(name) ?? 0) + hoursInMonth);
      }
      map.set(eid, cur);
    }
    return map;
  }, [leaveRows, bounds, holidayLookup]);

  /** 扣薪假別結算（本月＋已發放月份的補扣／補發） */
  const leaveSettlementByEmp = useMemo(() => {
    const m = new Map<string, LeaveSalarySettlement>();
    const byEmp = new Map<string, Map<string, Record<string, unknown>>>();
    for (const r of [...reconLeaveRows, ...leaveRows]) {
      const eid = leaveEmployeeId(r);
      if (!eid || r.id == null) continue;
      const inner = byEmp.get(eid) ?? new Map<string, Record<string, unknown>>();
      inner.set(String(r.id), r);
      byEmp.set(eid, inner);
    }
    for (const emp of employees) {
      m.set(
        emp.id,
        computeLeaveSalarySettlement({
          period: payPeriod,
          monthlyWage: emp.monthly_wage,
          leaves: [...(byEmp.get(emp.id)?.values() ?? [])],
          ratioOf: (name) => leaveDeductionRatio(name, leaveTypeByName),
          holidayLookup,
          paidSlips: paidSettlementSlips.get(emp.id) ?? [],
        }),
      );
    }
    return m;
  }, [employees, leaveRows, reconLeaveRows, payPeriod, leaveTypeByName, holidayLookup, paidSettlementSlips]);

  /** 結算月結束（本地時間次月月初）：異動發生在此之前、尚未列入薪資單者列入本月備註 */
  const monthEndIso = useMemo(() => monthCreatedAtFilterBounds(payPeriod)?.lt ?? null, [payPeriod]);

  const ledgerByEmp = useMemo(() => {
    const m = new Map<string, LeaveLedgerEntry[]>();
    for (const e of ledger.entries) {
      const list = m.get(e.employee_id) ?? [];
      list.push(e);
      m.set(e.employee_id, list);
    }
    return m;
  }, [ledger]);

  /** 本月的特休／補休異動：未發放＝尚未列入薪資單且在月底前；已發放＝已標記為本月 */
  const monthLedgerFor = useCallback(
    (empId: string, paid: boolean): LeaveLedgerEntry[] => {
      const list = ledgerByEmp.get(empId) ?? [];
      if (paid) return list.filter((e) => e.payslip_period === payPeriod);
      return monthEndIso ? unbilledLedgerEntries(list, monthEndIso) : [];
    },
    [ledgerByEmp, payPeriod, monthEndIso],
  );

  /** 未發放員工的備註自動行 */
  const autoRemarkByEmp = useMemo(() => {
    const m = new Map<string, { ledger: string[]; adjust: string[] }>();
    for (const emp of employees) {
      if (paidIds.has(emp.id)) continue;
      m.set(emp.id, {
        ledger: formatLedgerRemarkLines(monthLedgerFor(emp.id, false), ledger.leaves, ledger.grants),
        adjust: formatPriorLeaveAdjustmentLines(leaveSettlementByEmp.get(emp.id)?.adjustments ?? []),
      });
    }
    return m;
  }, [employees, paidIds, monthLedgerFor, ledger, leaveSettlementByEmp]);

  useEffect(() => {
    if (autoRemarkByEmp.size === 0) return;
    setInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, lines] of autoRemarkByEmp) {
        const cur = prev[id];
        if (!cur) continue;
        const updated = withAutoRemarkLines(cur.attendanceNotes, lines);
        if (updated !== cur.attendanceNotes) {
          next[id] = { ...cur, attendanceNotes: updated };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [autoRemarkByEmp, inputsEpoch]);

  /** 尚未發放員工的待審假單合計（頁首提醒） */
  const pendingLeaveSummary = useMemo(() => {
    let count = 0;
    const names: string[] = [];
    for (const emp of employees) {
      if (paidIds.has(emp.id)) continue;
      const n = leaveStatsByEmployee.get(emp.id)?.pending.length ?? 0;
      if (n <= 0) continue;
      count += n;
      names.push(n > 1 ? `${emp.name} ${n} 張` : emp.name);
    }
    return { count, names };
  }, [employees, paidIds, leaveStatsByEmployee]);

  const load = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseConfigured) {
      setFetchError(SUPABASE_CONFIG_HELP);
      return false;
    }
    if (!bounds) {
      setFetchError("結算月份格式不正確");
      return false;
    }
    setLoading(true);
    setFetchError(null);
    try {
      let empRes: {
        data: unknown[] | null;
        error: { message: string } | null;
      } = { data: null, error: { message: "no attempt" } };

      for (const sel of EMP_SELECT_ATTEMPTS) {
        const r = await supabase
          .from("employees")
          .select(sel)
          .eq("employment_status", true);
        if (!r.error) {
          empRes = { data: r.data as unknown[], error: null };
          break;
        }
        empRes = { data: null, error: r.error };
      }

      if (empRes.error) {
        setFetchError(empRes.error.message);
        setEmployees([]);
        setLeaveRows([]);
        setAttendanceRows([]);
        setOvertimeRows([]);
        setPaidIds(new Set());
        return false;
      }

      const emps: SettlementEmployee[] = (empRes.data ?? [])
        .filter((r) => {
          const da = (r as { deleted_at?: string | null }).deleted_at;
          return da == null;
        })
        .map((r) => mapRowToSettlementEmployee(r as Record<string, unknown>));

      /** 補休金庫餘額另查合併：EMP_SELECT_ATTEMPTS 依實際 schema 逐組 fallback，
       *  成功的那組不一定含 comp_leave_remaining，故不併入該串避免整組失敗 */
      const compRes = await supabase
        .from("employees")
        .select("id, comp_leave_remaining");
      if (!compRes.error) {
        const compById = new Map(
          (compRes.data ?? []).map((r) => {
            const rec = r as { id: string; comp_leave_remaining?: unknown };
            return [
              String(rec.id),
              rec.comp_leave_remaining != null && rec.comp_leave_remaining !== ""
                ? num(rec.comp_leave_remaining)
                : null,
            ] as const;
          }),
        );
        for (const e of emps) {
          const v = compById.get(e.id);
          if (v !== undefined) e.comp_leave_remaining = v;
        }
      }

      setEmployees(emps);

      const ids = emps.map((e) => e.id);
      if (ids.length === 0) {
        setLeaveRows([]);
        setAttendanceRows([]);
        setOvertimeRows([]);
        setPaidIds(new Set());
        setInputs({});
        setLedger({ entries: [], leaves: new Map(), grants: new Map(), missing: false });
        setPaidSettlementSlips(new Map());
        setReconLeaveRows([]);
        return true;
      }

      const [leaveOverlapRes, attRes, otRes, ledgerCtx, settledSlipRes, makeupRes] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("*")
          .in("employee_id", ids)
          .lte("start_date", bounds.end)
          .gte("end_date", bounds.start),
        supabase
          .from("daily_attendance")
          .select(
            "employee_id, attendance_date, clock_in, clock_out, total_hours, is_abnormal, status_tags",
          )
          .gte("attendance_date", bounds.start)
          .lte("attendance_date", bounds.end)
          .in("employee_id", ids),
        supabase
          .from("overtime_records")
          .select("employee_id, overtime_date, hours, reason")
          .gte("overtime_date", bounds.start)
          .lte("overtime_date", bounds.end)
          .in("employee_id", ids),
        fetchLeaveLedger(ids).catch((e: unknown) => {
          console.warn("[salary-settlement] leave_balance_ledger:", e);
          return { entries: [], leaves: new Map(), grants: new Map(), missing: true } as LedgerContext;
        }),
        supabase
          .from("payslips")
          .select("employee_id, period_key, status, base_salary, leave_settlement")
          .in("employee_id", ids)
          .not("leave_settlement", "is", null),
        supabase
          .from("makeup_punch_requests")
          .select("employee_id, punch_date, clock_in, clock_out")
          .eq("status", "approved")
          .gte("punch_date", bounds.start)
          .lte("punch_date", bounds.end)
          .in("employee_id", ids),
      ]);

      setLedger(ledgerCtx);

      /** 其他已發放、有扣薪明細的薪資單（對帳用；欄位尚未建立時略過） */
      const slipMap = new Map<string, PaidSlipForSettlement[]>();
      if (!settledSlipRes.error) {
        for (const r of (settledSlipRes.data ?? []) as {
          employee_id?: string;
          period_key?: string;
          status?: string;
          base_salary?: unknown;
          leave_settlement?: unknown;
        }[]) {
          if (!r.employee_id || !isPaidStatus(r.status)) continue;
          const pk = String(r.period_key ?? "").slice(0, 7);
          if (!/^\d{4}-\d{2}$/.test(pk) || pk === payPeriod) continue;
          const list = slipMap.get(r.employee_id) ?? [];
          list.push({
            period: pk,
            baseSalary: num(r.base_salary, 0),
            items: Array.isArray(r.leave_settlement)
              ? (r.leave_settlement as LeaveSettlementItem[])
              : null,
          });
          slipMap.set(r.employee_id, list);
        }
      }
      setPaidSettlementSlips(slipMap);

      /** 對帳月份（早於本月）內的假單，含撤銷者 */
      let reconRows: Record<string, unknown>[] = [];
      const trackedPeriods = [...slipMap.values()]
        .flat()
        .map((x) => x.period)
        .filter((pk) => pk < payPeriod)
        .sort();
      if (trackedPeriods.length > 0) {
        const fromB = monthBounds(trackedPeriods[0]);
        const toB = monthBounds(trackedPeriods[trackedPeriods.length - 1]);
        if (fromB && toB) {
          const reconRes = await supabase
            .from("leave_requests")
            .select("*")
            .in("employee_id", ids)
            .lte("start_date", toB.end)
            .gte("end_date", fromB.start);
          if (!reconRes.error) reconRows = (reconRes.data ?? []) as unknown as Record<string, unknown>[];
        }
      }
      setReconLeaveRows(reconRows);

      // 結算月內放假日：出勤備註自動寫入、抑制請假／放假日的無打卡異常。
      // 查詢範圍延伸到跨月假單的起訖，供請假時數依月份工時分攤。
      let holidayFrom = bounds.start;
      let holidayTo = bounds.end;
      for (const r of [
        ...((leaveOverlapRes.data ?? []) as unknown as Record<string, unknown>[]),
        ...reconRows,
      ]) {
        const s = String(r.start_date ?? "").slice(0, 10);
        const e = String(r.end_date ?? s).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s < holidayFrom) holidayFrom = s;
        if (/^\d{4}-\d{2}-\d{2}$/.test(e) && e > holidayTo) holidayTo = e;
      }
      const holidayRes = await supabase
        .from("public_holidays")
        .select("holiday_date, name, is_workday")
        .gte("holiday_date", holidayFrom)
        .lte("holiday_date", holidayTo);
      const holidayList = (holidayRes.data ?? []) as {
        holiday_date?: string;
        name?: string | null;
        is_workday?: boolean | null;
      }[];
      setHolidayRows(
        holidayList
          .filter((h) => h.holiday_date)
          .map((h) => ({
            holiday_date: String(h.holiday_date).slice(0, 10),
            is_workday: h.is_workday === true,
          })),
      );
      const monthHolidays = holidayList
        .filter((h) => {
          const d = String(h.holiday_date ?? "").slice(0, 10);
          return h.is_workday !== true && d >= bounds.start && d <= bounds.end;
        })
        .map((h) => ({
          date: String(h.holiday_date).slice(0, 10),
          name: (h.name ?? "").trim() || "臨時假日",
        }));

      let slipRes = await supabase
        .from("payslips")
        .select(
          "employee_id, period_key, status, notes, overtime_days, other_adjust, payroll_bonus, bonus_and_overtime, special_leave_days_settled, special_leave_remaining_after, comp_leave_remaining_after",
        )
        .eq("period_key", payPeriod)
        .in("employee_id", ids);
      if (
        slipRes.error &&
        /column|does not exist/i.test(slipRes.error.message ?? "")
      ) {
        slipRes = (await supabase
          .from("payslips")
          .select("employee_id, period_key, status, notes")
          .eq("period_key", payPeriod)
          .in("employee_id", ids)) as typeof slipRes;
        if (!slipRes.error) {
          console.warn(
            "[salary-settlement] payslips 缺少 overtime_days/other_adjust/bonus_and_overtime 欄位，已發放列無法還原輸入。請套用 supabase/sql/payslips_settlement_columns.sql",
          );
        }
      }

      let mergedLeaveForInputs: Record<string, unknown>[] = [];
      if (leaveOverlapRes.error) {
        if (/does not exist|relation|column/i.test(leaveOverlapRes.error.message)) {
          setLeaveRows([]);
        } else {
          console.warn(
            "[salary-settlement] leave_requests (overlap):",
            leaveOverlapRes.error.message,
          );
          toast.error(leaveOverlapRes.error.message || "請假資料讀取失敗");
          setLeaveRows([]);
        }
      } else {
        mergedLeaveForInputs = (leaveOverlapRes.data ?? []) as unknown as Record<string, unknown>[];
        setLeaveRows(mergedLeaveForInputs);
      }

      if (attRes.error) {
        if (!/does not exist|relation|column/i.test(attRes.error.message)) {
          console.warn(
            "[salary-settlement] daily_attendance:",
            attRes.error.message,
          );
        }
        setAttendanceRows([]);
      } else {
        setAttendanceRows((attRes.data ?? []) as Record<string, unknown>[]);
      }

      if (otRes.error) {
        if (!/does not exist|relation|column/i.test(otRes.error.message)) {
          console.warn(
            "[salary-settlement] overtime_records:",
            otRes.error.message,
          );
        }
        setOvertimeRows([]);
      } else {
        setOvertimeRows((otRes.data ?? []) as Record<string, unknown>[]);
      }

      const otList = (otRes.data ?? []) as Record<string, unknown>[];
      const leaveList = mergedLeaveForInputs;
      const attList = (
        attRes.error ? [] : (attRes.data ?? [])
      ) as Record<string, unknown>[];
      // 已核准補打卡：出勤備註寫入「M/D 補打卡」；表尚未建立時靜默略過
      const makeupList = (
        makeupRes.error ? [] : (makeupRes.data ?? [])
      ) as Record<string, unknown>[];

      if (slipRes.error) {
        if (!/does not exist|relation/i.test(slipRes.error.message)) {
          console.warn("[salary-settlement] payslips:", slipRes.error.message);
        }
        setPaidIds(new Set());
      } else {
        const paid = new Set<string>();
        for (const s of slipRes.data ?? []) {
          const row = s as { employee_id?: string; status?: string };
          if (row.employee_id && isPaidStatus(row.status)) {
            paid.add(String(row.employee_id));
          }
        }
        setPaidIds(paid);
      }

      const slipNoteByEmp = new Map<string, string>();
      /** 已發放月份：從 payslips 快照還原加班天數／調整／是否計加班費，避免輸入格永遠顯示 0 */
      const slipPaidSnapshotByEmp = new Map<
        string,
        {
          overtime_days: unknown;
          other_adjust: unknown;
          payroll_bonus: unknown;
          bonus_and_overtime: unknown;
        }
      >();
      const leaveSnapByEmp = new Map<string, PaidLeaveSnap>();
      if (!slipRes.error) {
        for (const s of slipRes.data ?? []) {
          const row = s as {
            employee_id?: string;
            status?: string;
            notes?: string | null;
            overtime_days?: unknown;
            other_adjust?: unknown;
            payroll_bonus?: unknown;
            bonus_and_overtime?: unknown;
            special_leave_days_settled?: unknown;
            special_leave_remaining_after?: unknown;
            comp_leave_remaining_after?: unknown;
          };
          if (!row.employee_id || !isPaidStatus(row.status)) continue;
          const id = String(row.employee_id);
          const noteText = row.notes != null ? String(row.notes) : "";
          slipNoteByEmp.set(id, noteText);
          slipPaidSnapshotByEmp.set(id, {
            overtime_days: row.overtime_days,
            other_adjust: row.other_adjust,
            payroll_bonus: row.payroll_bonus,
            bonus_and_overtime: row.bonus_and_overtime,
          });
          leaveSnapByEmp.set(id, {
            specialSettled: numOrNull(row.special_leave_days_settled),
            specialAfter: numOrNull(row.special_leave_remaining_after),
            compAfter: numOrNull(row.comp_leave_remaining_after),
            leaveDeduction: null,
          });
        }
      }
      /** 已發放列的請假扣款改讀發放當下金額（另查，避免缺欄時拖垮上方快照查詢） */
      const dedRes = await supabase
        .from("payslips")
        .select("employee_id, status, leave_deduction")
        .eq("period_key", payPeriod)
        .in("employee_id", ids);
      if (!dedRes.error) {
        for (const s of (dedRes.data ?? []) as {
          employee_id?: string;
          status?: string;
          leave_deduction?: unknown;
        }[]) {
          if (!s.employee_id || !isPaidStatus(s.status)) continue;
          const id = String(s.employee_id);
          const prev = leaveSnapByEmp.get(id) ?? {
            specialSettled: null,
            specialAfter: null,
            compAfter: null,
            leaveDeduction: null,
          };
          leaveSnapByEmp.set(id, { ...prev, leaveDeduction: numOrNull(s.leave_deduction) });
        }
      }
      setPaidLeaveSnapByEmp(leaveSnapByEmp);

      const initInputs: Record<string, RowInputs> = {};
      for (const e of emps) {
        const snap = slipPaidSnapshotByEmp.get(e.id);
        if (snap) {
          const oa = num(snap.other_adjust, 0);
          const noteText = slipNoteByEmp.get(e.id) ?? "";
          const pbStored = snap.payroll_bonus;
          const hasPayrollBonusCol =
            pbStored != null && pbStored !== "" && Number.isFinite(Number(pbStored));
          const semiBonus = hasPayrollBonusCol
            ? num(pbStored, 0)
            : parsePayrollBonusFromNotes(noteText);
          const otherAdjust = hasPayrollBonusCol
            ? oa
            : Math.max(0, oa - semiBonus);
          const attendanceNotes = slipNoteByEmp.has(e.id)
            ? noteText
            : buildPayslipAttendanceRemarks(e.id, {
                bounds: { start: bounds.start, end: bounds.end },
                payPeriodYm: payPeriod,
                attendanceRows: attList,
                leaveRows: leaveList,
                overtimeRows: otList,
                overtimeDailyRate: e.overtime_rate ?? undefined,
                holidays: monthHolidays,
                makeupPunchRows: makeupList,
              });
          initInputs[e.id] = { semiAnnualBonus: semiBonus, otherAdjust, attendanceNotes };
          continue;
        }

        const attendanceNotes = slipNoteByEmp.has(e.id)
          ? slipNoteByEmp.get(e.id)!
          : buildPayslipAttendanceRemarks(e.id, {
              bounds: { start: bounds.start, end: bounds.end },
              payPeriodYm: payPeriod,
              attendanceRows: attList,
              leaveRows: leaveList,
              overtimeRows: otList,
              overtimeDailyRate: e.overtime_rate ?? undefined,
              holidays: monthHolidays,
              makeupPunchRows: makeupList,
            });
        // 特休／補休異動、前期請假調整由 autoRemarkByEmp 自動附上
        initInputs[e.id] = { semiAnnualBonus: 0, otherAdjust: 0, attendanceNotes };
      }
      setInputs(initInputs);
      setInputsEpoch((n) => n + 1);
      setBonusImportLabel(null);
      setBonusDetailByEmp({});
      return true;
    } finally {
      setLoading(false);
    }
  }, [bounds, payPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggestedBonusPeriod = useMemo(
    () => suggestBonusPeriodForPayMonth(payPeriod),
    [payPeriod],
  );

  async function handleImportSemiAnnualBonus() {
    if (employees.length === 0) {
      toast.error("請先載入本月薪資單");
      return;
    }
    const unpaid = employees.filter((e) => paidIds.has(e.id));
    if (unpaid.length === employees.length) {
      toast.error("本月薪資皆已發放，無法帶入獎金");
      return;
    }

    setImportingBonus(true);
    try {
      const result = await loadSemiAnnualBonusesForPayroll(payPeriod);

      if ("error" in result) {
        toast.error(result.error, { duration: 10000 });
        return;
      }

      const nextDetails: Record<string, SemiAnnualBonusDetail> = {};
      let importedCount = 0;
      let totalBonus = 0;

      setInputs((prev) => {
        const next = { ...prev };
        for (const emp of employees) {
          if (paidIds.has(emp.id)) continue;
          const bonus = result.bonusesByEmployeeId[emp.id] ?? 0;
          const detail = result.detailByEmployeeId[emp.id] ?? {
            yearEnd: 0,
            profitSharing: 0,
            share: 0,
            total: bonus,
          };
          nextDetails[emp.id] = detail;
          if (bonus > 0) {
            importedCount += 1;
            totalBonus += bonus;
          }
          const row = next[emp.id] ?? defaultRowInputs();
          // 備註欄後方附上「YYYY年上/下半年度獎金X元」說明；重複帶入時先移除舊行
          const cleanedNotes = row.attendanceNotes
            .split("\n")
            .filter((line) => !SEMI_ANNUAL_BONUS_REMARK_RE.test(line.trim()))
            .join("\n")
            .replace(/\n+$/, "");
          const nextNotes =
            bonus > 0
              ? [cleanedNotes, formatSemiAnnualBonusRemark(result.period, bonus)]
                  .filter(Boolean)
                  .join("\n")
              : cleanedNotes;
          next[emp.id] = { ...row, semiAnnualBonus: bonus, attendanceNotes: nextNotes };
        }
        return next;
      });

      setBonusDetailByEmp(nextDetails);
      setBonusImportLabel(result.period.label);

      const hints: string[] = [
        `已帶入「${result.period.label}」獎金`,
        `${importedCount} 人、合計 NT$ ${totalBonus.toLocaleString("zh-TW")}`,
      ];
      if (result.issuanceMeta) hints.push(result.issuanceMeta);
      if (result.usedFallbackPeriod) {
        hints.push("（結算月份非典型發放期，已帶入最近一筆發放紀錄）");
      }
      toast.success(hints.join("；"), { duration: 9000 });
    } finally {
      setImportingBonus(false);
    }
  }

  async function handlePay(emp: SettlementEmployee) {
    if (!bounds) return;
    if (paidIds.has(emp.id)) return;

    const { data: existingSlip } = await supabase
      .from("payslips")
      .select("id, status")
      .eq("employee_id", emp.id)
      .eq("period_key", payPeriod)
      .maybeSingle();

    if (
      existingSlip &&
      isPaidStatus(String((existingSlip as { status?: string }).status))
    ) {
      toast.error("此員工該月份薪資已發放，無法重複結算。");
      return;
    }

    const existingSlipId =
      existingSlip != null && (existingSlip as { id?: string }).id != null
        ? String((existingSlip as { id: string }).id)
        : null;

    const st = leaveStatsByEmployee.get(emp.id) ?? emptyLeaveMonthStats();
    const inp = inputs[emp.id] ?? defaultRowInputs();

    // 發放前重新讀取最新的特休／補休異動與餘額（審核頁可能剛核准或回補）
    let fresh: LedgerContext;
    try {
      fresh = await fetchLeaveLedger([emp.id]);
    } catch (e) {
      toast.error(`無法讀取特休／補休異動紀錄：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (fresh.missing) {
      toast.error(
        "資料庫尚未套用新版假勤 migration（leave_balance_ledger），暫停發放以免特休／補休漏扣。請先套用後再發放。",
        { duration: 12000 },
      );
      return;
    }
    const monthEntries = monthEndIso ? unbilledLedgerEntries(fresh.entries, monthEndIso) : [];
    const ledgerLines = formatLedgerRemarkLines(monthEntries, fresh.leaves, fresh.grants);
    let annualAfter = emp.annual_leave_remaining;
    let compAfter = emp.comp_leave_remaining;
    try {
      const b = await fetchEmployeeLeaveBalances(emp.id);
      annualAfter = b.annual;
      compAfter = b.comp;
    } catch (e) {
      console.warn("[salary-settlement] 讀取最新特休／補休餘額失敗，改用畫面上的值", e);
    }

    const settlement = leaveSettlementByEmp.get(emp.id) ?? EMPTY_SETTLEMENT;
    const leaveDedTotal = settlement.total;
    const leaveBreakdown = settlementBreakdownLabel(settlement);
    const adjustLines = formatPriorLeaveAdjustmentLines(settlement.adjustments);
    const ot = overtimeMonthStats(emp.id, overtimeRows);
    const overtimeAmt = overtimePayAmount(ot.pay, emp.overtime_rate);
    const semiBonus = inp.semiAnnualBonus ?? 0;
    const net = Math.round(
      emp.monthly_wage -
        emp.labor_insurance -
        emp.health_insurance -
        leaveDedTotal +
        overtimeAmt +
        inp.otherAdjust +
        semiBonus,
    );
    /** 其他假期（婚假、生理假等）快照 */
    const otherLeave = summarizeOtherLeave(st);

    const confirmLines = [
      `確定發放「${emp.name}」${bounds.label} 薪資？`,
      ``,
    ];
    if (st.pending.length > 0) {
      confirmLines.push(
        `⚠ 尚有 ${st.pending.length} 張待審假單：${st.pending.map(pendingLeaveLabel).join("、")}`,
        `發放後才核准的扣薪假，會在下次結算自動補扣。`,
        ``,
      );
    }
    confirmLines.push(`實發總額：NT$ ${net.toLocaleString("zh-TW")}`);
    if (semiBonus > 0) {
      confirmLines.push(
        `含獎金：NT$ ${semiBonus.toLocaleString("zh-TW")}${bonusImportLabel ? `（${bonusImportLabel}）` : ""}`,
      );
    }
    if (leaveDedTotal !== 0) {
      confirmLines.push(
        leaveDedTotal > 0
          ? `請假扣薪：NT$ ${leaveDedTotal.toLocaleString("zh-TW")}（${leaveBreakdown}）`
          : `請假補發：NT$ ${Math.abs(leaveDedTotal).toLocaleString("zh-TW")}（${leaveBreakdown}）`,
      );
    }
    confirmLines.push(...adjustLines);
    confirmLines.push(
      ``,
      ledgerLines.length > 0 ? `特休／補休本月異動（假單核准時已扣，發放不再異動）：` : `特休／補休本月無異動。`,
      ...ledgerLines,
      `目前餘額：特休 ${formatSignedDayDecimalAsDayHour(annualAfter)}、補休 ${compAfter != null ? `${Math.round(compAfter * 100) / 100} 小時` : "—"}`,
    );
    if (overtimeAmt > 0) {
      confirmLines.push(
        `加班費：NT$ ${overtimeAmt.toLocaleString("zh-TW")}（折抵加班費 ${ot.pay} 小時）`,
      );
    }
    if (ot.comp > 0) {
      confirmLines.push(
        `加班轉補休 ${ot.comp} 小時（核准時已入補休金庫，不計薪）`,
      );
    }

    const ok = window.confirm(confirmLines.join("\n"));
    if (!ok) return;

    const bonusDetail = bonusDetailByEmp[emp.id];
    // 備註欄已有「YYYY年上/下半年度獎金X元」說明行時不再重複附註
    const hasBonusRemark = inp.attendanceNotes
      .split("\n")
      .some((line) => SEMI_ANNUAL_BONUS_REMARK_RE.test(line.trim()));
    const bonusNote = hasBonusRemark
      ? ""
      : semiBonus > 0 && bonusImportLabel && bonusDetail
        ? formatSemiAnnualBonusPayrollNote(bonusImportLabel, bonusDetail)
        : semiBonus > 0 && bonusImportLabel
          ? `【${bonusImportLabel}獎金】合計 NT$ ${semiBonus.toLocaleString("zh-TW")}`
          : "";
    const notes = [
      withAutoRemarkLines(inp.attendanceNotes, { ledger: ledgerLines, adjust: adjustLines }).trim(),
      bonusNote,
    ]
      .filter(Boolean)
      .join("\n");

    /** 與 payslips 表／migrations 對齊；缺欄時依序略過 notes → 再略過 PAYSLIP_DETAIL_SNAPSHOT_KEYS */
    const insertPayload: Record<string, unknown> = {
      employee_id: emp.id,
      period_key: payPeriod,
      pay_period: payPeriod,
      month_label: bounds.label,
      base_salary: emp.monthly_wage,
      net_pay: net,
      net_salary: net,
      status: "paid",
      bonus_and_overtime: overtimeAmt,
      leave_deduction: leaveDedTotal,
      labor_insurance_employee: emp.labor_insurance,
      health_insurance_employee: emp.health_insurance,
      health_insured_persons: emp.health_insured_persons,
      overtime_days: overtimeHoursToHalfDaySteps(ot.total),
      // 特休／補休於假單核准時已扣：這裡記錄本月請假造成的特休淨使用與發放當下餘額
      special_leave_days_settled: annualLeaveUsedDays(monthEntries),
      special_leave_remaining_after: annualAfter,
      comp_leave_remaining_after: compAfter,
      leave_days: settlement.currentHours / LEAVE_WORK_DAY_HOURS,
      leave_settlement: [...settlement.current, ...settlement.adjustments],
      other_leave_days: otherLeave.days,
      other_leave_detail: otherLeave.detail,
      payroll_bonus: semiBonus,
      other_adjust: inp.otherAdjust,
      notes,
    };

    const writePayslip = (payload: Record<string, unknown>) =>
      existingSlipId != null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 漸進刪除欄位以相容舊 schema
        ? supabase.from("payslips").update(payload as any).eq("id", existingSlipId).select("id")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : supabase.from("payslips").insert(payload as any).select("id");

    let ins = await writePayslip(insertPayload);
    let payslipDetailFallback = false;
    let notesFallback = false;

    if (ins.error && isPayslipMissingColumnError(ins.error.message)) {
      const noNotes: Record<string, unknown> = { ...insertPayload };
      delete noNotes.notes;
      const pb = num(noNotes.payroll_bonus, 0);
      if (pb > 0) {
        delete noNotes.payroll_bonus;
        noNotes.other_adjust = num(noNotes.other_adjust, 0) + pb;
      }
      ins = await writePayslip(noNotes);
      notesFallback = !ins.error;
    }

    if (ins.error && isPayslipMissingColumnError(ins.error.message)) {
      const trimmed: Record<string, unknown> = { ...insertPayload };
      for (const k of PAYSLIP_DETAIL_SNAPSHOT_KEYS) delete trimmed[k];
      delete trimmed.notes;
      const pb = num(trimmed.payroll_bonus, 0);
      delete trimmed.payroll_bonus;
      trimmed.other_adjust = num(trimmed.other_adjust, 0) + pb;
      ins = await writePayslip(trimmed);
      payslipDetailFallback = !ins.error;
      notesFallback = payslipDetailFallback;
    }

    if (ins.error) {
      if (isPayslipOnConflictTargetError(ins.error.message)) {
        toast.error(
          "資料庫缺少 (employee_id, period_key) 唯一索引，無法安全寫入薪資單。請在 Supabase 執行 migration：20250325000001_payslips_employee_period_unique.sql。",
          { duration: 12000 },
        );
      } else if (isPayslipDuplicateRowError(ins.error.message)) {
        toast.error(
          "此員工該月份已有薪資紀錄，請勿重複發放。若您剛刪除資料庫列，請按「產生本月薪資單」重新載入後再試。",
          { duration: 10000 },
        );
      } else {
        toast.error(ins.error.message || "寫入 payslips 失敗");
      }
      return;
    }

    const firstRow = ins.data?.[0] as { id?: string } | undefined;
    const slipId = firstRow?.id != null ? String(firstRow.id) : null;

    /** 先前因缺欄而略過的 notes／明細，在欄位已補上時用 UPDATE 一次寫回 */
    if (slipId && (notesFallback || payslipDetailFallback)) {
      const backfill: Record<string, unknown> = {};
      if (notesFallback) {
        const n = insertPayload.notes;
        if (typeof n === "string" && n.trim()) backfill.notes = n.trim();
      }
      if (payslipDetailFallback) {
        for (const k of PAYSLIP_DETAIL_SNAPSHOT_KEYS) {
          if (insertPayload[k] !== undefined) backfill[k] = insertPayload[k];
        }
      }
      if (Object.keys(backfill).length > 0) {
        const { error: bfErr } = await supabase
          .from("payslips")
          .update(backfill)
          .eq("id", slipId);
        if (!bfErr) {
          toast.success("已自動補齊薪資單先前略過的欄位。", { duration: 6000 });
          notesFallback = false;
          payslipDetailFallback = false;
        }
      }
    }

    if (notesFallback) {
      toast.info(
        "薪資已入帳；payslips 尚無 notes 欄位，出勤備註未寫入。請套用 migration payslips_notes。",
        { duration: 8000 },
      );
    }

    /** 本月異動標記為已列入薪資單（下次結算不再重複列出） */
    if (monthEntries.length > 0) {
      const mk = await markLedgerPayslipRpc(
        emp.id,
        payPeriod,
        monthEntries.map((e) => e.id),
      );
      if (!mk.ok) {
        toast.warning(`薪資已入帳，但特休／補休異動未標記為已列入：${mk.message}`, { duration: 10000 });
      }
    }

    toast.success(`已發放：${emp.name}`);
    if (payslipDetailFallback) {
      toast.info(
        "薪資已入帳；payslips 尚缺勞健保／加班明細等欄位，員工端薪資單可能不完整。請在 Supabase 執行 sql/payslips_settlement_columns.sql。",
        { duration: 9000 },
      );
    }

    const notifyTo =
      (emp.payroll_notification_email || emp.email)?.trim() || "";
    if (notifyTo) {
      const {
        data: { session },
      } = await getSupabaseSession();
      const accessToken = session?.access_token;
      if (accessToken) {
        try {
          const res = await fetch("/api/payroll-notify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              to: notifyTo,
              employeeName: emp.name,
              monthLabel: bounds.label,
              netPay: net,
              remittanceBank: emp.remittance_bank,
              remittanceAccount: emp.remittance_account,
            }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            toast.warning(
              j?.error
                ? `薪資已入帳，但通知信未寄出：${String(j.error)}`
                : "薪資已入帳，但通知信未寄出。",
              { duration: 8000 },
            );
          }
        } catch (e) {
          console.error("[salary-settlement] payroll-notify", e);
          toast.warning("薪資已入帳，但通知信發送失敗。", { duration: 6000 });
        }
      }
    }

    setPaidIds((prev) => new Set(prev).add(emp.id));
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === emp.id
          ? { ...e, annual_leave_remaining: annualAfter, comp_leave_remaining: compAfter }
          : e,
      ),
    );
    setPaidLeaveSnapByEmp((prev) =>
      new Map(prev).set(emp.id, {
        specialSettled: annualLeaveUsedDays(monthEntries),
        specialAfter: annualAfter,
        compAfter,
        leaveDeduction: leaveDedTotal,
      }),
    );
    const markedIds = new Set(monthEntries.map((e) => e.id));
    setLedger((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        markedIds.has(e.id) ? { ...e, payslip_period: payPeriod } : e,
      ),
    }));
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border bg-card px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"
            aria-hidden
          >
            <Banknote className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="sr-only">薪資結算中心</h2>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            結算月份
          </span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 shadow-xs">
              <CalendarRange
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <input
                type="month"
                value={payPeriod}
                onChange={(e) => setPayPeriod(e.target.value)}
                className="min-w-[9.5rem] bg-transparent text-sm font-medium text-foreground focus:outline-none"
                aria-label="選擇結算月份"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3 text-xs"
              disabled={loading || !bounds}
              onClick={() => {
                void load().then((ok) => {
                  if (ok) {
                    toast.success(
                      "已並行載入在職員工、本月出勤、核准假單與核准加班紀錄",
                    );
                  }
                });
              }}
            >
              產生本月薪資單
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1.5 px-3 text-xs"
              disabled={loading || importingBonus || employees.length === 0}
              title={
                suggestedBonusPeriod
                  ? `帶入 ${suggestedBonusPeriod.label} 考績獎金（讀取考績獎金頁的發放紀錄）`
                  : "帶入最近一筆考績獎金發放紀錄（建議 7–8 月發上半年、1–2 月發下半年）"
              }
              onClick={() => {
                void handleImportSemiAnnualBonus();
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              帶入獎金
            </Button>
          </div>
          {bonusImportLabel && (
            <p className="max-w-md text-right text-[11px] text-muted-foreground">
              已帶入「{bonusImportLabel}」獎金至「獎金」欄。
            </p>
          )}
        </div>
      </div>

      {fetchError && (
        <p className="border-b border-border bg-destructive/5 px-5 py-2.5 text-sm text-destructive">
          {fetchError}
        </p>
      )}

      {pendingLeaveSummary.count > 0 && (
        <p className="border-b border-border bg-amber-50 px-5 py-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠ {bounds?.label ?? "本月"}尚有 {pendingLeaveSummary.count} 張待審假單（
          {pendingLeaveSummary.names.join("、")}）。發放後才核准的假單不會列入本月結算，建議先到「假單/加班審核」處理。
        </p>
      )}

      <div className="overflow-x-auto px-2 pb-2 pt-1 sm:px-4 sm:pb-4 sm:pt-2">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            載入結算資料中…
          </p>
        ) : employees.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            尚無在職員工可結算。
          </p>
        ) : (
          <table className="w-full min-w-[1420px] table-fixed border-collapse text-sm">
            <colgroup>
              {/* 欄序：姓名、年資、本月薪資、勞保、健保、請假扣款、特休異動、特休餘額、總加班、費率、補休異動、加班費、補休結餘、獎金、調整、實發、出勤備註、發放 */}
              <col className="w-[5rem]" />
              <col className="w-[4rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[3.75rem]" />
              <col className="w-[3.75rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[3.5rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[4rem]" />
              <col className="w-[3.75rem]" />
              <col className="w-[5rem]" />
              <col className="w-[5rem]" />
              <col className="w-[4.5rem]" />
              <col />
              <col className="w-[3.5rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left [&_th]:px-1 [&_th]:py-1.5 [&_th]:text-xs [&_th]:font-semibold md:[&_th]:whitespace-normal">
                <th className="sticky left-0 z-30 bg-card shadow-[4px_0_12px_-4px_rgba(0,0,0,0.08)] text-foreground">
                  姓名
                </th>
                <th
                  title="到職日至結算月底之年資（已扣除留職停薪月份）"
                  className="text-right text-muted-foreground"
                >
                  年資
                </th>
                <th className="text-right text-muted-foreground">本月薪資</th>
                <th className="text-right text-muted-foreground">勞保</th>
                <th className="text-right text-muted-foreground">健保</th>
                <th className="text-right text-muted-foreground">請假扣款</th>
                <th
                  title="本月特休異動：假單核准扣除、撤銷退回、颱風假回補、年資新增、人工調整（滑鼠移上去看明細）"
                  className="border-l border-border bg-[var(--secondary)]/40 text-right text-muted-foreground dark:bg-muted/50"
                >
                  特休異動
                </th>
                <th className="bg-[var(--secondary)]/25 text-right text-foreground dark:bg-muted/40">
                  特休餘額
                </th>
                <th
                  title="本月核准加班總時數（overtime_records）"
                  className="border-l border-border text-right text-muted-foreground"
                >
                  總加班
                </th>
                <th className="text-right text-muted-foreground">費率</th>
                <th
                  title="＋：本月加班折抵補休（核准當下已入補休金庫）；其他：補休假單核准扣除、撤銷退回、回補、人工調整"
                  className="text-right text-muted-foreground"
                >
                  補休異動
                </th>
                <th
                  title="折抵加班費時數 × 費率 ÷ 8（依員工申報自動計算）"
                  className="text-right text-muted-foreground"
                >
                  加班費
                </th>
                <th
                  title="補休金庫餘額（小時；假單核准時已扣）"
                  className="text-right text-muted-foreground"
                >
                  補休結餘
                </th>
                <th className="border-l border-border text-right text-foreground">
                  獎金
                </th>
                <th className="text-right text-muted-foreground">調整</th>
                <th className="text-right text-foreground">實發</th>
                <th className="border-l border-border text-muted-foreground">
                  出勤備註
                </th>
                <th className="text-muted-foreground">發放</th>
              </tr>
            </thead>
            <tbody className="[&_td]:px-1 [&_td]:py-1.5 md:[&_td]:whitespace-normal">
              {employees.map((emp) => {
                const paid = paidIds.has(emp.id);
                const st = leaveStatsByEmployee.get(emp.id) ?? emptyLeaveMonthStats();
                const inp = inputs[emp.id] ?? defaultRowInputs();
                const settlement = leaveSettlementByEmp.get(emp.id) ?? EMPTY_SETTLEMENT;
                const leaveBreakdown = settlementBreakdownLabel(settlement);
                /** 已發放列改讀 payslips 發放當下快照，避免主檔後續變動使數字對不上；
                 *  舊快照（無新欄位）退回即時值 */
                const paidSnap = paid ? paidLeaveSnapByEmp.get(emp.id) : undefined;
                const leaveDedTotal = paidSnap?.leaveDeduction ?? settlement.total;
                const pendingLeaves = paid ? [] : st.pending;
                const ot = overtimeMonthStats(emp.id, overtimeRows);
                const overtimeAmt = overtimePayAmount(ot.pay, emp.overtime_rate);
                const semiBonus = inp.semiAnnualBonus ?? 0;
                /** 年資基準為結算月底 */
                const seniority = seniorityFromHire(
                  emp.hire_date,
                  monthEndDate,
                  emp.unpaid_leave_months,
                );
                const net = Math.round(
                  emp.monthly_wage -
                    emp.labor_insurance -
                    emp.health_insurance -
                    leaveDedTotal +
                    overtimeAmt +
                    inp.otherAdjust +
                    semiBonus,
                );

                /** 特休／補休：假單核准時已扣，這裡列出本月異動與餘額 */
                const monthLedger = monthLedgerFor(emp.id, paid);
                const annualLines = formatLedgerRemarkLines(
                  monthLedger.filter((e) => e.kind === "annual"),
                  ledger.leaves,
                  ledger.grants,
                );
                const compLines = formatLedgerRemarkLines(
                  monthLedger.filter((e) => e.kind === "comp"),
                  ledger.leaves,
                  ledger.grants,
                );
                const annualNetDays = ledgerNetHours(monthLedger, "annual") / LEAVE_WORK_DAY_HOURS;
                const compLedgerNet = Math.round(ledgerNetHours(monthLedger, "comp") * 100) / 100;
                const annualBalance = paid
                  ? (paidSnap?.specialAfter ?? emp.annual_leave_remaining)
                  : emp.annual_leave_remaining;
                const compBalance = paid
                  ? (paidSnap?.compAfter ?? emp.comp_leave_remaining)
                  : emp.comp_leave_remaining;

                return (
                  <tr
                    key={emp.id}
                    className={cn(
                      "group border-b border-border transition-colors last:border-b-0",
                      paid ? "bg-muted/25" : "hover:bg-muted/40",
                    )}
                  >
                    <td
                      title={emp.name || undefined}
                      className={cn(
                        "truncate font-medium text-foreground sticky left-0 z-10 bg-card shadow-[4px_0_12px_-4px_rgba(0,0,0,0.06)]",
                        // 固定欄需不透明：半透明列底色改以漸層疊在 bg-card 上，捲動的數字才不會透出
                        paid
                          ? "bg-linear-to-r from-muted/25 to-muted/25"
                          : "group-hover:bg-linear-to-r group-hover:from-muted/40 group-hover:to-muted/40",
                      )}
                    >
                      {emp.name || "—"}
                    </td>
                    <td
                      title={
                        emp.hire_date
                          ? `到職日 ${emp.hire_date.slice(0, 10)}${
                              emp.unpaid_leave_months.length > 0
                                ? `；已扣留職停薪 ${emp.unpaid_leave_months.length} 個月`
                                : ""
                            }`
                          : "未設到職日"
                      }
                      className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground"
                    >
                      {seniority.label}
                    </td>
                    <td className="text-right text-xs tabular-nums text-foreground">
                      {emp.monthly_wage.toLocaleString("zh-TW")}
                    </td>
                    <td className="text-right text-xs tabular-nums text-muted-foreground">
                      −{emp.labor_insurance.toLocaleString("zh-TW")}
                    </td>
                    <td
                      title={
                        emp.health_insured_persons != null &&
                        emp.health_insured_persons > 1
                          ? `每人 ${emp.health_insurance_per_person.toLocaleString("zh-TW")} × ${emp.health_insured_persons} 人`
                          : undefined
                      }
                      className="text-right text-xs tabular-nums text-muted-foreground"
                    >
                      −{emp.health_insurance.toLocaleString("zh-TW")}
                      {emp.health_insured_persons != null &&
                      emp.health_insured_persons > 1 ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground md:hidden">
                          ×{emp.health_insured_persons}人
                        </span>
                      ) : null}
                    </td>
                    <td
                      title={
                        paidSnap?.leaveDeduction != null
                          ? `發放當下金額（薪資單快照）${leaveBreakdown ? `；${leaveBreakdown}` : ""}`
                          : leaveBreakdown
                            ? `${leaveBreakdown}（時薪＝月薪 ÷ 30 ÷ 8）`
                            : "本月無影響薪資之請假"
                      }
                      className={cn(
                        "text-right text-xs tabular-nums",
                        leaveDedTotal < 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {leaveDedTotal < 0
                        ? `+${Math.abs(leaveDedTotal).toLocaleString("zh-TW")}`
                        : `−${leaveDedTotal.toLocaleString("zh-TW")}`}
                      {settlement.adjustments.length > 0 && !paid ? (
                        <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-sky-700 dark:text-sky-400">
                          含前期調整
                        </span>
                      ) : null}
                      {pendingLeaves.length > 0 ? (
                        <span
                          title={`待審假單：${pendingLeaves.map(pendingLeaveLabel).join("、")}。發放後才核准的會在下次結算補扣。`}
                          className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-amber-700 dark:text-amber-400"
                        >
                          ⚠ 待審 {pendingLeaves.length}
                        </span>
                      ) : null}
                    </td>
                    <td
                      title={annualLines.length > 0 ? annualLines.join("\n") : "本月無特休異動"}
                      className={cn(
                        "whitespace-nowrap! border-l border-border text-right text-xs tabular-nums",
                        annualNetDays < 0
                          ? "text-red-700 dark:text-red-400"
                          : annualNetDays > 0
                            ? "text-sky-800 dark:text-sky-300"
                            : "text-muted-foreground",
                      )}
                    >
                      {annualLines.length > 0
                        ? `${annualNetDays > 0 ? "+" : ""}${formatDayHourShort(annualNetDays)}`
                        : "—"}
                      {annualLines.length > 0 ? (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {annualLines.length} 筆
                        </span>
                      ) : null}
                    </td>
                    <td
                      title={paid ? "發放當下快照（payslips.special_leave_remaining_after）" : "目前特休餘額（假單核准時已扣）"}
                      className="whitespace-nowrap! bg-[var(--secondary)]/15 text-right text-xs tabular-nums font-semibold text-foreground dark:bg-muted/30"
                    >
                      {annualBalance != null ? formatDayHourShort(annualBalance) : "—"}
                    </td>
                    <td
                      className="border-l border-border whitespace-nowrap text-right text-xs tabular-nums text-foreground"
                      title="本月核准加班總時數（依員工申報，折抵方式申報時已決定）"
                    >
                      {ot.total > 0 ? `${ot.total}h` : "—"}
                    </td>
                    <td
                      className="text-right text-[11px] tabular-nums text-muted-foreground"
                      title="employees.overtime_rate"
                    >
                      {emp.overtime_rate != null && emp.overtime_rate > 0 ? (
                        Math.round(emp.overtime_rate).toLocaleString("zh-TW")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap text-right text-xs tabular-nums"
                      title={[
                        ot.comp > 0 ? `加班轉補休 +${ot.comp}h（核准當下已入補休金庫）` : "",
                        ...compLines,
                      ]
                        .filter(Boolean)
                        .join("\n") || "本月無補休異動"}
                    >
                      {ot.comp > 0 || compLedgerNet !== 0 ? (
                        <>
                          {ot.comp > 0 ? (
                            <span className="text-sky-800 dark:text-sky-300">+{ot.comp}h</span>
                          ) : null}
                          {ot.comp > 0 && compLedgerNet !== 0 ? " " : null}
                          {compLedgerNet !== 0 ? (
                            <span
                              className={cn(
                                "font-medium",
                                compLedgerNet < 0
                                  ? "text-red-700 dark:text-red-400"
                                  : "text-sky-800 dark:text-sky-300",
                              )}
                            >
                              {compLedgerNet > 0 ? "+" : ""}
                              {compLedgerNet}h
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap text-right text-xs tabular-nums font-medium text-foreground"
                      title={
                        ot.pay > 0
                          ? `折抵加班費 ${ot.pay} 小時 × 費率 ÷ 8`
                          : undefined
                      }
                    >
                      {ot.pay > 0 ? (
                        <div className="flex flex-col items-end leading-tight">
                          {/* 計算加班費的時數（折抵加班費之核准加班合計） */}
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {Math.round(ot.pay * 100) / 100}h
                          </span>
                          <span>{overtimeAmt > 0 ? overtimeAmt.toLocaleString("zh-TW") : "—"}</span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground"
                      title={paid ? "發放當下快照（payslips.comp_leave_remaining_after）" : "目前補休餘額（小時，假單核准時已扣）"}
                    >
                      {compBalance != null ? `${Math.round(compBalance * 100) / 100}h` : "—"}
                    </td>
                    <td className="border-l border-border text-right">
                      <NumericInput
                        disabled={paid}
                        title={
                          bonusDetailByEmp[emp.id] && semiBonus > 0
                            ? formatSemiAnnualBonusPayrollNote(
                                bonusImportLabel ?? "本期",
                                bonusDetailByEmp[emp.id]!,
                              )
                            : undefined
                        }
                        value={semiBonus}
                        onValueChange={(v) =>
                          setInputs((p) => ({
                            ...p,
                            // 獎金不可為負（元件已擋負號）；扣減請使用「調整」欄
                            [emp.id]: { ...inp, semiAnnualBonus: v ?? 0 },
                          }))
                        }
                        className="h-auto w-full max-w-[4.5rem] rounded border border-input bg-background px-1 py-0.5 text-right text-xs tabular-nums shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td className="text-right">
                      <NumericInput
                        allowNegative
                        disabled={paid}
                        value={inp.otherAdjust}
                        onValueChange={(v) =>
                          setInputs((p) => ({
                            ...p,
                            // 清空或只打「-」時暫以 0 計算，輸入完成後即時更新
                            [emp.id]: { ...inp, otherAdjust: v ?? 0 },
                          }))
                        }
                        className="h-auto w-full max-w-[4.5rem] rounded border border-input bg-background px-1 py-0.5 text-right text-xs tabular-nums shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td className="text-right align-middle">
                      <span className="text-sm font-bold tabular-nums text-primary">
                        {net.toLocaleString("zh-TW")}
                      </span>
                    </td>
                    <td className="border-l border-border align-middle">
                      <div className="flex min-w-[11rem] items-start gap-0.5">
                        <label className="sr-only" htmlFor={`attendance-notes-${emp.id}`}>
                          {emp.name || "員工"} 出勤備註
                        </label>
                        <textarea
                          id={`attendance-notes-${emp.id}`}
                          rows={2}
                          disabled={paid}
                          value={inp.attendanceNotes}
                          onChange={(e) => {
                            const t = e.target.value;
                            setInputs((p) => ({
                              ...p,
                              [emp.id]: { ...inp, attendanceNotes: t },
                            }));
                          }}
                          placeholder="出勤備註"
                          className="min-h-[2.25rem] min-w-0 flex-1 resize-y rounded border border-input bg-background px-1.5 py-1 text-[11px] leading-snug text-foreground shadow-xs placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
                          aria-label={paid ? `查看 ${emp.name} 出勤備註` : `放大編輯 ${emp.name} 出勤備註`}
                          title={paid ? "查看明細" : "放大編輯"}
                          onClick={() =>
                            setRemarkDialog({
                              open: true,
                              name: emp.name || "員工",
                              empId: emp.id,
                            })
                          }
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        </Button>
                      </div>
                    </td>
                    <td className="align-middle">
                      {paid ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-600/20 bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                          已發放
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="default"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => void handlePay(emp)}
                        >
                          發放
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog.Root
        open={remarkDialog.open}
        onOpenChange={(open) => {
          if (!open) setRemarkDialog({ open: false, name: "", empId: null });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(85vh,36rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              出勤備註 · {remarkDialog.name}
            </Dialog.Title>
            <p className="mt-2 text-xs text-muted-foreground">
              {remarkDialog.empId && paidIds.has(remarkDialog.empId)
                ? "此筆已發放，僅供檢視。"
                : "可直接編輯；與表格欄位同步，發放薪資時寫入薪資單。"}
            </p>
            <label htmlFor="remark-dialog-textarea" className="sr-only">
              出勤備註內容
            </label>
            <textarea
              id="remark-dialog-textarea"
              rows={10}
              readOnly={
                remarkDialog.empId != null && paidIds.has(remarkDialog.empId)
              }
              value={
                remarkDialog.empId
                  ? (inputs[remarkDialog.empId]?.attendanceNotes ?? "")
                  : ""
              }
              onChange={(e) => {
                const id = remarkDialog.empId;
                if (!id || paidIds.has(id)) return;
                const t = e.target.value;
                setInputs((p) => ({
                  ...p,
                  [id]: {
                    ...(p[id] ?? defaultRowInputs()),
                    attendanceNotes: t,
                  },
                }));
              }}
              className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground shadow-xs read-only:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setRemarkDialog({ open: false, name: "", empId: null })
                }
              >
                關閉
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
