"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, supabase, SUPABASE_CONFIG_HELP } from "@/lib/supabase";

const ERR_ZH: Record<string, string> = {
  forbidden: "僅管理員可補登加班。",
  invalid_hours: "請輸入大於 0 的加班時數。",
  employee_not_found: "找不到有效員工。",
  already_exists: "該員此日已有加班紀錄（已轉補休）。",
};

type RpcPayload = { ok?: boolean; error?: string };

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 列表範圍：上月 1 日 ～ 本月最末日 */
function listRangeIso(): { start: string; end: string } {
  const now = new Date();
  const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(firstOfPrevMonth), end: fmt(lastOfMonth) };
}

/** 與出勤戰情一致：employment_status NULL 視為在職 */
function isEmployedInDb(v: unknown): boolean {
  if (v === false) return false;
  if (v == null || v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "離職" || s === "false" || s === "0") return false;
    return s === "true" || s === "在職" || s === "1";
  }
  return Boolean(v);
}

type OvertimeRow = {
  id: string;
  employee_id: string;
  overtime_date: string;
  hours: number | null;
  reason: string | null;
};

/**
 * 手動補登加班（出差、外勤等未在公司打卡）：寫入 overtime_records 並累加補休金庫，
 * 薪資結算會自動帶入該月加班時數（屆時可選轉補休或加班費）。
 * 版面格式與「手動設定特殊假日」（PublicHolidaysAdminCard）一致。
 */
export function ManualOvertimeAdminCard({ onMutate }: { onMutate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [dateStr, setDateStr] = useState(todayIsoDate);
  const [hoursInput, setHoursInput] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadEmployees = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setEmployees([]);
      return;
    }
    setEmployeesLoading(true);
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, employment_status")
        .is("deleted_at", null)
        .or("employment_status.is.null,employment_status.eq.true");
      if (error) throw error;
      const next: { id: string; name: string }[] = [];
      for (const raw of data ?? []) {
        const rec = raw as { id: string; name?: string; employment_status?: unknown };
        if (!isEmployedInDb(rec.employment_status)) continue;
        next.push({ id: String(rec.id), name: String(rec.name ?? "—") });
      }
      next.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      setEmployees(next);
    } catch (e) {
      console.error("[manual-overtime] employees:", e);
      toast.error(e instanceof Error ? e.message : "無法載入員工名單");
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRows([]);
      return;
    }
    setListLoading(true);
    try {
      const { start, end } = listRangeIso();
      const { data, error } = await supabase
        .from("overtime_records")
        .select("id, employee_id, overtime_date, hours, reason")
        .gte("overtime_date", start)
        .lte("overtime_date", end)
        .order("overtime_date", { ascending: false });
      if (error) throw error;
      const next: OvertimeRow[] = (data ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const h = Number(rec.hours);
        return {
          id: String(rec.id),
          employee_id: String(rec.employee_id),
          overtime_date: String(rec.overtime_date ?? "").slice(0, 10),
          hours: Number.isFinite(h) && h > 0 ? h : null,
          reason:
            rec.reason != null && String(rec.reason).trim() !== ""
              ? String(rec.reason)
              : null,
        };
      });
      setRows(next);
    } catch (e) {
      console.error("[manual-overtime] list:", e);
      toast.error(e instanceof Error ? e.message : "無法載入加班紀錄");
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadEmployees();
    void loadList();
  }, [open, loadEmployees, loadList]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast.error(SUPABASE_CONFIG_HELP);
      return;
    }
    if (!employeeId) {
      toast.error("請選擇員工。");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      toast.error("請選擇有效日期。");
      return;
    }
    const hours = Number(String(hoursInput).replace(",", "."));
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("請輸入有效的加班時數（大於 0）。");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("approve_overtime_to_comp_leave", {
        p_employee_id: employeeId,
        p_hours: hours,
        p_overtime_date: dateStr,
        p_reason: reason.trim(),
      });
      if (error) {
        toast.error(error.message || "補登失敗");
        return;
      }
      const payload = data as RpcPayload | null;
      if (payload && payload.ok === false) {
        const code = typeof payload.error === "string" ? payload.error : "";
        toast.error((ERR_ZH[code] ?? code) || "補登失敗");
        return;
      }
      toast.success("已補登加班並轉入補休金庫。");
      setHoursInput("");
      setReason("");
      onMutate?.();
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "補登失敗");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP} 未連線時無法補登加班。
      </div>
    );
  }

  const employeeNameById = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-serif text-base font-semibold text-foreground">
          <CalendarPlus className="h-5 w-5 text-primary" aria-hidden />
          💰 手動補登加班（出差／未打卡）
        </span>
        <ChevronDown
          className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              適用出差、外勤等未在公司打卡的加班（例：假日出差）。補登後立即寫入{" "}
              <code className="rounded bg-muted px-1">overtime_records</code>{" "}
              並累加補休金庫；薪資結算會自動帶入該月加班時數，屆時可選轉補休或加班費，無須再手動加減。
            </p>
            <div>
              <label htmlFor="mot-employee" className="text-sm font-medium text-foreground">
                員工 <span className="text-destructive">*</span>
              </label>
              <select
                id="mot-employee"
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={employeesLoading}
                className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{employeesLoading ? "載入員工中…" : "請選擇員工…"}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mot-date" className="text-sm font-medium text-foreground">
                加班日期 <span className="text-destructive">*</span>
              </label>
              <input
                id="mot-date"
                type="date"
                required
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="mot-hours" className="text-sm font-medium text-foreground">
                核定加班時數（小時） <span className="text-destructive">*</span>
              </label>
              <input
                id="mot-hours"
                type="number"
                required
                min={0.01}
                step={0.1}
                value={hoursInput}
                onChange={(e) => setHoursInput(e.target.value)}
                placeholder="例：8"
                className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="mot-reason" className="text-sm font-medium text-foreground">
                備註事由（選填）
              </label>
              <input
                id="mot-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：假日出差、展場支援"
                className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              確認補登並轉入金庫
            </Button>
          </form>

          <div>
            <p className="text-sm font-semibold text-foreground">已補登／核准列表</p>
            <p className="mt-1 text-xs text-muted-foreground">
              顯示範圍：上月 1 日起至本月月底（含出勤戰情核准之轉補休紀錄）。同員工同日不可重複補登。
            </p>
            {listLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                載入中…
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">此範圍內尚無資料。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {r.overtime_date.replace(/-/g, "/")}
                      </p>
                      <p className="text-sm text-foreground">
                        {employeeNameById.get(r.employee_id) ?? "—"}
                        {r.reason ? (
                          <span className="text-muted-foreground">（{r.reason}）</span>
                        ) : null}
                      </p>
                      <div>
                        <Badge
                          variant="outline"
                          className="border-emerald-600/40 bg-emerald-100 text-emerald-950 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-50"
                        >
                          💰 已轉補休{r.hours != null ? ` ${r.hours} 小時` : ""}
                        </Badge>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
