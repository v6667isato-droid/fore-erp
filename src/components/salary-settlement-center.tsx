"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Banknote, CalendarRange } from "lucide-react";

interface SettlementEmployee {
  id: string;
  name: string;
  monthly_wage: number;
  labor_insurance: number;
  health_insurance: number;
  /** employees.health_insured_persons，寫入薪資單快照 */
  health_insured_persons: number | null;
  overtime_rate: number | null;
  annual_leave_remaining: number | null;
}

interface RowInputs {
  overtimeDays: number;
  otherAdjust: number;
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

/** 本月特休：僅 leave_type（資料欄）為「特休」 */
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

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isPayslipMissingColumnError(message: string): boolean {
  return /could not find|column .* does not exist|schema cache/i.test(message);
}

/** 若遠端 payslips 尚未建明細欄位，改寫入核心欄位以免發薪失敗 */
const PAYSLIP_DETAIL_SNAPSHOT_KEYS = [
  "labor_insurance_employee",
  "health_insurance_employee",
  "health_insured_persons",
  "overtime_days",
  "special_leave_days_settled",
  "other_adjust",
] as const;

function mapRowToSettlementEmployee(r: Record<string, unknown>): SettlementEmployee {
  /** 與員工維護頁一致：labor_employee_burden / health_employee_burden / health_employee_burden_number */
  const labor = num(r.labor_employee_burden ?? r.labor_insurance, 0);
  const health = num(r.health_employee_burden ?? r.health_insurance, 0);
  const hipRaw = r.health_employee_burden_number ?? r.health_insured_persons;
  const healthInsuredPersons =
    hipRaw != null && hipRaw !== "" && Number.isFinite(Number(hipRaw))
      ? Math.max(0, Math.trunc(num(hipRaw)))
      : null;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    monthly_wage: num(r.monthly_wage, 0),
    labor_insurance: labor,
    health_insurance: health,
    health_insured_persons: healthInsuredPersons,
    overtime_rate:
      r.overtime_rate != null && r.overtime_rate !== ""
        ? num(r.overtime_rate)
        : null,
    annual_leave_remaining:
      r.annual_leave_remaining != null && r.annual_leave_remaining !== ""
        ? num(r.annual_leave_remaining)
        : null,
  };
}

