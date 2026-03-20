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
import { Receipt, RefreshCw } from "lucide-react";

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
  net_pay: number;
  status: string;
  created_at: string | null;
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

export function PayslipPaidHistoryPanel() {
  const [filterMonth, setFilterMonth] = useState(ymNow);
  const [rows, setRows] = useState<PaidSlipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        status,
        created_at,
        employees ( name )
      `;

      let data: Record<string, unknown>[] | null = null;
      let err: { message: string } | null = null;

      const q1 = await supabase
        .from("payslips")
        .select(withJoin)
        .eq("period_key", filterMonth)
        .order("created_at", { ascending: false });

      if (!q1.error) {
        data = q1.data as Record<string, unknown>[];
      } else {
        const q2 = await supabase
          .from("payslips")
          .select(
            "id, employee_id, period_key, month_label, base_salary, net_pay, net_salary, status, created_at",
          )
          .eq("period_key", filterMonth)
          .order("created_at", { ascending: false });

        if (q2.error) {
          err = q2.error;
        } else {
          data = q2.data as Record<string, unknown>[];
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
            .map((r) => ({
              id: String(r.id ?? ""),
              employee_id: String(r.employee_id ?? ""),
              employee_name: nameById.get(String(r.employee_id ?? "")) ?? "—",
              period_key: String(r.period_key ?? filterMonth),
              month_label: String(r.month_label ?? "").trim() || monthLabel,
              base_salary: num(r.base_salary, 0),
              net_pay: num(r.net_pay ?? r.net_salary, 0),
              status: String(r.status ?? ""),
              created_at:
                r.created_at != null ? String(r.created_at) : null,
            }));
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
        .map((r) => ({
          id: String(r.id ?? ""),
          employee_id: String(r.employee_id ?? ""),
          employee_name:
            embedName(r.employees) ??
            (String(r.employee_id ?? "").trim() || "—"),
          period_key: String(r.period_key ?? filterMonth),
          month_label: String(r.month_label ?? "").trim() || monthLabel,
          base_salary: num(r.base_salary, 0),
          net_pay: num(r.net_pay ?? r.net_salary, 0),
          status: String(r.status ?? ""),
          created_at: r.created_at != null ? String(r.created_at) : null,
        }));

      setRows(mapped);
    } finally {
      setLoading(false);
    }
  }, [filterMonth, monthLabel]);

  useEffect(() => {
    void load();
  }, [load]);

  function formatDateTime(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
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
          <div className="min-w-0 space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-wide text-foreground">
              已發放薪資查詢
            </h2>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              依薪資月份（period_key）篩選，僅列出狀態為已發放之薪資單。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

      <div className="overflow-x-auto px-2 pb-3 pt-2 sm:px-4 sm:pb-4">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            載入中…
          </p>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <p>{monthLabel} 尚無已發放薪資紀錄。</p>
            <p className="mt-1 text-xs opacity-80">
              可換其他月份，或至「薪資結算」完成發放。
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs font-semibold">員工</TableHead>
                <TableHead className="text-xs font-semibold whitespace-nowrap">
                  薪資月份
                </TableHead>
                <TableHead className="text-right text-xs font-semibold">
                  底薪
                </TableHead>
                <TableHead className="text-right text-xs font-semibold">
                  實發總額
                </TableHead>
                <TableHead className="text-xs font-semibold">狀態</TableHead>
                <TableHead className="text-xs font-semibold whitespace-nowrap">
                  入帳時間
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-b border-border hover:bg-muted/20"
                >
                  <TableCell className="font-medium text-foreground">
                    {row.employee_name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {row.month_label || row.period_key}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    NT$ {row.base_salary.toLocaleString("zh-TW")}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums text-primary">
                    NT$ {row.net_pay.toLocaleString("zh-TW")}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full border border-emerald-600/20 bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                      已發放
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
