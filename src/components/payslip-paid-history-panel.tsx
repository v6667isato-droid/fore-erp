"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Eye, Receipt, RefreshCw } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isPaidStatus(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "paid" || s === "已發放" || s === "發放";
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface PaidSlipRow {
  id: string;
  employee_id: string;
  employee_name: string;
  period_key: string;
  month_label: string;
  base_salary: number;
  labor_insurance_employee: number;
  health_insurance_employee: number;
  health_insured_persons: number | null;
  leave_deduction: number;
  leave_days: number;
  special_leave_days_settled: number;
  overtime_days: number;
  /** 發放時寫入之加班費（含費率×天數；轉補休時為 0） */
  bonus_and_overtime: number;
  other_adjust: number;
  net_pay: number;
  status: string;
  created_at: string | null;
  notes: string | null;
}

const PAYSLIP_DETAIL_SELECT = `
  leave_deduction,
  labor_insurance_employee,
  health_insurance_employee,
  health_insured_persons,
  overtime_days,
  special_leave_days_settled,
  leave_days
`;

function mapRawToPaidSlipRow(
  r: Record<string, unknown>,
  employeeName: string,
): PaidSlipRow {
  const healthInsuredRaw = r.health_insured_persons;
  const healthInsuredPersons =
    healthInsuredRaw != null &&
    healthInsuredRaw !== "" &&
    Number.isFinite(Number(healthInsuredRaw))
      ? Math.max(0, Math.trunc(num(healthInsuredRaw)))
      : null;

  return {
    id: String(r.id ?? ""),
    employee_id: String(r.employee_id ?? ""),
    employee_name: employeeName,
    period_key: String(r.period_key ?? ""),
    month_label: periodLabelForRow(
      String(r.period_key ?? ""),
      String(r.month_label ?? ""),
    ),
    base_salary: num(r.base_salary, 0),
    labor_insurance_employee: num(r.labor_insurance_employee, 0),
    health_insurance_employee: num(r.health_insurance_employee, 0),
    health_insured_persons: healthInsuredPersons,
    leave_deduction: num(r.leave_deduction, 0),
    leave_days: num(r.leave_days, 0),
    special_leave_days_settled: num(r.special_leave_days_settled, 0),
    overtime_days: num(r.overtime_days, 0),
    bonus_and_overtime: num(r.bonus_and_overtime, 0),
    other_adjust: num(r.other_adjust, 0),
    net_pay: num(r.net_pay ?? r.net_salary, 0),
    status: String(r.status ?? ""),
    created_at: r.created_at != null ? String(r.created_at) : null,
    notes:
      typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : null,
  };
}

function formatMoney(amount: number, compact: boolean): string {
  const n = amount.toLocaleString("zh-TW");
  return compact ? n : `NT$ ${n}`;
}

function formatDeduction(amount: number, compact = false): string {
  if (amount === 0) return "—";
  return `−${formatMoney(amount, compact)}`;
}

function formatOtherAdjust(amount: number, compact = false): string {
  if (amount === 0) return "—";
  const abs = formatMoney(Math.abs(amount), compact);
  return amount > 0 ? `+${abs}` : `−${abs}`;
}

function compactMonthLabel(periodKey: string, monthLabel: string): string {
  const pk = periodKey.trim();
  if (pk.length >= 7) {
    const [y, m] = pk.slice(0, 7).split("-").map((x) => Number(x));
    if (y && m) return `${String(y % 100).padStart(2, "0")}/${m}`;
  }
  const ml = monthLabel.trim();
  if (!ml) return "—";
  return ml.replace(/\s*年\s*/, "/").replace(/\s*月\s*$/, "");
}

function isOvertimeCompOff(row: PaidSlipRow): boolean {
  return row.overtime_days > 0 && row.bonus_and_overtime === 0;
}