const EMP_SELECT_ATTEMPTS = [
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
  const [inputs, setInputs] = useState<Record<string, RowInputs>>({});
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);

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
      const days = overlapInclusiveDays(start, end, bounds.start, bounds.end);
      if (days <= 0) continue;
      const cur = map.get(eid) ?? {
        personal: 0,
        sick: 0,
        specialThisMonth: 0,
      };
      if (isSpecialAnnualLeave(raw)) {
        cur.specialThisMonth += days;
      } else {
        const kind = classifySickOrPersonal(raw);
        if (kind === "personal") cur.personal += days;
        else if (kind === "sick") cur.sick += days;
      }
      map.set(eid, cur);
    }
    return map;
  }, [leaveRows, bounds]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setFetchError(SUPABASE_CONFIG_HELP);
      return;
    }
    if (!bounds) {
      setFetchError("結算月份格式不正確");
      return;
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
        setPaidIds(new Set());
        return;
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
        setPaidIds(new Set());
        return;
      }

      const { data: leaves, error: leaveErr } = await supabase
        .from("leave_requests")
        .select("*")
        .in("employee_id", ids)
        .lte("start_date", bounds.end)
        .gte("end_date", bounds.start);

      if (leaveErr) {
        if (/does not exist|relation|column/i.test(leaveErr.message)) {
          setLeaveRows([]);
        } else {
          console.warn("[salary-settlement] leave_requests:", leaveErr.message);
          toast.error(leaveErr.message || "請假資料讀取失敗");
          setLeaveRows([]);
        }
      } else {
        setLeaveRows((leaves ?? []) as Record<string, unknown>[]);
      }

      const { data: slips, error: slipErr } = await supabase
        .from("payslips")
        .select("employee_id, period_key, status")
        .eq("period_key", payPeriod)
        .in("employee_id", ids);

      if (slipErr) {
        if (!/does not exist|relation/i.test(slipErr.message)) {
          console.warn("[salary-settlement] payslips:", slipErr.message);
        }
        setPaidIds(new Set());
      } else {
        const paid = new Set<string>();
        for (const s of slips ?? []) {
          const row = s as { employee_id?: string };
          if (row.employee_id) paid.add(String(row.employee_id));
        }
        setPaidIds(paid);
      }

      const initInputs: Record<string, RowInputs> = {};
      for (const e of emps) {
        initInputs[e.id] = { overtimeDays: 0, otherAdjust: 0 };
      }
      setInputs(initInputs);
    } finally {
      setLoading(false);
    }
  }, [bounds, payPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePay(emp: SettlementEmployee) {
    if (!bounds) return;
    if (paidIds.has(emp.id)) return;

    const st = leaveStatsByEmployee.get(emp.id) ?? {
      personal: 0,
      sick: 0,
      specialThisMonth: 0,
    };
    const inp = inputs[emp.id] ?? { overtimeDays: 0, otherAdjust: 0 };
    const personalDed = Math.round((emp.monthly_wage / 30) * st.personal);
    const sickDed = Math.round((emp.monthly_wage / 30) * 0.5 * st.sick);
    const leaveDedTotal = personalDed + sickDed;
    const otRate = emp.overtime_rate != null && emp.overtime_rate > 0 ? emp.overtime_rate : 0;
    const overtimeAmt = otRate * inp.overtimeDays;
    const net = Math.round(
      emp.monthly_wage -
        emp.labor_insurance -
        emp.health_insurance -
        leaveDedTotal +
        overtimeAmt +
        inp.otherAdjust,
    );

    const baseRemaining = emp.annual_leave_remaining ?? 0;
    const settledRemaining = baseRemaining - st.specialThisMonth;

    const ok = window.confirm(
      [
        `確定發放「${emp.name}」${bounds.label} 薪資？`,
        ``,
        `實發總額：NT$ ${net.toLocaleString("zh-TW")}`,
        `特休結算後餘額將更新為：${settledRemaining.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 天（原本 ${baseRemaining.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} − 本月特休 ${st.specialThisMonth.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}）`,
      ].join("\n"),
    );
    if (!ok) return;

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
      other_adjust: inp.otherAdjust,
    };

    let ins = await supabase.from("payslips").insert(insertPayload).select("id");
    let payslipDetailFallback = false;
    if (ins.error && isPayslipMissingColumnError(ins.error.message)) {
      const trimmed: Record<string, unknown> = { ...insertPayload };
      for (const k of PAYSLIP_DETAIL_SNAPSHOT_KEYS) delete trimmed[k];
      ins = await supabase.from("payslips").insert(trimmed).select("id");
      payslipDetailFallback = !ins.error;
    }

    if (ins.error) {
      if (/duplicate|unique/i.test(ins.error.message)) {
        toast.error("此員工該月份已有薪資紀錄，請勿重複發放。");
      } else {
        toast.error(ins.error.message || "寫入 payslips 失敗");
      }
      return;
    }

    const firstRow = ins.data?.[0] as { id?: string } | undefined;
    const slipId = firstRow?.id != null ? String(firstRow.id) : null;

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
        <div className="flex min-w-0 gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"
            aria-hidden
          >
            <Banknote className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-wide text-foreground">
              薪資結算中心
            </h2>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              橫向捲動檢視；核准假單區分事假、病假與特休（leave_type＝特休）；發放時同步寫入 payslips 與特休餘額。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            結算月份
          </span>
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
          <table className="w-full min-w-[1280px] border-collapse text-sm">
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
                  特休假結算
                </th>
                <th
                  colSpan={2}
                  className="border-l border-border py-2 text-center text-xs font-semibold text-muted-foreground"
                >
                  加班
                </th>
                <th
                  rowSpan={2}
                  className="whitespace-nowrap border-l border-border py-3 pr-3 text-right text-xs font-semibold text-muted-foreground"
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
                  本月特休
                </th>
                <th className="bg-[var(--secondary)]/25 py-2 pr-3 text-right text-[11px] font-semibold text-foreground dark:bg-muted/40">
                  結算後餘額
                </th>
                <th className="border-l border-border py-2 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                  天數
                </th>
                <th className="py-2 pr-3 text-right text-[11px] font-semibold text-muted-foreground">
                  費率／日
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
                const inp = inputs[emp.id] ?? {
                  overtimeDays: 0,
                  otherAdjust: 0,
                };
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
                const overtimeAmt = otRate * inp.overtimeDays;
                const net = Math.round(
                  emp.monthly_wage -
                    emp.labor_insurance -
                    emp.health_insurance -
                    leaveDedTotal +
                    overtimeAmt +
                    inp.otherAdjust,
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
                          已扣本月特休
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
                            },
                          }));
                        }}
                        className="w-[4.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-right tabular-nums text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    <td
                      className="py-3 pr-3 text-right tabular-nums text-xs text-muted-foreground"
                      title="employees.overtime_rate"
                    >
                      {emp.overtime_rate != null && emp.overtime_rate > 0 ? (
                        `NT$ ${Math.round(emp.overtime_rate).toLocaleString("zh-TW")}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-l border-border py-3 pr-3 text-right">
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
    </section>
  );
}
