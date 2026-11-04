"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarHeart, CloudRain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  dueAnnualLeaveMilestones,
  milestoneLabel,
  type AnnualLeaveMilestone,
} from "@/lib/annual-leave-grant";
import { formatLeaveHoursLabel } from "@/lib/leave-hours";
import { approveAnnualLeaveGrantRpc, decideHolidayRefundRpc } from "@/lib/leave-balance-rpc";
import {
  fetchHolidayRefunds,
  syncHolidayRefunds,
  type HolidayRefundRow,
} from "@/lib/leave-holiday-refund-sync";

type DueGrant = AnnualLeaveMilestone & {
  employeeId: string;
  employeeName: string;
  hireDate: string;
};

function md(ymd: string): string {
  return ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "";
}

function range(start: string, end: string): string {
  return end && end !== start ? `${md(start)}–${md(end)}` : md(start);
}

/** 在職員工中，年資已達里程碑但尚未核准的特休 */
async function fetchDueGrants(): Promise<DueGrant[]> {
  const [empRes, grantRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, hire_date, unpaid_leave_months, employment_status, deleted_at"),
    supabase.from("annual_leave_grants").select("employee_id, milestone_years"),
  ]);
  if (empRes.error || grantRes.error) {
    console.warn("[annual-leave-grant]", empRes.error?.message ?? grantRes.error?.message);
    return [];
  }
  const granted = new Set(
    (grantRes.data ?? []).map((g) => `${g.employee_id}|${Number(g.milestone_years)}`),
  );
  const today = new Date();
  const list: DueGrant[] = [];
  for (const e of empRes.data ?? []) {
    if (e.deleted_at || e.employment_status === false || !e.hire_date) continue;
    for (const m of dueAnnualLeaveMilestones(e.hire_date, today, e.unpaid_leave_months)) {
      if (granted.has(`${e.id}|${m.milestoneYears}`)) continue;
      list.push({ ...m, employeeId: e.id, employeeName: e.name ?? "—", hireDate: e.hire_date });
    }
  }
  list.sort((a, b) => a.employeeName.localeCompare(b.employeeName, "zh-TW") || a.milestoneYears - b.milestoneYears);
  return list;
}