function formatOvertimeCell(
  row: PaidSlipRow,
  compact: boolean,
): { text: string; title: string } {
  if (row.overtime_days <= 0) {
    return { text: "—", title: "無加班" };
  }
  const days = row.overtime_days.toLocaleString("zh-TW", {
    maximumFractionDigits: 1,
  });
  if (isOvertimeCompOff(row)) {
    return {
      text: compact ? `${days}天·補休` : `${days} 天 · 補休`,
      title: `加班 ${days} 天，以補休結算不計加班費`,
    };
  }
  if (row.bonus_and_overtime > 0) {
    const amt = formatMoney(row.bonus_and_overtime, compact);
    return {
      text: compact ? `${days}天 ${amt}` : `${days} 天 · ${amt}`,
      title: `加班 ${days} 天，加班費 ${formatMoney(row.bonus_and_overtime, false)}`,
    };
  }
  return { text: `${days}天`, title: `加班 ${days} 天` };
}

function embedName(rel: unknown): string | null {
  if (rel == null) return null;
  const o = Array.isArray(rel) ? rel[0] : rel;
  if (o && typeof o === "object" && "name" in o) {
    const n = (o as { name?: unknown }).name;
    return n != null ? String(n) : null;
  }
  return null;
}

function periodLabelForRow(periodKey: string, rowMonthLabel: string): string {
  const ml = rowMonthLabel.trim();
  if (ml) return ml;
  const pk = periodKey.trim();
  if (!pk || pk.length < 7) return pk || "—";
  const [y, m] = pk.slice(0, 7).split("-").map((x) => Number(x));
  if (!y || !m) return pk;
  return `${y} 年 ${m} 月`;
}

