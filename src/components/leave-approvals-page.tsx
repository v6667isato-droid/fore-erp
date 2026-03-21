"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { cn, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import {
  Banknote,
  CalendarDays,
  ClipboardList,
  Clock,
  Inbox,
  Receipt,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react";
import { SalarySettlementCenter } from "@/components/salary-settlement-center";
import { PayslipPaidHistoryPanel } from "@/components/payslip-paid-history-panel";
import {
  AttendanceManagementTabs,
  type AttendanceManagementTabKey,
} from "@/components/attendance-management-tabs";
import { EmployeesPage } from "@/components/employees-page";

interface LeaveRequestAdminRow {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type_label: string;
  start_date: string;
  end_date: string;
  days: number;
  created_at: string | null;
  status_raw: string;
}

/** 產生最近 N 個月的 YYYY-MM（含當月），供歷史假單月份下拉使用 */
function recentYearMonths(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function monthOverlap(
  start: string,
  end: string,
  ym: string,
): boolean {
  const p = parseYm(ym);
  if (!p) return true;
  const last = new Date(p.y, p.m, 0);
  const ms = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
  const me = `${p.y}-${String(p.m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  return s <= me && e >= ms;
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function embedEmployeeName(rel: unknown): string | null {
  if (rel == null) return null;
  const o = Array.isArray(rel) ? rel[0] : rel;
  if (o && typeof o === "object" && "name" in o) {
    const n = (o as { name?: unknown }).name;
    return n != null ? String(n) : null;
  }
  return null;
}

function normalizeStatus(raw: string | null | undefined): "pending" | "approved" | "rejected" {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved" || s === "已核准" || s === "核准") return "approved";
  if (s === "rejected" || s === "退回" || s === "拒絕") return "rejected";
  if (s === "pending" || s === "待審核" || s === "") return "pending";
  return "pending";
}

function mapRowToAdminRow(
  r: Record<string, unknown>,
  nameById: Map<string, string>,
): LeaveRequestAdminRow {
  const id = String(r.id ?? "");
  const eid = String(r.employee_id ?? r.employeeId ?? "");
  const joined = embedEmployeeName(r.employees);
  const start = String(r.start_date ?? r.start ?? "").slice(0, 10);
  const end = String(r.end_date ?? r.end ?? start).slice(0, 10);
  const days = num(r.total_days ?? r.days_count ?? r.days, 0);
  const lt = String(r.leave_type ?? r.type_label ?? r.type ?? "假別").trim() || "假別";
  const created =
    r.created_at != null
      ? String(r.created_at)
      : r.inserted_at != null
        ? String(r.inserted_at)
        : null;
  return {
    id,
    employee_id: eid,
    employee_name: joined ?? (eid ? nameById.get(eid) ?? "—" : "—"),
    leave_type_label: lt,
    start_date: start || "—",
    end_date: end || "—",
    days,
    created_at: created,
    status_raw: String(r.status ?? ""),
  };
}

function leaveBadgeStyles(typeLabel: string): string {
  const t = typeLabel.trim();
  if (t === "特休" || t.startsWith("特休")) {
    return "border-amber-700/25 bg-amber-100/90 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100";
  }
  if (t.includes("病假") || t === "病假") {
    return "border-sky-700/20 bg-sky-100/90 text-sky-950 dark:border-sky-500/25 dark:bg-sky-950/35 dark:text-sky-100";
  }
  if (t.includes("事假") || t === "事假") {
    return "border-stone-500/25 bg-stone-200/80 text-stone-900 dark:border-stone-500/30 dark:bg-stone-800/60 dark:text-stone-100";
  }
  return "border-border bg-muted text-foreground";
}

type TabKey = "pending" | "history";
type MainSection =
  | "attendance"
  | "leave"
  | "payroll"
  | "paid_history"
  | "employees";

type HeaderIcon =
  | typeof Clock
  | typeof CalendarDays
  | typeof ClipboardList
  | typeof Banknote
  | typeof Receipt
  | typeof Users;

export function LeaveApprovalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mainSection, setMainSection] = useState<MainSection>("leave");
  const [tab, setTab] = useState<TabKey>("pending");
  const [attendanceSubTab, setAttendanceSubTab] =
    useState<AttendanceManagementTabKey>("import");
  /** 空字串＝全部月份；YYYY-MM＝與該月請假區間重疊者 */
  const [historyMonth, setHistoryMonth] = useState("");
  const [rows, setRows] = useState<LeaveRequestAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

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
        leave_type,
        start_date,
        end_date,
        status,
        total_days,
        created_at,
        employees ( name )
      `;

      let data: Record<string, unknown>[] | null = null;
      let err: { message: string } | null = null;

      const attempt1 = await supabase
        .from("leave_requests")
        .select(withJoin)
        .order("created_at", { ascending: false });

      if (!attempt1.error) {
        data = attempt1.data as Record<string, unknown>[];
      } else {
        const plain = await supabase
          .from("leave_requests")
          .select(
            "id, employee_id, leave_type, start_date, end_date, status, total_days, created_at, inserted_at",
          )
          .order("created_at", { ascending: false });

        if (plain.error) {
          err = plain.error;
        } else {
          data = plain.data as Record<string, unknown>[];
          const ids = [
            ...new Set(
              (data ?? [])
                .map((r) => String(r.employee_id ?? r.employeeId ?? "").trim())
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
          setRows(
            (data ?? []).map((r) => mapRowToAdminRow(r, nameById)),
          );
          return;
        }
      }

      if (err) {
        setError(err.message || "無法讀取假單");
        setRows([]);
        return;
      }

      const nameById = new Map<string, string>();
      setRows((data ?? []).map((r) => mapRowToAdminRow(r, nameById)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("attendanceTab") !== "employees") return;
    setMainSection("employees");
    const next = new URLSearchParams(searchParams.toString());
    next.delete("attendanceTab");
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [searchParams, router]);

  const pendingList = useMemo(
    () => rows.filter((r) => normalizeStatus(r.status_raw) === "pending"),
    [rows],
  );

  const historyList = useMemo(() => {
    const list = rows.filter((r) => {
      const st = normalizeStatus(r.status_raw);
      return st === "approved" || st === "rejected";
    });
    if (!historyMonth) return list;
    return list.filter((r) =>
      monthOverlap(r.start_date, r.end_date, historyMonth),
    );
  }, [rows, historyMonth]);

  async function approve(id: string) {
    if (!window.confirm("確定核准此假單？")) return;
    setActingId(id);
    try {
      const { error: uErr } = await supabase
        .from("leave_requests")
        .update({ status: "approved" })
        .eq("id", id);
      if (uErr) {
        toast.error(uErr.message || "更新失敗");
        return;
      }
      toast.success("已核准假單");
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function reject(id: string) {
    if (!window.confirm("確定退回此假單？")) return;
    setActingId(id);
    try {
      const { error: uErr } = await supabase
        .from("leave_requests")
        .update({ status: "rejected" })
        .eq("id", id);
      if (uErr) {
        toast.error(uErr.message || "更新失敗");
        return;
      }
      toast.success("已退回假單");
      await load();
    } finally {
      setActingId(null);
    }
  }

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

  const pageHeader = useMemo((): {
    title: string;
    description: ReactNode;
    Icon: HeaderIcon;
    showLeaveRefresh: boolean;
  } => {
    switch (mainSection) {
      case "attendance":
        if (attendanceSubTab === "import") {
          return {
            title: "出勤戰情分析室",
            description: (
              <>
                上傳打卡鐘 CSV 後，自動以
                <strong className="font-medium text-foreground/90">資料筆數最多的年月</strong>
                作為分析目標並過濾其他月份。結合 Supabase 員工（timeclock_uid）、核准假單與 public_holidays（國定假日／補班）產出異常標籤與月曆熱點。
              </>
            ),
            Icon: Clock,
            showLeaveRefresh: false,
          };
        }
        return {
          title: "歷史出勤查詢",
          description: (
            <>
              依月份與員工篩選已存檔的{" "}
              <code className="rounded bg-muted px-1 text-[11px]">daily_attendance</code> 紀錄。
            </>
          ),
          Icon: CalendarDays,
          showLeaveRefresh: false,
        };
      case "leave":
        if (tab === "pending") {
          return {
            title: "假單審核 · 待審核",
            description: (
              <>
                審核員工請假申請；核准／退回寫入 leave_requests。
                <br />
                特休假核准後，會在該月底發薪時更新特休假天數。
              </>
            ),
            Icon: ClipboardList,
            showLeaveRefresh: true,
          };
        }
        return {
          title: "假單審核 · 歷史紀錄",
          description: "依月份檢視與請假區間重疊之已核准或已退回紀錄。",
          Icon: ClipboardList,
          showLeaveRefresh: true,
        };
      case "payroll":
        return {
          title: "薪資結算中心",
          description:
            "橫向捲動檢視；核准假單區分事假、病假與特休（leave_type＝特休）；發放時同步寫入 payslips 與特休餘額。",
          Icon: Banknote,
          showLeaveRefresh: false,
        };
      case "paid_history":
        return {
          title: "已發放薪資查詢",
          description:
            "預設列出全部已發放薪資；可改選指定月份（period_key）篩選。",
          Icon: Receipt,
          showLeaveRefresh: false,
        };
      case "employees":
        return {
          title: "員工資料",
          description:
            "維護員工基本資料、在職狀態與打卡識別（timeclock_uid），供出勤分析與假單審核使用。",
          Icon: Users,
          showLeaveRefresh: false,
        };
    }
  }, [mainSection, attendanceSubTab, tab]);

  const HeaderIcon = pageHeader.Icon;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
            <HeaderIcon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="font-serif text-lg font-semibold text-foreground">
              {pageHeader.title}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{pageHeader.description}</p>
          </div>
        </div>
        {pageHeader.showLeaveRefresh && isSupabaseConfigured && (
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 gap-2 text-xs sm:self-center"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            重新整理
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMainSection("attendance")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "attendance"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Upload className="h-4 w-4 shrink-0 opacity-90" />
          出勤戰情
        </button>
        <button
          type="button"
          onClick={() => setMainSection("leave")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "leave"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <ClipboardList className="h-4 w-4 shrink-0 opacity-90" />
          假單審核
        </button>
        <button
          type="button"
          onClick={() => setMainSection("payroll")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "payroll"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Banknote className="h-4 w-4 shrink-0 opacity-90" />
          薪資結算
        </button>
        <button
          type="button"
          onClick={() => setMainSection("paid_history")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "paid_history"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Receipt className="h-4 w-4 shrink-0 opacity-90" />
          已發放查詢
        </button>
        <button
          type="button"
          onClick={() => setMainSection("employees")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "employees"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Users className="h-4 w-4 shrink-0 opacity-90" />
          員工資料
        </button>
      </div>

      {mainSection === "attendance" && (
        <AttendanceManagementTabs
          activeTab={attendanceSubTab}
          onActiveTabChange={setAttendanceSubTab}
        />
      )}

      {mainSection === "payroll" && <SalarySettlementCenter />}

      {mainSection === "paid_history" && <PayslipPaidHistoryPanel />}

      {mainSection === "employees" && <EmployeesPage />}

      {mainSection === "leave" && !isSupabaseConfigured && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {SUPABASE_CONFIG_HELP}
        </div>
      )}

      {mainSection === "leave" && isSupabaseConfigured && (
        <>
          {error && isSupabaseConfigured && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-b border-border pb-2">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === "pending"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              待審核
              {pendingList.length > 0 && (
                <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-xs tabular-nums">
                  {pendingList.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === "history"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              歷史紀錄
            </button>
          </div>
        </>
      )}

      {mainSection === "leave" && isSupabaseConfigured && tab === "pending" && (
        <div className="space-y-3">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              載入中…
            </p>
          ) : pendingList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-14 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">目前沒有待審核假單</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pendingList.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-stretch sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-foreground">
                        {row.employee_name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          leaveBadgeStyles(row.leave_type_label),
                        )}
                      >
                        {row.leave_type_label}
                      </span>
                    </div>
                    <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                      <p>
                        <span className="text-xs uppercase tracking-wide">
                          請假區間
                        </span>
                        <br />
                        <span className="font-medium text-foreground">
                          {row.start_date !== "—" ? formatDate(row.start_date) : "—"}{" "}
                          <span className="text-muted-foreground">～</span>{" "}
                          {row.end_date !== "—" ? formatDate(row.end_date) : "—"}
                        </span>
                      </p>
                      <p>
                        <span className="text-xs uppercase tracking-wide">
                          請假天數
                        </span>
                        <br />
                        <span className="text-lg font-semibold tabular-nums text-primary">
                          {row.days.toLocaleString("zh-TW", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          天
                        </span>
                      </p>
                      <p className="sm:col-span-2">
                        <span className="text-xs uppercase tracking-wide">
                          申請時間
                        </span>
                        <br />
                        <span className="text-foreground">
                          {formatDateTime(row.created_at)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:w-40 sm:justify-center">
                    <Button
                      type="button"
                      className="h-9 w-full bg-emerald-800 text-white hover:bg-emerald-900 dark:bg-emerald-800 dark:hover:bg-emerald-700"
                      disabled={actingId === row.id}
                      onClick={() => void approve(row.id)}
                    >
                      ✅ 核准
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full border-red-200 bg-red-50/80 text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
                      disabled={actingId === row.id}
                      onClick={() => void reject(row.id)}
                    >
                      ❌ 退回
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mainSection === "leave" && isSupabaseConfigured && tab === "history" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="leave-history-month"
              className="text-xs font-medium text-muted-foreground"
            >
              篩選月份
            </label>
            <select
              id="leave-history-month"
              value={historyMonth}
              onChange={(e) => setHistoryMonth(e.target.value)}
              className="h-9 min-w-[11rem] rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">全部</option>
              {recentYearMonths(60).map((ym) => {
                const [y, mo] = ym.split("-");
                return (
                  <option key={ym} value={ym}>
                    {y} 年 {Number(mo)} 月
                  </option>
                );
              })}
            </select>
            <span className="text-[11px] text-muted-foreground">
              選「全部」列出所有已核准／已退回假單；選月份則僅顯示與該月區間重疊者
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            {loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                載入中…
              </p>
            ) : historyList.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {historyMonth
                  ? "此月份尚無已核准或已退回的紀錄。"
                  : "尚無已核准或已退回的假單紀錄。"}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
                    <TableHead className="text-xs font-semibold">員工</TableHead>
                    <TableHead className="text-xs font-semibold">假別</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      區間
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold">
                      天數
                    </TableHead>
                    <TableHead className="text-xs font-semibold">狀態</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      申請時間
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyList.map((row) => {
                    const st = normalizeStatus(row.status_raw);
                    return (
                      <TableRow
                        key={row.id}
                        className="border-b border-border hover:bg-muted/25"
                      >
                        <TableCell className="font-medium text-foreground">
                          {row.employee_name}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                              leaveBadgeStyles(row.leave_type_label),
                            )}
                          >
                            {row.leave_type_label}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {row.start_date !== "—" ? formatDate(row.start_date) : "—"}{" "}
                          ～{" "}
                          {row.end_date !== "—" ? formatDate(row.end_date) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {row.days.toLocaleString("zh-TW", {
                            maximumFractionDigits: 1,
                          })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {st === "approved" ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              已核准
                            </span>
                          ) : (
                            <span className="text-red-700 dark:text-red-400">
                              已退回
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(row.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
