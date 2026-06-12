"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  overtimeHoursToHalfDaySteps,
  sumApprovedOvertimeHoursForEmployee,
} from "@/lib/payslip-attendance-remarks";
import {
  computeSemiAnnualBonusesForPayroll,
  formatSemiAnnualBonusPayrollNote,
  suggestBonusPeriodForPayMonth,
  type SemiAnnualBonusDetail,
} from "@/lib/performance-bonus-payroll";

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
  hire_date: string | null;
  share_count: number;
  unpaid_leave_months: string[];
}

interface RowInputs {
  overtimeDays: number;
  /** 考績／分潤／股份等半年獎金（發放時併入 other_adjust） */
  semiAnnualBonus: number;
  otherAdjust: number;
  /** true：不計加班費（與轉補休一致）；false：以費率 × 天數計入加班費 */
  settleOvertimeAsCompOff: boolean;
  /** 出勤備註（預設系統產生，老闆可改；發放寫入 payslips.notes） */
  attendanceNotes: string;
}

function defaultRowInputs(): RowInputs {
  return {
    overtimeDays: 0,
    semiAnnualBonus: 0,
    otherAdjust: 0,
    settleOvertimeAsCompOff: false,
    attendanceNotes: "",
  };
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

/** 假單建立時間是否落在結算月份（與查詢 `monthCreatedAtFilterBounds` 之 gte/lt 一致） */
function createdAtInPayPeriodMonth(row: Record<string, unknown>, payPeriodYm: string): boolean {
  const b = monthCreatedAtFilterBounds(payPeriodYm);
  if (!b) return false;
  const raw = row.created_at ?? row.createdAt;
  if (raw == null) return false;
  const t = new Date(String(raw)).getTime();
  if (Number.isNaN(t)) return false;
  const g = new Date(b.gte).getTime();
  const l = new Date(b.lt).getTime();
  return t >= g && t < l;
}

/** 該筆假單請假總天數（特休結算用；與「休假是否落在本月」無關） */
function leaveRequestTotalDays(row: Record<string, unknown>): number {
  const td = row.total_days;
  if (td != null && td !== "") {
    const n = Number(td);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const start = String(row.start_date ?? row.start ?? "").slice(0, 10);
  const end = String(row.end_date ?? row.end ?? start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return 0;
  return overlapInclusiveDays(start, end, start, end);
}

function parseLocalYmd(s: string): Date {
  const [yy, mm, dd] = s.slice(0, 10).split("-").map((x) => Number(x));
  return new Date(yy, mm - 1, dd);
}

function overlapInclusiveDays(
  leaveStart: string,
  leaveEnd: string,
  monthStart: string,
  monthEnd: string,
): number {
  const a = parseLocalYmd(leaveStart);
  const b = parseLocalYmd(leaveEnd);
  const x = parseLocalYmd(monthStart);
  const y = parseLocalYmd(monthEnd);
  const s = a.getTime() > x.getTime() ? a : x;
  const e = b.getTime() < y.getTime() ? b : y;
  if (s.getTime() > e.getTime()) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

function isLeaveApproved(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "approved" || s === "已核准" || s === "核准";
}

function leaveTypeRaw(row: Record<string, unknown>): string {
  return String(row.leave_type ?? row.type_label ?? row.type ?? "").trim();
}

/** 事假／病假（文字包含） */
function classifySickOrPersonal(
  row: Record<string, unknown>,
): "personal" | "sick" | null {
  const t = leaveTypeRaw(row);
  if (t.includes("事假")) return "personal";
  if (t.includes("病假")) return "sick";
  return null;
}

/** leave_type 為「特休」 */
function isSpecialAnnualLeave(row: Record<string, unknown>): boolean {
  const v = row.leave_type;
  if (v == null) return false;
  return String(v).trim() === "特休";
}

function leaveEmployeeId(row: Record<string, unknown>): string | null {
  const v = row.employee_id ?? row.employeeId;
  if (v == null || v === "") return null;
  return String(v);
}

/** 兩次查詢結果以 id 去重（日期重疊 + created_at 落於本月） */
function mergeLeaveRequestRowsById(rowsA: unknown[], rowsB: unknown[]): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const r of rowsA) {
    const row = r as Record<string, unknown>;
    const id = row.id != null ? String(row.id) : "";
    if (id) merged.set(id, row);
  }
  for (const r of rowsB) {
    const row = r as Record<string, unknown>;
    const id = row.id != null ? String(row.id) : "";
    if (id) merged.set(id, row);
  }
  return Array.from(merged.values());
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

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
 * - 假勤／加班：overtime_days, special_leave_days_settled, leave_days
 * - 出勤備註：notes
 * 上述「明細快照」鍵若缺欄會先略過；bonus_and_overtime／leave_deduction 不在此列，fallback 時仍會寫入。
 */
const PAYSLIP_DETAIL_SNAPSHOT_KEYS = [
  "labor_insurance_employee",
  "health_insurance_employee",
  "health_insured_persons",
  "overtime_days",
  "special_leave_days_settled",
  "leave_days",
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
  "id, name, email, payroll_notification_email, remittance_bank, remittance_account, basic_salary, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, hire_date, share_count, unpaid_leave_months, employment_status, deleted_at",
  "id, name, email, payroll_notification_email, remittance_bank, remittance_account, basic_salary, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, email, basic_salary, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, basic_salary, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status, deleted_at",
  "id, name, basic_salary, monthly_wage, labor_employee_burden, health_employee_burden, health_employee_burden_number, overtime_rate, annual_leave_remaining, employment_status",
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
  const [attendanceRows, setAttendanceRows] = useState<Record<string, unknown>[]>(
    [],
  );
  const [overtimeRows, setOvertimeRows] = useState<Record<string, unknown>[]>([]);
  const [inputs, setInputs] = useState<Record<string, RowInputs>>({});
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [remarkDialog, setRemarkDialog] = useState<{
    open: boolean;
    name: string;
    empId: string | null;
  }>({ open: false, name: "", empId: null });
  const [bonusImportLabel, setBonusImportLabel] = useState<string | null>(null);
  const [bonusDetailByEmp, setBonusDetailByEmp] = useState<
    Record<string, SemiAnnualBonusDetail>
  >({});
  const [importingBonus, setImportingBonus] = useState(false);

  const bounds = useMemo(() => monthBounds(payPeriod), [payPeriod]);

  const leaveStatsByEmployee = useMemo(() => {
    const map = new Map<
      string,
      { personal: number; sick: number; specialThisMonth: number }
    >();
    if (!bounds) return map;
    for (const raw of leaveRows) {
      if (!isLeaveApproved(String(raw.status ?? ""))) continue;
      const eid = leaveEmployeeId(raw);
      if (!eid) continue;
      const start = String(raw.start_date ?? raw.start ?? "").slice(0, 10);
      const end = String(raw.end_date ?? raw.end ?? start).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;

      const cur = map.get(eid) ?? {
        personal: 0,
        sick: 0,
        specialThisMonth: 0,
      };

      if (isSpecialAnnualLeave(raw)) {
        // 特休：以「假單建立日」落在結算月份為準（已核准），天數為該筆申請總天數——
        // 避免請在後月才休時，要等到後月結算才扣餘額。
        if (createdAtInPayPeriodMonth(raw, payPeriod)) {
          cur.specialThisMonth += leaveRequestTotalDays(raw);
        }
      } else {
        const days = overlapInclusiveDays(start, end, bounds.start, bounds.end);
        if (days <= 0) continue;
        const kind = classifySickOrPersonal(raw);
        if (kind === "personal") cur.personal += days;
        else if (kind === "sick") cur.sick += days;
      }
      map.set(eid, cur);
    }
    return map;
  }, [leaveRows, bounds, payPeriod]);

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

      setEmployees(emps);

      const ids = emps.map((e) => e.id);
      if (ids.length === 0) {
        setLeaveRows([]);
        setAttendanceRows([]);
        setOvertimeRows([]);
        setPaidIds(new Set());
        setInputs({});
        return true;
      }

      const createdBounds = monthCreatedAtFilterBounds(payPeriod);
      const [leaveOverlapRes, leaveCreatedRes, attRes, otRes] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("*")
          .in("employee_id", ids)
          .lte("start_date", bounds.end)
          .gte("end_date", bounds.start),
        createdBounds
          ? supabase
              .from("leave_requests")
              .select("*")
              .in("employee_id", ids)
              .gte("created_at", createdBounds.gte)
              .lt("created_at", createdBounds.lt)
          : Promise.resolve({ data: [] as unknown[] | null, error: null }),
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
      ]);

      let slipRes = await supabase
        .from("payslips")
        .select(
          "employee_id, period_key, status, notes, overtime_days, other_adjust, bonus_and_overtime",
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
        if (leaveCreatedRes.error) {
          if (!/does not exist|relation|column/i.test(leaveCreatedRes.error.message)) {
            console.warn(
              "[salary-settlement] leave_requests (created_at):",
              leaveCreatedRes.error.message,
            );
          }
        }
        mergedLeaveForInputs = mergeLeaveRequestRowsById(
          leaveOverlapRes.data ?? [],
          leaveCreatedRes.error ? [] : (leaveCreatedRes.data ?? []),
        );
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
          bonus_and_overtime: unknown;
        }
      >();
      if (!slipRes.error) {
        for (const s of slipRes.data ?? []) {
          const row = s as {
            employee_id?: string;
            status?: string;
            notes?: string | null;
            overtime_days?: unknown;
            other_adjust?: unknown;
            bonus_and_overtime?: unknown;
          };
          if (!row.employee_id || !isPaidStatus(row.status)) continue;
          const id = String(row.employee_id);
          slipNoteByEmp.set(id, row.notes != null ? String(row.notes) : "");
          slipPaidSnapshotByEmp.set(id, {
            overtime_days: row.overtime_days,
            other_adjust: row.other_adjust,
            bonus_and_overtime: row.bonus_and_overtime,
          });
        }
      }

      const initInputs: Record<string, RowInputs> = {};
      for (const e of emps) {
        const snap = slipPaidSnapshotByEmp.get(e.id);
        if (snap) {
          const od = num(snap.overtime_days, 0);
          const oa = num(snap.other_adjust, 0);
          const bot = num(snap.bonus_and_overtime, 0);
          /** 發放時寫入：計加班費則 bonus_and_overtime>0；不計（轉補休）則多為 0 且 overtime_days>0 */
          const settleAsComp = od > 0 && bot === 0;
          const attendanceNotes = slipNoteByEmp.has(e.id)
            ? slipNoteByEmp.get(e.id)!
            : buildPayslipAttendanceRemarks(e.id, {
                bounds: { start: bounds.start, end: bounds.end },
                payPeriodYm: payPeriod,
                attendanceRows: attList,
                leaveRows: leaveList,
                overtimeRows: otList,
                settleOvertimeAsCompOff: settleAsComp,
              });
          initInputs[e.id] = {
            overtimeDays: od,
            semiAnnualBonus: 0,
            otherAdjust: oa,
            settleOvertimeAsCompOff: settleAsComp,
            attendanceNotes,
          };
          continue;
        }

        const sumH = sumApprovedOvertimeHoursForEmployee(e.id, otList);
        const days = overtimeHoursToHalfDaySteps(sumH);
        const settleAsComp = sumH > 0;
        const attendanceNotes = slipNoteByEmp.has(e.id)
          ? slipNoteByEmp.get(e.id)!
          : buildPayslipAttendanceRemarks(e.id, {
              bounds: { start: bounds.start, end: bounds.end },
              payPeriodYm: payPeriod,
              attendanceRows: attList,
              leaveRows: leaveList,
              overtimeRows: otList,
              settleOvertimeAsCompOff: settleAsComp,
            });
        initInputs[e.id] = {
          overtimeDays: days,
          semiAnnualBonus: 0,
          otherAdjust: 0,
          settleOvertimeAsCompOff: settleAsComp,
          attendanceNotes,
        };
      }
      setInputs(initInputs);
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
      const result = await computeSemiAnnualBonusesForPayroll(
        payPeriod,
        employees.map((e) => ({
          id: e.id,
          name: e.name,
          monthly_wage: e.monthly_wage,
          hire_date: e.hire_date,
          share_count: e.share_count,
          unpaid_leave_months: e.unpaid_leave_months,
        })),
      );

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
          next[emp.id] = { ...row, semiAnnualBonus: bonus };
        }
        return next;
      });

      setBonusDetailByEmp(nextDetails);
      setBonusImportLabel(result.period.label);

      const hints: string[] = [
        `已帶入「${result.period.label}」獎金`,
        `${importedCount} 人、合計 NT$ ${totalBonus.toLocaleString("zh-TW")}`,
      ];
      if (result.profitMeta) hints.push(result.profitMeta);
      if (result.usedFallbackPeriod) {
        hints.push("（結算月份非典型發放期，已改用考績獎金頁最近編輯的期別）");
      } else if (!suggestedBonusPeriod) {
        hints.push("（建議於 1–2 月或 7–8 月發薪月份使用）");
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

    const st = leaveStatsByEmployee.get(emp.id) ?? {
      personal: 0,
      sick: 0,
      specialThisMonth: 0,
    };
    const inp = inputs[emp.id] ?? defaultRowInputs();
    const personalDed = Math.round((emp.monthly_wage / 30) * st.personal);
    const sickDed = Math.round((emp.monthly_wage / 30) * 0.5 * st.sick);
    const leaveDedTotal = personalDed + sickDed;
    const otRate = emp.overtime_rate != null && emp.overtime_rate > 0 ? emp.overtime_rate : 0;
    const overtimeAmt = inp.settleOvertimeAsCompOff ? 0 : otRate * inp.overtimeDays;
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

    const baseRemaining = emp.annual_leave_remaining ?? 0;
    const settledRemaining = baseRemaining - st.specialThisMonth;

    const confirmLines = [
      `確定發放「${emp.name}」${bounds.label} 薪資？`,
      ``,
      `實發總額：NT$ ${net.toLocaleString("zh-TW")}`,
    ];
    if (semiBonus > 0) {
      confirmLines.push(
        `含半年獎金：NT$ ${semiBonus.toLocaleString("zh-TW")}${bonusImportLabel ? `（${bonusImportLabel}）` : ""}`,
      );
    }
    confirmLines.push(
      `特休結算後餘額將更新為：${settledRemaining.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 天（原本 ${baseRemaining.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} − 本月建立之特休 ${st.specialThisMonth.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}）`,
    );

    const ok = window.confirm(confirmLines.join("\n"));
    if (!ok) return;

    const bonusDetail = bonusDetailByEmp[emp.id];
    const bonusNote =
      semiBonus > 0 && bonusImportLabel && bonusDetail
        ? formatSemiAnnualBonusPayrollNote(bonusImportLabel, bonusDetail)
        : semiBonus > 0 && bonusImportLabel
          ? `【${bonusImportLabel}獎金】合計 NT$ ${semiBonus.toLocaleString("zh-TW")}`
          : "";
    const notes = [inp.attendanceNotes.trim(), bonusNote].filter(Boolean).join("\n");

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
      bonus_and_overtime: Math.round(overtimeAmt),
      leave_deduction: leaveDedTotal,
      labor_insurance_employee: emp.labor_insurance,
      health_insurance_employee: emp.health_insurance,
      health_insured_persons: emp.health_insured_persons,
      overtime_days: inp.overtimeDays,
      special_leave_days_settled: st.specialThisMonth,
      leave_days: st.personal + st.sick,
      other_adjust: inp.otherAdjust + semiBonus,
      notes,
    };

    const writePayslip = (payload: Record<string, unknown>) =>
      existingSlipId != null
        ? supabase.from("payslips").update(payload).eq("id", existingSlipId).select("id")
        : supabase.from("payslips").insert(payload).select("id");

    let ins = await writePayslip(insertPayload);
    let payslipDetailFallback = false;
    let notesFallback = false;

    if (ins.error && isPayslipMissingColumnError(ins.error.message)) {
      const noNotes: Record<string, unknown> = { ...insertPayload };
      delete noNotes.notes;
      ins = await writePayslip(noNotes);
      notesFallback = !ins.error;
    }

    if (ins.error && isPayslipMissingColumnError(ins.error.message)) {
      const trimmed: Record<string, unknown> = { ...insertPayload };
      for (const k of PAYSLIP_DETAIL_SNAPSHOT_KEYS) delete trimmed[k];
      delete trimmed.notes;
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

    const { error: updErr } = await supabase
      .from("employees")
      .update({ annual_leave_remaining: settledRemaining })
      .eq("id", emp.id);

    if (updErr) {
      if (slipId) {
        const { error: delErr } = await supabase
          .from("payslips")
          .delete()
          .eq("id", slipId);
        if (delErr) {
          console.error("[salary-settlement] rollback payslip failed:", delErr);
        }
      }
      toast.error(
        updErr.message ||
          "更新特休餘額失敗，已回滾薪資紀錄。請檢查 annual_leave_remaining 欄位與權限。",
      );
      return;
    }

    toast.success(`已發放：${emp.name}（薪資入帳並已更新特休餘額）`);
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
          ? { ...e, annual_leave_remaining: settledRemaining }
          : e,
      ),
    );
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
                  ? `帶入 ${suggestedBonusPeriod.label} 考績獎金（依考績獎金頁草稿計算）`
                  : "帶入考績獎金頁最近期別的半年獎金（建議 7–8 月發上半年、1–2 月發下半年）"
              }
              onClick={() => {
                void handleImportSemiAnnualBonus();
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              帶入半年獎金
            </Button>
          </div>
          {bonusImportLabel && (
            <p className="max-w-md text-right text-[11px] text-muted-foreground">
              已帶入「{bonusImportLabel}」獎金至「半年獎金」欄；發放時併入其他調整並寫入備註。
            </p>
          )}
        </div>
      </div>

      {fetchError && (
        <p className="border-b border-border bg-destructive/5 px-5 py-2.5 text-sm text-destructive">
          {fetchError}
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
          <table className="w-full min-w-[1580px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-30 bg-card py-3 pl-3 pr-2 text-xs font-semibold text-foreground shadow-[4px_0_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.35)]"
                >
                  姓名
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
                >
                  本月薪資
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
                >
                  勞保自付
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
                >
                  健保自付
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
                >
                  <span className="block">請假扣款</span>
                  <span className="text-[10px] font-normal text-muted-foreground/90">
                    （事+病）
                  </span>
                </th>
                <th
                  colSpan={3}
                  className="border-l border-border bg-[var(--secondary)]/40 py-2 text-center text-xs font-semibold tracking-wide text-foreground dark:bg-muted/50"
                >
                  <span className="block">特休假結算</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                    特休以「已核准且假單建立於本月」計
                  </span>
                </th>
                <th
                  colSpan={3}
                  className="border-l border-border py-2 text-center text-xs font-semibold text-muted-foreground"
                >
                  加班
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap border-l border-border py-3 pr-3 text-right text-xs font-semibold text-foreground"
                >
                  <span className="block">半年獎金</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    考績／分潤
                  </span>
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
                >
                  其他調整
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-right text-xs font-semibold text-foreground"
                >
                  實發總額
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap border-l border-border py-3 pr-3 text-xs font-semibold text-muted-foreground"
                >
                  出勤備註
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap py-3 pr-3 text-xs font-semibold text-muted-foreground"
                >
                  發放
                </th>
              </tr>
              <tr className="border-b border-border bg-muted/10 text-left">
                <th className="border-l border-border py-2 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                  原本特休
                </th>
                <th className="py-2 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                  <span className="block">本月特休</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                    建立日於本月
                  </span>
                </th>
                <th className="bg-[var(--secondary)]/25 py-2 pr-3 text-right text-[11px] font-semibold text-foreground dark:bg-muted/40">
                  結算後餘額
                </th>
                <th className="border-l border-border py-2 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                  天數
                </th>
                <th className="py-2 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                  費率／日
                </th>
                <th className="py-2 pr-3 text-center text-[11px] font-semibold text-muted-foreground">
                  轉補休
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const paid = paidIds.has(emp.id);
                const st = leaveStatsByEmployee.get(emp.id) ?? {
                  personal: 0,
                  sick: 0,
                  specialThisMonth: 0,
                };
                const inp = inputs[emp.id] ?? defaultRowInputs();
                const personalDed = Math.round(
                  (emp.monthly_wage / 30) * st.personal,
                );
                const sickDed = Math.round(
                  (emp.monthly_wage / 30) * 0.5 * st.sick,
                );
                const leaveDedTotal = personalDed + sickDed;
                const otRate =
                  emp.overtime_rate != null && emp.overtime_rate > 0
                    ? emp.overtime_rate
                    : 0;
                const overtimeAmt = inp.settleOvertimeAsCompOff
                  ? 0
                  : otRate * inp.overtimeDays;
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
                const orig =
                  emp.annual_leave_remaining != null
                    ? emp.annual_leave_remaining
                    : null;
                const settledRemaining =
                  (orig ?? 0) - st.specialThisMonth;
                const hasSpecialUse = st.specialThisMonth > 0;

                return (
                  <tr
                    key={emp.id}
                    className={cn(
                      "group border-b border-border transition-colors last:border-b-0",
                      paid ? "bg-muted/25" : "hover:bg-muted/40",
                    )}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 py-3 pl-3 pr-2 font-medium text-foreground shadow-[4px_0_12px_-4px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.35)]",
                        paid
                          ? "bg-muted/25"
                          : "bg-card group-hover:bg-muted/40",
                      )}
                    >
                      {emp.name || "—"}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-foreground">
                      NT$ {emp.monthly_wage.toLocaleString("zh-TW")}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                      −NT${" "}
                      {emp.labor_insurance.toLocaleString("zh-TW")}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">
                      −NT${" "}
                      {emp.health_insurance.toLocaleString("zh-TW")}
                      {emp.health_insured_persons != null && emp.health_insured_persons > 1 ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          每人 NT${" "}
                          {emp.health_insurance_per_person.toLocaleString("zh-TW")} ×{" "}
                          {emp.health_insured_persons} 人
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-red-600 dark:text-red-400">
                      −NT${" "}
                      {leaveDedTotal.toLocaleString("zh-TW")}
                      <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                        事 {st.personal} 天 · 病 {st.sick} 天
                      </span>
                    </td>
                    <td className="border-l border-border py-3 pr-2 text-right tabular-nums text-muted-foreground">
                      {orig != null
                        ? `${orig.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 天`
                        : "—"}
                    </td>
                    <td className="py-3 pr-2 text-right tabular-nums text-foreground">
                      {st.specialThisMonth.toLocaleString("zh-TW", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      天
                    </td>
                    <td
                      className={cn(
                        "bg-[var(--secondary)]/15 py-3 pr-3 text-right tabular-nums font-semibold dark:bg-muted/30",
                        hasSpecialUse
                          ? "text-amber-800 dark:text-amber-400"
                          : "text-foreground",
                      )}
                    >
                      {orig != null || st.specialThisMonth > 0
                        ? `${settledRemaining.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 天`
                        : "—"}
                      {hasSpecialUse && (
                        <span className="mt-0.5 block text-[10px] font-medium text-amber-700/90 dark:text-amber-500/90">
                          已扣本月建立之特休
                        </span>
                      )}
                    </td>
                    <td className="border-l border-border py-3 pr-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        disabled={paid}
                        value={inp.overtimeDays}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setInputs((p) => ({
                            ...p,
                            [emp.id]: {
                              ...inp,
                              overtimeDays: Number.isFinite(v) ? v : 0,
                              settleOvertimeAsCompOff: inp.settleOvertimeAsCompOff,
                            },
                          }));
                        }}
                        className="w-[4.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-right tabular-nums text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td
                      className="py-3 pr-2 text-right tabular-nums text-xs text-muted-foreground"
                      title="employees.overtime_rate"
                    >
                      {emp.overtime_rate != null && emp.overtime_rate > 0 ? (
                        `NT$ ${Math.round(emp.overtime_rate).toLocaleString("zh-TW")}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-center align-middle">
                      <label className="inline-flex cursor-pointer flex-col items-center gap-0.5 text-[10px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-input"
                          checked={inp.settleOvertimeAsCompOff}
                          disabled={paid}
                          aria-label="加班以轉補休結算不計薪"
                          onChange={(e) => {
                            setInputs((p) => ({
                              ...p,
                              [emp.id]: {
                                ...inp,
                                settleOvertimeAsCompOff: e.target.checked,
                              },
                            }));
                          }}
                        />
                        <span className="whitespace-nowrap">不計加班費</span>
                      </label>
                    </td>
                    <td className="border-l border-border py-3 pr-3 text-right">
                      <input
                        type="number"
                        step={1}
                        disabled={paid}
                        title={
                          bonusDetailByEmp[emp.id] && semiBonus > 0
                            ? formatSemiAnnualBonusPayrollNote(
                                bonusImportLabel ?? "半年",
                                bonusDetailByEmp[emp.id]!,
                              )
                            : undefined
                        }
                        value={semiBonus}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setInputs((p) => ({
                            ...p,
                            [emp.id]: {
                              ...inp,
                              semiAnnualBonus: Number.isFinite(v) ? v : 0,
                            },
                          }));
                        }}
                        className="w-[5.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-right tabular-nums text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <input
                        type="number"
                        step={1}
                        disabled={paid}
                        value={inp.otherAdjust}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setInputs((p) => ({
                            ...p,
                            [emp.id]: {
                              ...inp,
                              otherAdjust: Number.isFinite(v) ? v : 0,
                              settleOvertimeAsCompOff: inp.settleOvertimeAsCompOff,
                            },
                          }));
                        }}
                        className="w-[5.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-right tabular-nums text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td className="py-3 pr-3 text-right align-middle">
                      <span className="text-base font-bold tabular-nums text-primary sm:text-lg">
                        NT$ {net.toLocaleString("zh-TW")}
                      </span>
                    </td>
                    <td className="border-l border-border py-3 pr-2 align-middle">
                      <div className="flex w-[min(100%,14rem)] min-w-[10.5rem] flex-col items-stretch gap-1.5">
                        <label className="sr-only" htmlFor={`attendance-notes-${emp.id}`}>
                          {emp.name || "員工"} 出勤備註
                        </label>
                        <textarea
                          id={`attendance-notes-${emp.id}`}
                          rows={3}
                          disabled={paid}
                          value={inp.attendanceNotes}
                          onChange={(e) => {
                            const t = e.target.value;
                            setInputs((p) => ({
                              ...p,
                              [emp.id]: { ...inp, attendanceNotes: t },
                            }));
                          }}
                          placeholder="系統會預填建議文，可直接修改或補充"
                          className="resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11px] leading-snug text-foreground shadow-xs placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[10px] text-muted-foreground"
                          onClick={() =>
                            setRemarkDialog({
                              open: true,
                              name: emp.name || "員工",
                              empId: emp.id,
                            })
                          }
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {paid ? "查看明細" : "放大編輯"}
                        </Button>
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-middle">
                      {paid ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-600/20 bg-emerald-600/10 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                          ✅ 已發放
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="default"
                          className="h-8 px-3 text-xs"
                          onClick={() => void handlePay(emp)}
                        >
                          發放薪資
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
