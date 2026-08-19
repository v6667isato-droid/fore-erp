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
  Award,
  Banknote,
  CalendarDays,
  ClipboardList,
  Clock,
  Inbox,
  ListChecks,
  Receipt,
  RefreshCw,
  Send,
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
import { PerformanceBonusPage } from "@/components/performance-bonus-page";
import { CompanyAssignmentsAdmin } from "@/components/company-assignments-admin";
import { TelegramBotUsersPage } from "@/components/telegram-bot-users-page";
import {
  OVERTIME_COMPENSATION_LABELS,
  approveOvertimeRequest,
  fetchAllOvertimeRequests,
  rejectOvertimeRequest,
  revokeOvertimeRecord,
  revokeOvertimeRequest,
  type OvertimeRequestAdminRow,
} from "@/lib/employee-overtime-requests";
import {
  approveMakeupPunchRequest,
  fetchAllMakeupPunchRequests,
  rejectMakeupPunchRequest,
  revokeMakeupPunchRequest,
  type MakeupPunchRequestAdminRow,
} from "@/lib/employee-makeup-punch-requests";
import {
  checkinSourceLabel,
  checkinTypeLabel,
  taipeiDayRangeUtc,
  taipeiHmOfIso,
  taipeiYmdOfIso,
} from "@/lib/attendance-checkin";
import {
  formatLeaveUpdatedAtDisplay,
  leaveRequestRowWasUpdated,
} from "@/lib/leave-request-updated";
import {
  computeLeaveHolidayConflict,
  type HolidayLookupRow,
} from "@/lib/leave-holiday-conflict";
import { LEAVE_WORK_DAY_HOURS, formatDayDecimalAsDayHour } from "@/lib/employee-leave-time";
import {
  SICK_ANNUAL_LIMIT_DAYS,
  SICK_PROTECTION_LINE_DAYS,
  fetchAllLeaveTypes,
  getLeaveAttachmentSignedUrl,
  sickCountedDays,
  type LeaveTypeRow,
  type YearlyLeaveUsageMap,
} from "@/lib/leave-types";

interface LeaveRequestAdminRow {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type_label: string;
  start_date: string;
  end_date: string;
  days: number;
  created_at: string | null;
  /** leave_requests.updated_at（核准／退回或內容修改） */
  updated_at: string | null;
  status_raw: string;
  reason: string | null;
  /** leave-attachments bucket 內的物件路徑 */
  attachment_url: string | null;
}