export function PayslipPaidHistoryPanel() {
  /** true：列出全部已發放；false：僅指定 period_key */
  const [showAllMonths, setShowAllMonths] = useState(true);
  const [filterMonth, setFilterMonth] = useState(ymNow);
  const [rows, setRows] = useState<PaidSlipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remarkDialog, setRemarkDialog] = useState<{
    open: boolean;
    name: string;
    text: string;
  }>({ open: false, name: "", text: "" });

  const monthLabel = useMemo(() => {
    const [y, m] = filterMonth.split("-").map((x) => Number(x));
    if (!y || !m) return filterMonth;
    return `${y} 年 ${m} 月`;
  }, [filterMonth]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError(SUPABASE_CONFIG_HELP);
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const withJoin = `
        id,
        employee_id,
        period_key,
        month_label,
        base_salary,
        net_pay,
        net_salary,
        bonus_and_overtime,
        other_adjust,
        ${PAYSLIP_DETAIL_SELECT},
        status,
        created_at,
        notes,
        employees ( name )
      `;

      let data: Record<string, unknown>[] | null = null;
      let err: { message: string } | null = null;

      let q1 = supabase
        .from("payslips")
        .select(withJoin)
        .order("created_at", { ascending: false });
      if (!showAllMonths) {
        q1 = q1.eq("period_key", filterMonth);
      }
      const r1 = await q1;

      if (!r1.error) {
        data = r1.data as Record<string, unknown>[];
      } else {
        let q2 = supabase
          .from("payslips")
          .select(
            `id, employee_id, period_key, month_label, base_salary, net_pay, net_salary, bonus_and_overtime, other_adjust, ${PAYSLIP_DETAIL_SELECT}, status, created_at, notes`,
          )
          .order("created_at", { ascending: false });
        if (!showAllMonths) {
          q2 = q2.eq("period_key", filterMonth);
        }
        const r2 = await q2;

        if (r2.error) {
          if (/column|does not exist/i.test(r2.error.message ?? "")) {
            let q3 = supabase
              .from("payslips")
              .select(
                "id, employee_id, period_key, month_label, base_salary, net_pay, net_salary, status, created_at, notes",
              )
              .order("created_at", { ascending: false });
            if (!showAllMonths) {
              q3 = q3.eq("period_key", filterMonth);
            }
            const r3 = await q3;
            if (r3.error) {
              err = r3.error;
            } else {
              data = r3.data as Record<string, unknown>[];
              const ids = [
                ...new Set(
                  (data ?? [])
                    .map((r) => String(r.employee_id ?? "").trim())
                    .filter(Boolean),
                ),
              ];
              const nameById = new Map<string, string>();
              if (ids.length) {
                const { data: emps } = await supabase
                  .from("employees")
                  .select("id, name")
                  .in("id", ids);
                for (const e of emps ?? []) {
                  const rec = e as { id: string; name?: string };
                  if (rec.id)
                    nameById.set(String(rec.id), String(rec.name ?? "—"));
                }
              }
              const mapped: PaidSlipRow[] = (data ?? [])
                .filter((r) => isPaidStatus(String(r.status ?? "")))
                .map((r) =>
                  mapRawToPaidSlipRow(
                    r,
                    nameById.get(String(r.employee_id ?? "")) ?? "—",
                  ),
                );
              setRows(mapped);
              return;
            }
          } else {
            err = r2.error;
          }
        } else {
          data = r2.data as Record<string, unknown>[];
          const ids = [
            ...new Set(
              (data ?? [])
                .map((r) => String(r.employee_id ?? "").trim())
                .filter(Boolean),
            ),
          ];
          const nameById = new Map<string, string>();
          if (ids.length) {
            const { data: emps } = await supabase
              .from("employees")
              .select("id, name")
              .in("id", ids);
            for (const e of emps ?? []) {
              const rec = e as { id: string; name?: string };
              if (rec.id) nameById.set(String(rec.id), String(rec.name ?? "—"));
            }
          }
          const mapped: PaidSlipRow[] = (data ?? [])
            .filter((r) => isPaidStatus(String(r.status ?? "")))
            .map((r) =>
              mapRawToPaidSlipRow(
                r,
                nameById.get(String(r.employee_id ?? "")) ?? "—",
              ),
            );
          setRows(mapped);
          return;
        }
      }

      if (err) {
        setError(err.message || "無法讀取薪資紀錄");
        setRows([]);
        return;
      }

      const mapped: PaidSlipRow[] = (data ?? [])
        .filter((r) => isPaidStatus(String(r.status ?? "")))
        .map((r) =>
          mapRawToPaidSlipRow(
            r,
            embedName(r.employees) ??
              (String(r.employee_id ?? "").trim() || "—"),
          ),
        );

      setRows(mapped);
    } finally {
      setLoading(false);
    }
  }, [filterMonth, monthLabel, showAllMonths]);

  useEffect(() => {
    void load();
  }, [load]);

  function formatDateTime(iso: string | null, compact = false): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
    if (compact) {
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${mo}/${day} ${hh}:${mm}`;
    }
    return d.toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
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
      <div className="flex flex-col gap-4 border-b border-border bg-card px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex min-w-0 gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"
            aria-hidden
          >
            <Receipt className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="sr-only">已發放薪資查詢</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 shadow-xs">
            <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
              範圍
            </span>
            <select
              value={showAllMonths ? "all" : "month"}
              onChange={(e) => {
                const v = e.target.value;
                setShowAllMonths(v === "all");
              }}
              className="min-w-[6.5rem] bg-transparent text-sm font-medium text-foreground focus:outline-none"
              aria-label="已發放薪資範圍"
            >
              <option value="all">全部月份</option>
              <option value="month">指定月份</option>
            </select>
          </label>
          {!showAllMonths && (
            <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 shadow-xs">
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                薪資月份
              </span>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="min-w-[9.5rem] bg-transparent text-sm font-medium text-foreground focus:outline-none"
                aria-label="依月份篩選已發放薪資"
              />
            </label>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 px-3 text-xs"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            重新整理
          </Button>
        </div>
      </div>

      {error && (
        <p className="border-b border-border bg-destructive/5 px-4 py-2.5 text-sm text-destructive sm:px-5">
          {error}
        </p>
      )}

      <div className="px-2 pb-3 pt-2 max-md:overflow-x-auto md:overflow-visible sm:px-4 sm:pb-4">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            載入中…
          </p>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <p>
              {showAllMonths
                ? "尚無已發放薪資紀錄。"
                : `${monthLabel} 尚無已發放薪資紀錄。`}
            </p>
            <p className="mt-1 text-xs opacity-80">
              {showAllMonths
                ? "可改選「指定月份」篩選，或至「薪資結算」完成發放。"
                : "可換其他月份、改選「全部月份」，或至「薪資結算」完成發放。"}
            </p>
          </div>
        ) : (
          <Table
            wrapperClassName="overflow-visible"
            className="max-md:min-w-[920px] md:min-w-0 md:table-fixed md:w-full"
          >
            <colgroup className="hidden md:table-column-group">
              <col className="w-[4.5rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[3.5rem]" />
              <col className="w-[3rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[2.5rem]" />
              <col className="w-[2.5rem]" />
              <col className="w-[4.25rem]" />
              <col className="w-[3rem]" />
              <col className="w-[3.75rem]" />
              <col className="w-[4.25rem]" />
              <col className="w-[2.25rem]" />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30 md:[&_th]:px-1.5 md:[&_th]:py-1.5 md:[&_th]:whitespace-normal">
                <TableHead
                  title="員工"
                  className="max-md:sticky max-md:left-0 max-md:z-20 max-md:bg-muted/30 max-md:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.08)] text-xs font-semibold"
                >
                  員工
                </TableHead>
                <TableHead title="薪資月份" className="text-xs font-semibold">
                  <span className="md:hidden">薪資月份</span>
                  <span className="hidden md:inline">月份</span>
                </TableHead>
                <TableHead title="本月薪資" className="text-right text-xs font-semibold">
                  <span className="md:hidden">本月薪資</span>
                  <span className="hidden md:inline">底薪</span>
                </TableHead>
                <TableHead title="勞保自付" className="text-right text-xs font-semibold">
                  <span className="md:hidden">勞保自付</span>
                  <span className="hidden md:inline">勞保</span>
                </TableHead>
                <TableHead title="健保自付" className="text-right text-xs font-semibold">
                  <span className="md:hidden">健保自付</span>
                  <span className="hidden md:inline">健保</span>
                </TableHead>
                <TableHead title="請假扣款（事假＋病假）" className="text-right text-xs font-semibold">
                  <span className="md:hidden">
                    <span className="block">請假扣款</span>
                    <span className="text-[10px] font-normal text-muted-foreground/90">
                      （事+病）
                    </span>
                  </span>
                  <span className="hidden md:inline">請假</span>
                </TableHead>
                <TableHead title="本月特休（假單建立於結算月）" className="text-right text-xs font-semibold">
                  <span className="md:hidden">
                    <span className="block">本月特休</span>
                    <span className="text-[10px] font-normal text-muted-foreground/90">
                      建立日於本月
                    </span>
                  </span>
                  <span className="hidden md:inline">特休</span>
                </TableHead>
                <TableHead
                  title="加班天數／加班費／轉補休"
                  className="text-right text-xs font-semibold"
                >
                  加班
                </TableHead>
                <TableHead title="其他調整" className="text-right text-xs font-semibold">
                  <span className="md:hidden">其他調整</span>
                  <span className="hidden md:inline">調整</span>
                </TableHead>
                <TableHead title="實發總額" className="text-right text-xs font-semibold">
                  <span className="md:hidden">實發總額</span>
                  <span className="hidden md:inline">實發</span>
                </TableHead>
                <TableHead title="入帳時間" className="text-xs font-semibold">
                  <span className="md:hidden">入帳時間</span>
                  <span className="hidden md:inline">入帳</span>
                </TableHead>
                <TableHead title="出勤備註" className="text-xs font-semibold">
                  備註
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="md:[&_td]:px-1.5 md:[&_td]:py-2 md:[&_td]:whitespace-normal">
              {rows.map((row) => {
                const healthPerPerson =
                  row.health_insured_persons != null &&
                  row.health_insured_persons > 1
                    ? Math.round(
                        row.health_insurance_employee /
                          row.health_insured_persons,
                      )
                    : null;
                const healthTitle =
                  healthPerPerson != null
                    ? `每人 ${healthPerPerson.toLocaleString("zh-TW")} × ${row.health_insured_persons} 人`
                    : undefined;
                const leaveTitle =
                  row.leave_days > 0
                    ? `計薪 ${row.leave_days.toLocaleString("zh-TW")} 天`
                    : undefined;
                const overtimeMobile = formatOvertimeCell(row, false);
                const overtimeDesktop = formatOvertimeCell(row, true);

                return (
                  <TableRow
                    key={row.id}
                    className="border-b border-border hover:bg-muted/20"
                  >
                    <TableCell
                      title={row.employee_name}
                      className="max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card max-md:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.06)] max-w-[5.5rem] truncate text-sm font-medium text-foreground md:max-w-none"
                    >
                      {row.employee_name}
                    </TableCell>
                    <TableCell
                      title={row.month_label || row.period_key}
                      className="text-sm text-muted-foreground max-md:whitespace-nowrap"
                    >
                      <span className="md:hidden">
                        {row.month_label || row.period_key}
                      </span>
                      <span className="hidden md:inline">
                        {compactMonthLabel(row.period_key, row.month_label)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <span className="md:hidden">
                        {formatMoney(row.base_salary, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatMoney(row.base_salary, true)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      <span className="md:hidden">
                        {formatDeduction(row.labor_insurance_employee, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatDeduction(row.labor_insurance_employee, true)}
                      </span>
                    </TableCell>
                    <TableCell
                      title={healthTitle}
                      className="text-right text-sm tabular-nums text-muted-foreground"
                    >
                      {row.health_insurance_employee === 0 ? (
                        "—"
                      ) : (
                        <>
                          <span className="md:hidden">
                            {formatDeduction(row.health_insurance_employee, false)}
                          </span>
                          <span className="hidden md:inline">
                            {formatDeduction(row.health_insurance_employee, true)}
                          </span>
                          {healthPerPerson != null ? (
                            <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground md:hidden">
                              每人 NT$ {healthPerPerson.toLocaleString("zh-TW")}{" "}
                              × {row.health_insured_persons} 人
                            </span>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell
                      title={leaveTitle}
                      className="text-right text-sm tabular-nums text-red-600 dark:text-red-400"
                    >
                      <span className="md:hidden">
                        {formatDeduction(row.leave_deduction, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatDeduction(row.leave_deduction, true)}
                      </span>
                      {row.leave_days > 0 ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground md:hidden">
                          計薪 {row.leave_days.toLocaleString("zh-TW")} 天
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.special_leave_days_settled > 0
                        ? `${row.special_leave_days_settled.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}天`
                        : "—"}
                    </TableCell>
                    <TableCell
                      title={overtimeMobile.title}
                      className="text-right text-sm tabular-nums"
                    >
                      <span className="md:hidden">{overtimeMobile.text}</span>
                      <span className="hidden md:inline">{overtimeDesktop.text}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <span className="md:hidden">
                        {formatOtherAdjust(row.other_adjust, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatOtherAdjust(row.other_adjust, true)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums text-primary">
                      <span className="md:hidden">
                        {formatMoney(row.net_pay, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatMoney(row.net_pay, true)}
                      </span>
                    </TableCell>
                    <TableCell
                      title={formatDateTime(row.created_at, false)}
                      className="text-sm text-muted-foreground max-md:whitespace-nowrap"
                    >
                      <span className="md:hidden">
                        {formatDateTime(row.created_at, false)}
                      </span>
                      <span className="hidden md:inline">
                        {formatDateTime(row.created_at, true)}
                      </span>
                    </TableCell>
                    <TableCell className="max-md:max-w-[10rem]">
                      {row.notes ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 gap-1 px-2 text-xs text-muted-foreground md:h-7 md:w-7 md:gap-0 md:p-0"
                          aria-label={`查看 ${row.employee_name} 出勤備註`}
                          onClick={() =>
                            setRemarkDialog({
                              open: true,
                              name: row.employee_name,
                              text: row.notes ?? "",
                            })
                          }
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="md:hidden">查看明細</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog.Root
        open={remarkDialog.open}
        onOpenChange={(open) => setRemarkDialog((d) => ({ ...d, open }))}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(80vh,32rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              出勤備註 · {remarkDialog.name}
            </Dialog.Title>
            <Dialog.Description asChild>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {remarkDialog.text}
              </p>
            </Dialog.Description>
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemarkDialog((d) => ({ ...d, open: false }))}
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