/** 年資滿當天起列出待核准的特休；天數可依入職約定調整，與法定不同時原因必填 */
function AnnualLeaveGrantPanel({ onChanged }: { onChanged: () => void }) {
  const [due, setDue] = useState<DueGrant[]>([]);
  const [draft, setDraft] = useState<Record<string, { days: number | null; note: string }>>({});
  const [actingKey, setActingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchDueGrants();
      if (!cancelled) setDue(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (due.length === 0) return null;

  async function approve(g: DueGrant) {
    const key = `${g.employeeId}|${g.milestoneYears}`;
    const d = draft[key] ?? { days: g.days, note: "" };
    const days = d.days ?? g.days;
    const note = d.note.trim();
    if (!(days > 0)) {
      toast.error("核給天數必須大於 0。");
      return;
    }
    const differs = Math.abs(days - g.days) > 0.001;
    if (differs && !note) {
      toast.error(`核給 ${days} 天與法定 ${g.days} 天不同，請填寫原因（例如入職約定）。`);
      return;
    }
    if (
      !window.confirm(
        `核准「${g.employeeName}」${milestoneLabel(g.milestoneYears)}特休 ${days} 天？\n核准後立即加入特休餘額，並列入本月薪資單備註。`,
      )
    ) {
      return;
    }
    setActingKey(key);
    const res = await approveAnnualLeaveGrantRpc({
      employeeId: g.employeeId,
      milestoneYears: g.milestoneYears,
      days,
      statutoryDays: g.days,
      note: note || null,
    });
    setActingKey(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`已核准「${g.employeeName}」特休 +${days} 天`);
    setDue(await fetchDueGrants());
    onChanged();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarHeart className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">年資特休待核准</h3>
        <span className="text-xs text-muted-foreground">
          年資滿當天起列出；天數可依入職約定調整，與法定不同時請填原因。核准後立即入帳。
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {due.map((g) => {
          const key = `${g.employeeId}|${g.milestoneYears}`;
          const d = draft[key] ?? { days: g.days, note: "" };
          const differs = d.days != null && Math.abs(d.days - g.days) > 0.001;
          return (
            <li key={key} className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-foreground">{g.employeeName}</span>
                <span className="text-sm text-foreground">{milestoneLabel(g.milestoneYears)}</span>
                <span className="text-xs text-muted-foreground">
                  到職 {g.hireDate.slice(0, 10)}・法定 {g.days} 天
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                <label className="block text-xs text-muted-foreground">
                  核給天數
                  <NumericInput
                    allowDecimal
                    value={d.days}
                    onValueChange={(v) => setDraft((p) => ({ ...p, [key]: { ...d, days: v } }))}
                    className="mt-1 w-full"
                    aria-label={`${g.employeeName} 核給天數`}
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  原因{differs ? <span className="text-destructive">（必填）</span> : "（選填）"}
                  <input
                    type="text"
                    value={d.note}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: { ...d, note: e.target.value } }))}
                    placeholder={differs ? "例如：入職約定 10 天" : ""}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <Button
                  type="button"
                  className="h-9 w-full sm:w-auto"
                  disabled={actingKey != null}
                  onClick={() => void approve(g)}
                >
                  {actingKey === key ? "處理中…" : "核准入帳"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 假單送出後才新增的放假日（颱風假等）回補單 */
async function loadPendingRefunds(scan: boolean): Promise<HolidayRefundRow[]> {
  if (scan) {
    const res = await syncHolidayRefunds();
    if (!res.ok) console.warn("[holiday-refund] sync:", res.message);
  }
  try {
    return await fetchHolidayRefunds(["pending"]);
  } catch (e) {
    console.warn("[holiday-refund] load:", e);
    return [];
  }
}

function HolidayRefundPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<HolidayRefundRow[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  // 開啟時先掃描近期新增的放假日，產生回補單後載入待審
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadPendingRefunds(true);
      if (!cancelled) setRows(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) return null;

  async function decide(r: HolidayRefundRow, approve: boolean) {
    let reason: string | null = null;
    if (approve) {
      const what =
        r.leave_type === "特休" || r.leave_type.startsWith("補休")
          ? `退回${r.leave_type} ${formatLeaveHoursLabel(r.hours)}`
          : `${r.leave_type}少扣 ${formatLeaveHoursLabel(r.hours)}（已發薪月份會在下次結算補發）`;
      if (!window.confirm(`核准回補「${r.employee_name}」${md(r.holiday_date)} ${r.holiday_name ?? "放假日"}？\n${what}，並列入本月薪資單備註。`)) {
        return;
      }
    } else {
      const input = window.prompt(`不回補「${r.employee_name}」${md(r.holiday_date)} 的請假？可填寫原因（選填）：`, "");
      if (input === null) return;
      reason = input.trim() || null;
    }
    setActingId(r.id);
    const res = await decideHolidayRefundRpc(r.id, approve, reason);
    setActingId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(approve ? `已回補「${r.employee_name}」${formatLeaveHoursLabel(r.hours)}` : "已設為不回補");
    setRows(await loadPendingRefunds(false));
    onChanged();
  }

  return (
    <section className="rounded-xl border border-amber-600/30 bg-amber-50/60 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/20">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CloudRain className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">假日回補待審核</h3>
        <span className="text-xs text-muted-foreground">
          假單送出後才新增的放假日（颱風假等），送單時把那天算成上班日。核准後扣回假單時數並列入本月薪資單備註。
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold text-foreground">{r.employee_name}</span>
                <span className="text-foreground">
                  {md(r.holiday_date)} {r.holiday_name ?? "放假日"}
                </span>
                <span className="tabular-nums font-medium text-primary">
                  回補 {formatLeaveHoursLabel(r.hours)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                原假單：{r.leave_type} {range(r.leave_start, r.leave_end)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-8 px-3 text-xs"
                disabled={actingId != null}
                onClick={() => void decide(r, true)}
              >
                {actingId === r.id ? "處理中…" : "核准回補"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={actingId != null}
                onClick={() => void decide(r, false)}
              >
                不回補
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 假單審核頁「待審核」上方：年資特休、假日回補 */
export function LeaveBalanceReviewPanels({ onChanged }: { onChanged: () => void }) {
  if (!isSupabaseConfigured) return null;
  return (
    <div className="space-y-3">
      <HolidayRefundPanel onChanged={onChanged} />
      <AnnualLeaveGrantPanel onChanged={onChanged} />
    </div>
  );
}