/** 產生最近 N 個月的 YYYY-MM（含當月），供歷史假單月份下拉使用 */
function recentYearMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const y0 = now.getFullYear();
  const m0 = now.getMonth();
  for (let i = 0; i < count; i++) {
    const d = new Date(y0, m0 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
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

function isLeaveRequestsMissingColumnError(message: string): boolean {
  return /could not find|column .* does not exist|schema cache/i.test(message);
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

function normalizeStatus(
  raw: string | null | undefined,
): "pending" | "approved" | "rejected" | "revoked" {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "approved" || s === "已核准" || s === "核准") return "approved";
  if (s === "rejected" || s === "退回" || s === "拒絕") return "rejected";
  if (s === "revoked" || s === "已撤銷" || s === "撤銷") return "revoked";
  if (s === "pending" || s === "待審核" || s === "") return "pending";
  return "pending";
}

/**
 * 顯示假單與臨時假日重疊狀況：
 * - 假日在假單建立「之前」就存在 → 申請當下已自動扣除，純粹提示
 * - 假日在假單建立「之後」才新增 → 既有天數未排除該日，需要管理者確認
 */
function HolidayConflictNote({
  startDate,
  endDate,
  createdAt,
  holidayRows,
}: {
  startDate: string;
  endDate: string;
  createdAt: string | null;
  holidayRows: HolidayLookupRow[];
}) {
  const conflict = computeLeaveHolidayConflict(startDate, endDate, createdAt, holidayRows);
  if (!conflict) return null;
  const { alreadyDeducted, notDeducted } = conflict;
  return (
    <>
      {notDeducted.length > 0 ? (
        <span className="ml-2 inline-flex items-center rounded-full border border-amber-700/30 bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
          ⚠️ 與「{notDeducted.map((h) => h.name).join("、")}」重疊（尚未扣除 {notDeducted.length} 日）
        </span>
      ) : null}
      {alreadyDeducted.length > 0 ? (
        <span className="ml-2 inline-flex items-center rounded-full border border-sky-700/25 bg-sky-100/80 px-2 py-0.5 text-[11px] font-medium text-sky-950 dark:border-sky-500/25 dark:bg-sky-950/35 dark:text-sky-100">
          ℹ️ 已扣除臨時假日「{alreadyDeducted.map((h) => h.name).join("、")}」{alreadyDeducted.length} 日
        </span>
      ) : null}
    </>
  );
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
  // total_days 舊欄位曾為 numeric(4,1)（0.125 天會被進位成 0.1），優先以 hours_count 反推
  const hoursRaw = r.hours_count;
  const hours = hoursRaw != null && hoursRaw !== "" ? Number(hoursRaw) : NaN;
  const days =
    Number.isFinite(hours) && hours > 0
      ? hours / LEAVE_WORK_DAY_HOURS
      : num(r.total_days ?? r.days_count ?? r.days, 0);
  const lt = String(r.leave_type ?? r.type_label ?? r.type ?? "假別").trim() || "假別";
  const created =
    r.created_at != null
      ? String(r.created_at)
      : r.inserted_at != null
        ? String(r.inserted_at)
        : null;
  const updated = r.updated_at != null ? String(r.updated_at) : null;
  return {
    id,
    employee_id: eid,
    employee_name: joined ?? (eid ? nameById.get(eid) ?? "—" : "—"),
    leave_type_label: lt,
    start_date: start || "—",
    end_date: end || "—",
    days,
    created_at: created,
    updated_at: updated,
    status_raw: String(r.status ?? ""),
    reason: r.reason != null && String(r.reason).trim() ? String(r.reason) : null,
    attachment_url:
      r.attachment_url != null && String(r.attachment_url).trim()
        ? String(r.attachment_url)
        : null,
  };
}

/** 假別規則（description 給員工看的說明＋approval_notes 審核須知），供審核者展開查閱 */
function LeaveTypeRulePanel({ lt }: { lt: LeaveTypeRow | undefined }) {
  if (!lt || (!lt.description && !lt.approval_notes)) return null;
  return (
    <details className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium text-foreground">
        假別規則與審核須知（{lt.name}）
      </summary>
      {lt.description ? (
        <p className="mt-2 leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">規則說明：</span>
          {lt.description}
        </p>
      ) : null}
      {lt.approval_notes ? (
        <p className="mt-2 leading-relaxed text-amber-950 dark:text-amber-100">
          <span className="font-medium">審核須知：</span>
          {lt.approval_notes}
        </p>
      ) : null}
    </details>
  );
}

/** 特休以「X 天 Y 小時」顯示（total_days 為小數日）；其他假別維持「X 天」 */
function formatLeaveDaysForType(typeLabel: string, days: number): string {
  if (typeLabel.trim().startsWith("特休")) {
    return formatDayDecimalAsDayHour(days);
  }
  return `${days.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 天`;
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

/** 每行前面的類型標示：請假／加班／補卡 */
function kindBadge(kind: "leave" | "overtime" | "makeup") {
  if (kind === "leave") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-700/25 bg-emerald-100/80 px-2 py-0.5 text-[11px] font-medium text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-100">
        請假
      </span>
    );
  }
  if (kind === "makeup") {
    return (
      <span className="inline-flex items-center rounded-full border border-teal-700/25 bg-teal-100/90 px-2 py-0.5 text-[11px] font-medium text-teal-950 dark:border-teal-500/30 dark:bg-teal-950/40 dark:text-teal-100">
        補卡
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-violet-700/25 bg-violet-100/90 px-2 py-0.5 text-[11px] font-medium text-violet-950 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-100">
      加班
    </span>
  );
}

/** 補卡側顯示：08:50 ／ —（不補這側） */
function makeupSideLabel(v: string | null): string {
  return v ?? "—";
}

function overtimeCompBadge(type: OvertimeRequestAdminRow["compensation_type"]) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        type === "pay"
          ? "border-amber-700/25 bg-amber-100/90 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-sky-700/20 bg-sky-100/90 text-sky-950 dark:border-sky-500/25 dark:bg-sky-950/35 dark:text-sky-100",
      )}
    >
      折抵{OVERTIME_COMPENSATION_LABELS[type]}
    </span>
  );
}

function fmtOvertimeHours(n: number): string {
  return `${n.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 小時`;
}

type TabKey = "pending" | "history";
type MainSection =
  | "attendance"
  | "leave"
  | "assignments"
  | "payroll"
  | "paid_history"
  | "bonus"
  | "employees"
  | "telegram";

type HeaderIcon =
  | typeof Clock
  | typeof CalendarDays
  | typeof ClipboardList
  | typeof Banknote
  | typeof Receipt
  | typeof Award
  | typeof Users
  | typeof ListChecks
  | typeof Send;

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
  const [holidayRows, setHolidayRows] = useState<HolidayLookupRow[]>([]);
  /** 假別主檔（含停用），供顯示規則說明與審核須知 */
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([]);
  /** 加班申報（overtime_requests）：與假單同一區塊混列審核 */
  const [otRows, setOtRows] = useState<OvertimeRequestAdminRow[]>([]);
  /** 補打卡申請（makeup_punch_requests）：與假單／加班同一區塊混列審核 */
  const [mkRows, setMkRows] = useState<MakeupPunchRequestAdminRow[]>([]);
  /** 待審補卡的當日線上打卡佐證（attendance_logs；key = employee_id\t日期） */
  const [mkEvidence, setMkEvidence] = useState<
    Map<string, { check_type: string; distance_meters: number; source: string; created_at: string }[]>
  >(new Map());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchAllLeaveTypes();
        if (!cancelled) setLeaveTypes(list);
      } catch (e) {
        console.warn("[leave-approvals] leave_types 載入失敗", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const leaveTypeByName = useMemo(() => {
    const m = new Map<string, LeaveTypeRow>();
    for (const lt of leaveTypes) m.set(lt.name, lt);
    return m;
  }, [leaveTypes]);

  /** 本年度已核准天數：員工 → （假別名稱 → 天數）；由已載入的全部假單彙總 */
  const yearlyUsageByEmployee = useMemo(() => {
    const yearPrefix = `${new Date().getFullYear()}-`;
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (normalizeStatus(r.status_raw) !== "approved") continue;
      if (!r.start_date.startsWith(yearPrefix)) continue;
      let inner = m.get(r.employee_id);
      if (!inner) {
        inner = new Map();
        m.set(r.employee_id, inner);
      }
      inner.set(
        r.leave_type_label,
        (inner.get(r.leave_type_label) ?? 0) + r.days,
      );
    }
    return m;
  }, [rows]);

  async function openAttachment(path: string) {
    const res = await getLeaveAttachmentSignedUrl(path);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    window.open(res.url, "_blank", "noopener");
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("public_holidays")
        .select("holiday_date, name, is_workday, created_at")
        .order("holiday_date", { ascending: true });
      const list: HolidayLookupRow[] = [];
      for (const r of (data ?? []) as {
        holiday_date?: string;
        name?: string | null;
        is_workday?: boolean | null;
        created_at?: string | null;
      }[]) {
        if (r.is_workday === true) continue;
        if (!r.holiday_date) continue;
        list.push({
          date: String(r.holiday_date).slice(0, 10),
          name: (r.name ?? "").trim() || "臨時假日",
          // 缺少建立時間時保守視為「剛新增」，避免誤判成已扣除而漏掉警示
          createdAt: r.created_at ?? new Date().toISOString(),
        });
      }
      setHolidayRows(list);
    })();
  }, []);

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
      /** 基礎表僅保證有 created_at；updated_at 需 migration 20250330140000_leave_requests_updated_at.sql */
      const withJoinBase = `
        id,
        employee_id,
        leave_type,
        start_date,
        end_date,
        status,
        total_days,
        hours_count,
        created_at,
        employees ( name )
      `;
      const withJoinUpdated = `
        id,
        employee_id,
        leave_type,
        start_date,
        end_date,
        status,
        total_days,
        hours_count,
        created_at,
        updated_at,
        reason,
        attachment_url,
        employees ( name )
      `;

      let data: Record<string, unknown>[] | null = null;
      let err: { message: string } | null = null;

      let joined = await supabase
        .from("leave_requests")
        .select(withJoinUpdated)
        .order("created_at", { ascending: false });

      if (joined.error && isLeaveRequestsMissingColumnError(joined.error.message)) {
        joined = (await supabase
          .from("leave_requests")
          .select(withJoinBase)
          .order("created_at", { ascending: false })) as typeof joined;
      }

      if (!joined.error) {
        data = joined.data as Record<string, unknown>[];
      } else {
        let plain = await supabase
          .from("leave_requests")
          .select(
            "id, employee_id, leave_type, start_date, end_date, status, total_days, hours_count, created_at, updated_at, reason, attachment_url",
          )
          .order("created_at", { ascending: false });

        if (plain.error && isLeaveRequestsMissingColumnError(plain.error.message)) {
          plain = (await supabase
            .from("leave_requests")
            .select(
              "id, employee_id, leave_type, start_date, end_date, status, total_days, hours_count, created_at",
            )
            .order("created_at", { ascending: false })) as typeof plain;
        }

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

  const loadOvertime = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const res = await fetchAllOvertimeRequests();
    if (res.ok) setOtRows(res.rows);
    else console.warn("[leave-approvals] overtime_requests:", res.message);
  }, []);

  const loadMakeup = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const res = await fetchAllMakeupPunchRequests();
    if (res.ok) setMkRows(res.rows);
    else console.warn("[leave-approvals] makeup_punch_requests:", res.message);
  }, []);

  useEffect(() => {
    void load();
    void loadOvertime();
    void loadMakeup();
  }, [load, loadOvertime, loadMakeup]);

  /** 待審補卡：撈同日的 LINE／儀表板打卡當佐證 */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const pend = mkRows.filter((r) => r.status === "pending" && r.punch_date);
    if (pend.length === 0) {
      setMkEvidence(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const empIds = [...new Set(pend.map((r) => r.employee_id))];
      const dates = pend.map((r) => r.punch_date).sort();
      const { startIso } = taipeiDayRangeUtc(dates[0]!);
      const { endIso } = taipeiDayRangeUtc(dates[dates.length - 1]!);
      const { data, error: evErr } = await supabase
        .from("attendance_logs")
        .select("employee_id, check_type, distance_meters, source, created_at")
        .in("employee_id", empIds)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (evErr) {
        console.warn("[leave-approvals] attendance_logs:", evErr.message);
        return;
      }
      const map = new Map<
        string,
        { check_type: string; distance_meters: number; source: string; created_at: string }[]
      >();
      for (const raw of (data ?? []) as Record<string, unknown>[]) {
        const created = String(raw.created_at ?? "");
        if (!created) continue;
        const key = `${String(raw.employee_id ?? "")}\t${taipeiYmdOfIso(created)}`;
        const list = map.get(key) ?? [];
        list.push({
          check_type: String(raw.check_type ?? ""),
          distance_meters: Number(raw.distance_meters ?? 0),
          source: String(raw.source ?? ""),
          created_at: created,
        });
        map.set(key, list);
      }
      setMkEvidence(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [mkRows]);

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
      return st === "approved" || st === "rejected" || st === "revoked";
    });
    if (!historyMonth) return list;
    return list.filter((r) =>
      monthOverlap(r.start_date, r.end_date, historyMonth),
    );
  }, [rows, historyMonth]);

  /** 假單、加班與補卡混列（每行前面以類型標示），依申請時間新→舊 */
  type ReviewEntry =
    | { kind: "leave"; row: LeaveRequestAdminRow }
    | { kind: "overtime"; row: OvertimeRequestAdminRow }
    | { kind: "makeup"; row: MakeupPunchRequestAdminRow };

  const pendingCombined = useMemo((): ReviewEntry[] => {
    const entries: ReviewEntry[] = [
      ...pendingList.map((row) => ({ kind: "leave" as const, row })),
      ...otRows
        .filter((r) => r.status === "pending")
        .map((row) => ({ kind: "overtime" as const, row })),
      ...mkRows
        .filter((r) => r.status === "pending")
        .map((row) => ({ kind: "makeup" as const, row })),
    ];
    entries.sort((a, b) =>
      (b.row.created_at ?? "").localeCompare(a.row.created_at ?? ""),
    );
    return entries;
  }, [pendingList, otRows, mkRows]);

  const historyCombined = useMemo((): ReviewEntry[] => {
    const entries: ReviewEntry[] = [
      ...historyList.map((row) => ({ kind: "leave" as const, row })),
      ...otRows
        .filter((r) => r.status !== "pending")
        .filter(
          (r) =>
            !historyMonth ||
            monthOverlap(r.overtime_date, r.overtime_date, historyMonth),
        )
        .map((row) => ({ kind: "overtime" as const, row })),
      ...mkRows
        .filter((r) => r.status !== "pending")
        .filter(
          (r) =>
            !historyMonth ||
            monthOverlap(r.punch_date, r.punch_date, historyMonth),
        )
        .map((row) => ({ kind: "makeup" as const, row })),
    ];
    entries.sort((a, b) =>
      (b.row.created_at ?? "").localeCompare(a.row.created_at ?? ""),
    );
    return entries;
  }, [historyList, otRows, mkRows, historyMonth]);

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

  async function revoke(id: string) {
    if (
      !window.confirm(
        "確定撤銷此已核准假單？撤銷後該假單不會再計入請假天數與薪資結算。\n注意：若該月薪資已結算發放，請另行確認是否需要調整。",
      )
    )
      return;
    setActingId(id);
    try {
      const { error: uErr } = await supabase
        .from("leave_requests")
        .update({ status: "revoked" })
        .eq("id", id);
      if (uErr) {
        toast.error(uErr.message || "更新失敗");
        return;
      }
      toast.success("已撤銷假單");
      await load();
    } finally {
      setActingId(null);
    }
  }

  /** 加班申報核准／退回／撤銷（走 SECURITY DEFINER RPC） */
  async function actOvertime(
    id: string,
    confirmText: string,
    fn: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>,
    successText: string,
  ) {
    if (!window.confirm(confirmText)) return;
    setActingId(id);
    try {
      const res = await fn(id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(successText);
      await loadOvertime();
    } finally {
      setActingId(null);
    }
  }

  /** 補打卡核准／退回／撤銷（走 SECURITY DEFINER RPC；已發薪月份會被拒絕） */
  async function actMakeup(
    id: string,
    confirmText: string,
    fn: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>,
    successText: string,
  ) {
    if (!window.confirm(confirmText)) return;
    setActingId(id);
    try {
      const res = await fn(id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(successText);
      await loadMakeup();
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
            title: "假單/加班審核 · 待審核",
            description: (
              <>
                審核員工請假申請與加班申報（每行前方標示類型）。
                <br />
                特休假核准後，會在該月底發薪時更新特休假天數；加班折抵「補休」核准後即累加補休餘額。
              </>
            ),
            Icon: ClipboardList,
            showLeaveRefresh: true,
          };
        }
        return {
          title: "假單/加班審核 · 歷史紀錄",
          description: "依月份檢視已核准、已退回或已撤銷的假單與加班申報紀錄。",
          Icon: ClipboardList,
          showLeaveRefresh: true,
        };
      case "assignments":
        return {
          title: "公司交辦事項",
          description:
            "彙整全體員工的開會交辦與行事曆交辦及其完成狀態（不含生產交辦）；可依員工與狀態篩選。",
          Icon: ListChecks,
          showLeaveRefresh: false,
        };
      case "payroll":
        return {
          title: "薪資結算中心",
          description:
            "橫向捲動檢視；核准假單依假別 pay_ratio（leave_types）計算扣薪，特休另行結算；加班依員工申報自動統計（加班費＝時數 × 費率 ÷ 8）；發放時同步寫入 payslips 與特休餘額。",
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
      case "bonus":
        return {
          title: "考績獎金分配",
          description:
            "每半年依考績、年資、薪資加權計算分潤獎金；利潤為該半年兩季毛利合計，分潤比例可自訂。",
          Icon: Award,
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
      case "telegram":
        return {
          title: "Telegram Bot",
          description:
            "管理可使用 ERP Telegram bot 的帳號與權限：手動新增 chat_id 或產生邀請碼；管理者可用全功能，員工僅限查詢。",
          Icon: Send,
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
            onClick={() => {
              void load();
              void loadOvertime();
              void loadMakeup();
            }}
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
          假單/加班審核
        </button>
        <button
          type="button"
          onClick={() => setMainSection("assignments")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "assignments"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <ListChecks className="h-4 w-4 shrink-0 opacity-90" />
          公司交辦
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
          onClick={() => setMainSection("bonus")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "bonus"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Award className="h-4 w-4 shrink-0 opacity-90" />
          考績獎金
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
        <button
          type="button"
          onClick={() => setMainSection("telegram")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mainSection === "telegram"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <Send className="h-4 w-4 shrink-0 opacity-90" />
          Telegram Bot
        </button>
      </div>

      {mainSection === "attendance" && (
        <AttendanceManagementTabs
          activeTab={attendanceSubTab}
          onActiveTabChange={setAttendanceSubTab}
        />
      )}

      {mainSection === "assignments" && <CompanyAssignmentsAdmin />}

      {mainSection === "payroll" && <SalarySettlementCenter />}

      {mainSection === "paid_history" && <PayslipPaidHistoryPanel />}

      {mainSection === "bonus" && <PerformanceBonusPage />}

      {mainSection === "employees" && <EmployeesPage />}

      {mainSection === "telegram" && <TelegramBotUsersPage />}

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
              {pendingCombined.length > 0 && (
                <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-xs tabular-nums">
                  {pendingCombined.length}
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
          ) : pendingCombined.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-14 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">目前沒有待審核的假單、加班或補打卡申請</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pendingCombined.map((entry) => {
                if (entry.kind === "overtime") {
                  const ot = entry.row;
                  return (
                    <li
                      key={`ot-${ot.id}`}
                      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-stretch sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {kindBadge("overtime")}
                          <span className="text-base font-bold text-foreground">
                            {ot.employee_name}
                          </span>
                          {overtimeCompBadge(ot.compensation_type)}
                        </div>
                        <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                          <p>
                            <span className="text-xs uppercase tracking-wide">加班時段</span>
                            <br />
                            <span className="font-medium text-foreground">
                              {formatDate(ot.overtime_date)}{" "}
                              <span className="tabular-nums">
                                {ot.start_time}–{ot.end_time}
                              </span>
                            </span>
                          </p>
                          <p>
                            <span className="text-xs uppercase tracking-wide">加班時數</span>
                            <br />
                            <span className="text-lg font-semibold tabular-nums text-primary">
                              {fmtOvertimeHours(ot.hours)}
                            </span>
                          </p>
                          <p className="sm:col-span-2">
                            <span className="text-xs uppercase tracking-wide">申請時間</span>
                            <br />
                            <span className="text-foreground">
                              {formatDateTime(ot.created_at)}
                            </span>
                          </p>
                          {ot.reason ? (
                            <p className="sm:col-span-2">
                              <span className="text-xs uppercase tracking-wide">
                                事由／備註
                              </span>
                              <br />
                              <span className="whitespace-pre-wrap text-foreground">
                                {ot.reason}
                              </span>
                            </p>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ot.compensation_type === "comp_leave"
                            ? "核准後將寫入加班紀錄並累加該員工補休餘額。"
                            : "核准後將寫入加班紀錄；薪資結算時自動以「時數 × 費率 ÷ 8」計入加班費。"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:w-40 sm:justify-center">
                        <Button
                          type="button"
                          className="h-9 w-full bg-emerald-800 text-white hover:bg-emerald-900 dark:bg-emerald-800 dark:hover:bg-emerald-700"
                          disabled={actingId === ot.id}
                          onClick={() =>
                            void actOvertime(
                              ot.id,
                              ot.compensation_type === "comp_leave"
                                ? `確定核准此加班申報？核准後將累加 ${ot.employee_name} 的補休餘額 ${fmtOvertimeHours(ot.hours)}。`
                                : "確定核准此加班申報？（折抵加班費，於薪資結算時計入）",
                              approveOvertimeRequest,
                              "已核准加班申報",
                            )
                          }
                        >
                          ✅ 核准
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 w-full border-red-200 bg-red-50/80 text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
                          disabled={actingId === ot.id}
                          onClick={() =>
                            void actOvertime(
                              ot.id,
                              "確定退回此加班申報？",
                              rejectOvertimeRequest,
                              "已退回加班申報",
                            )
                          }
                        >
                          ❌ 退回
                        </Button>
                      </div>
                    </li>
                  );
                }
                if (entry.kind === "makeup") {
                  const mk = entry.row;
                  return (
                    <li
                      key={`mk-${mk.id}`}
                      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-stretch sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {kindBadge("makeup")}
                          <span className="text-base font-bold text-foreground">
                            {mk.employee_name}
                          </span>
                        </div>
                        <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                          <p>
                            <span className="text-xs uppercase tracking-wide">補打卡日期</span>
                            <br />
                            <span className="font-medium text-foreground">
                              {formatDate(mk.punch_date)}
                            </span>
                          </p>
                          <p>
                            <span className="text-xs uppercase tracking-wide">補登時間</span>
                            <br />
                            <span className="font-medium tabular-nums text-foreground">
                              上班 {makeupSideLabel(mk.clock_in)} ／ 下班{" "}
                              {makeupSideLabel(mk.clock_out)}
                            </span>
                          </p>
                          <p className="sm:col-span-2">
                            <span className="text-xs uppercase tracking-wide">申請時間</span>
                            <br />
                            <span className="text-foreground">
                              {formatDateTime(mk.created_at)}
                            </span>
                          </p>
                          {mk.reason ? (
                            <p className="sm:col-span-2">
                              <span className="text-xs uppercase tracking-wide">
                                事由／備註
                              </span>
                              <br />
                              <span className="whitespace-pre-wrap text-foreground">
                                {mk.reason}
                              </span>
                            </p>
                          ) : null}
                          <p className="sm:col-span-2">
                            <span className="text-xs uppercase tracking-wide">
                              當日線上打卡佐證
                            </span>
                            <br />
                            {(() => {
                              const ev =
                                mkEvidence.get(`${mk.employee_id}\t${mk.punch_date}`) ?? [];
                              if (ev.length === 0) {
                                return (
                                  <span className="text-muted-foreground">
                                    無（LINE／儀表板皆無當日紀錄）
                                  </span>
                                );
                              }
                              return (
                                <span className="tabular-nums text-foreground">
                                  {ev
                                    .map(
                                      (l) =>
                                        `${checkinTypeLabel(l.check_type)} ${taipeiHmOfIso(l.created_at)}（${checkinSourceLabel(l.source)}·距廠區 ${Math.round(l.distance_meters)}m）`,
                                    )
                                    .join("；")}
                                </span>
                              );
                            })()}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          核准後於月底出勤統計自動併入缺卡側；該月出勤已匯入者即時補上並重算標籤。打卡鐘實卡不會被覆蓋。
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:w-40 sm:justify-center">
                        <Button
                          type="button"
                          className="h-9 w-full bg-emerald-800 text-white hover:bg-emerald-900 dark:bg-emerald-800 dark:hover:bg-emerald-700"
                          disabled={actingId === mk.id}
                          onClick={() =>
                            void actMakeup(
                              mk.id,
                              `確定核准 ${mk.employee_name} ${formatDate(mk.punch_date)} 的補打卡？`,
                              approveMakeupPunchRequest,
                              "已核准補打卡",
                            )
                          }
                        >
                          ✅ 核准
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 w-full border-red-200 bg-red-50/80 text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
                          disabled={actingId === mk.id}
                          onClick={() =>
                            void actMakeup(
                              mk.id,
                              "確定退回此補打卡申請？",
                              rejectMakeupPunchRequest,
                              "已退回補打卡申請",
                            )
                          }
                        >
                          ❌ 退回
                        </Button>
                      </div>
                    </li>
                  );
                }
                const row = entry.row;
                return (
                <li
                  key={row.id}
                  className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-stretch sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {kindBadge("leave")}
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
                        <HolidayConflictNote
                          startDate={row.start_date}
                          endDate={row.end_date}
                          createdAt={row.created_at}
                          holidayRows={holidayRows}
                        />
                      </p>
                      <p>
                        <span className="text-xs uppercase tracking-wide">
                          請假天數
                        </span>
                        <br />
                        <span className="text-lg font-semibold tabular-nums text-primary">
                          {formatLeaveDaysForType(row.leave_type_label, row.days)}
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
                      {leaveRequestRowWasUpdated({
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                      }) ? (
                        <p className="sm:col-span-2">
                          <span className="text-xs uppercase tracking-wide">
                            最後異動
                          </span>
                          <br />
                          <span className="text-foreground">
                            {formatLeaveUpdatedAtDisplay(row.updated_at)}
                          </span>
                        </p>
                      ) : null}
                      {row.reason ? (
                        <p className="sm:col-span-2">
                          <span className="text-xs uppercase tracking-wide">
                            事由／備註
                          </span>
                          <br />
                          <span className="whitespace-pre-wrap text-foreground">
                            {row.reason}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    {(() => {
                      const usage = (yearlyUsageByEmployee.get(row.employee_id) ??
                        new Map()) as YearlyLeaveUsageMap;
                      const label = row.leave_type_label.trim();
                      const fmt = (n: number) =>
                        n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
                      if (label === "病假" || label === "生理假") {
                        const counted = sickCountedDays(usage);
                        return (
                          <p className="text-xs text-muted-foreground">
                            今年已核准病假（含生理假逾 3 日部分）：
                            <span className="tabular-nums font-medium text-foreground">
                              {fmt(counted)} 日
                            </span>
                            {counted > SICK_ANNUAL_LIMIT_DAYS ? (
                              <span className="ml-2 inline-flex items-center rounded-full border border-red-700/30 bg-red-100/90 px-2 py-0.5 text-[11px] font-medium text-red-950 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-100">
                                已超過 {SICK_ANNUAL_LIMIT_DAYS} 日半薪上限
                              </span>
                            ) : counted > SICK_PROTECTION_LINE_DAYS ? (
                              <span className="ml-2 inline-flex items-center rounded-full border border-amber-700/30 bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
                                已超過 {SICK_PROTECTION_LINE_DAYS} 日（超出不利處分保護線）
                              </span>
                            ) : (
                              <span className="ml-2 text-[11px]">
                                （10 日內受不利處分保護；{SICK_ANNUAL_LIMIT_DAYS} 日內半薪）
                              </span>
                            )}
                          </p>
                        );
                      }
                      const used = usage.get(label) ?? 0;
                      if (used <= 0) return null;
                      return (
                        <p className="text-xs text-muted-foreground">
                          今年已核准{label}：
                          <span className="tabular-nums font-medium text-foreground">
                            {fmt(used)} 日
                          </span>
                        </p>
                      );
                    })()}
                    <LeaveTypeRulePanel lt={leaveTypeByName.get(row.leave_type_label.trim())} />
                    {row.attachment_url ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 gap-1.5 px-3 text-xs"
                        onClick={() => void openAttachment(row.attachment_url!)}
                      >
                        📎 檢視附件
                      </Button>
                    ) : null}
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
                );
              })}
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
              選「全部」列出所有已審核假單、加班與補打卡申請；選月份則僅顯示與該月重疊者
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            {loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                載入中…
              </p>
            ) : historyCombined.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {historyMonth
                  ? "此月份尚無已核准、已退回或已撤銷的紀錄。"
                  : "尚無已核准、已退回或已撤銷的假單、加班或補打卡紀錄。"}
              </p>
            ) : (
              <Table className="min-w-[48rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
                    <TableHead className="text-xs font-semibold">類型</TableHead>
                    <TableHead className="text-xs font-semibold">員工</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      假別／折抵
                    </TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      區間
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold whitespace-nowrap">
                      天數／時數
                    </TableHead>
                    <TableHead className="text-xs font-semibold">狀態</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      申請時間
                    </TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      最後異動
                    </TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyCombined.map((entry) => {
                    if (entry.kind === "overtime") {
                      const ot = entry.row;
                      return (
                        <TableRow
                          key={`ot-${ot.id}`}
                          className="border-b border-border hover:bg-muted/25"
                        >
                          <TableCell>{kindBadge("overtime")}</TableCell>
                          <TableCell className="font-medium text-foreground">
                            {ot.employee_name}
                          </TableCell>
                          <TableCell>{overtimeCompBadge(ot.compensation_type)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(ot.overtime_date)}{" "}
                            <span className="tabular-nums">
                              {ot.start_time ? `${ot.start_time}–${ot.end_time}` : ""}
                            </span>
                            {ot.source === "record" ? (
                              <span className="ml-1 text-[11px] text-muted-foreground">
                                （管理端補登）
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium whitespace-nowrap">
                            {fmtOvertimeHours(ot.hours)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ot.status === "approved" ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                已核准
                              </span>
                            ) : ot.status === "revoked" ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                已撤銷
                              </span>
                            ) : (
                              <span className="text-red-700 dark:text-red-400">
                                已退回
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(ot.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(ot.approved_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {ot.status === "approved" &&
                            (ot.source === "request" ||
                              ot.compensation_type === "comp_leave") ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 border-amber-300 bg-amber-50/80 px-2 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
                                disabled={actingId === ot.id}
                                onClick={() =>
                                  void actOvertime(
                                    ot.id,
                                    ot.compensation_type === "comp_leave"
                                      ? `確定撤銷此已核准加班？將刪除對應加班紀錄並立即扣回補休 ${fmtOvertimeHours(ot.hours)}（若補休已被請掉，餘額可能為負，需人工處理）。`
                                      : "確定撤銷此已核准加班？將刪除對應加班紀錄。\n注意：若該月薪資已結算發放，請另行確認是否需要調整。",
                                    ot.source === "record"
                                      ? revokeOvertimeRecord
                                      : revokeOvertimeRequest,
                                    "已撤銷加班紀錄",
                                  )
                                }
                              >
                                撤銷
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (entry.kind === "makeup") {
                      const mk = entry.row;
                      return (
                        <TableRow
                          key={`mk-${mk.id}`}
                          className="border-b border-border hover:bg-muted/25"
                        >
                          <TableCell>{kindBadge("makeup")}</TableCell>
                          <TableCell className="font-medium text-foreground">
                            {mk.employee_name}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-full border border-teal-700/25 bg-teal-100/90 px-2.5 py-0.5 text-xs font-medium text-teal-950 dark:border-teal-500/30 dark:bg-teal-950/40 dark:text-teal-100">
                              補打卡
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(mk.punch_date)}{" "}
                            <span className="tabular-nums">
                              上班 {makeupSideLabel(mk.clock_in)} ／ 下班{" "}
                              {makeupSideLabel(mk.clock_out)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium whitespace-nowrap">
                            —
                          </TableCell>
                          <TableCell className="text-sm">
                            {mk.status === "approved" ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                已核准
                              </span>
                            ) : mk.status === "revoked" ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                已撤銷
                              </span>
                            ) : (
                              <span className="text-red-700 dark:text-red-400">
                                已退回
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(mk.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(mk.approved_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {mk.status === "approved" ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 border-amber-300 bg-amber-50/80 px-2 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
                                disabled={actingId === mk.id}
                                onClick={() =>
                                  void actMakeup(
                                    mk.id,
                                    "確定撤銷此已核准補打卡？將自出勤紀錄清回補登的時間（打卡鐘實卡不受影響）。已發薪月份無法撤銷。",
                                    revokeMakeupPunchRequest,
                                    "已撤銷補打卡",
                                  )
                                }
                              >
                                撤銷
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const row = entry.row;
                    const st = normalizeStatus(row.status_raw);
                    const showUpdated = leaveRequestRowWasUpdated({
                      created_at: row.created_at,
                      updated_at: row.updated_at,
                    });
                    return (
                      <TableRow
                        key={row.id}
                        className="border-b border-border hover:bg-muted/25"
                      >
                        <TableCell>{kindBadge("leave")}</TableCell>
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
                          <HolidayConflictNote
                            startDate={row.start_date}
                            endDate={row.end_date}
                            createdAt={row.created_at}
                            holidayRows={holidayRows}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium whitespace-nowrap">
                          {formatLeaveDaysForType(row.leave_type_label, row.days)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {st === "approved" ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              已核准
                            </span>
                          ) : st === "revoked" ? (
                            <span className="text-amber-700 dark:text-amber-400">
                              已撤銷
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
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {showUpdated ? formatLeaveUpdatedAtDisplay(row.updated_at) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          <span className="inline-flex items-center gap-1.5">
                            {row.attachment_url ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => void openAttachment(row.attachment_url!)}
                              >
                                📎 附件
                              </Button>
                            ) : null}
                            {st === "approved" ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 border-amber-300 bg-amber-50/80 px-2 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
                                disabled={actingId === row.id}
                                onClick={() => void revoke(row.id)}
                              >
                                撤銷
                              </Button>
                            ) : row.attachment_url ? null : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
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
