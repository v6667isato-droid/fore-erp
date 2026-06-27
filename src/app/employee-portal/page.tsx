"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  activeAnnouncements,
  fetchEmployeePortalData,
  workProgressStatusLabels,
  type AnnouncementRow,
  type EmployeePortalPayload,
  type LeaveRequestRow,
  type PayslipDetailBreakdown,
  type PayslipRow,
  type PayslipStatus,
  type WorkProgressSeedRow,
  type WorkProgressUiStatus,
} from "@/lib/employee-portal-mock";
import { insertEmployeeLeaveRequest } from "@/lib/employee-leave-requests";
import {
  computeLeaveHolidayConflict,
  type HolidayLookupRow,
} from "@/lib/leave-holiday-conflict";
import {
  LEAVE_LUNCH_END_HOUR,
  LEAVE_LUNCH_START_HOUR,
  LEAVE_WORK_DAY_HOURS,
  LEAVE_WORKDAY_END_HOUR,
  LEAVE_WORKDAY_START_HOUR,
  buildLeaveHolidayLookup,
  computeSpecialLeaveNetHoursFromRange,
  deriveLegacyHourFieldsForDb,
  formatDayDecimalAsDayHour,
  formatHoursAsDayHour,
  hoursToDayHourParts,
  parseLocalDateTime,
  splitRemainingDaysToDayHour,
} from "@/lib/employee-leave-time";
import { normalizePublicHolidayRows } from "@/lib/attendance-war-room";
import {
  formatLeaveUpdatedAtDisplay,
  leaveRequestRowWasUpdated,
} from "@/lib/leave-request-updated";
import {
  fetchEmployeePortalFromSupabase,
  updateProductionTaskStatusForAssignee,
  updateWorkOrderStageForAssignee,
} from "@/lib/employee-portal-supabase";
import {
  DEFAULT_WORK_ORDER_STAGE,
  WORK_ORDER_STAGES,
  isWorkOrderStage,
  normalizeWorkOrderStage,
  stageStyleClassName,
  workOrderStageSortIndex,
  type WorkOrderStage,
} from "@/lib/work-order-stages";
import { fetchCompanyAnnouncementsFromEvents } from "@/lib/company-events";
import {
  fetchNormalizedUserProfileRole,
  isAdminOrManagerRole,
  isAdminRole,
} from "@/lib/post-login-redirect";
import {
  getSupabaseSession,
  isAuthSessionMissingError,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";
import { epSection } from "@/lib/employee-portal-section-styles";
import { CompanyAnnouncementsBlock } from "@/components/company-announcements-block";
import { WorkshopWeeklyRotationBlock } from "@/components/workshop-weekly-rotation-block";
import { MeetingAssignmentsBlock } from "@/components/meeting-assignments-block";
import { MeetingMinutesSection } from "@/components/meeting-minutes-section";
import { EmployeePortalMiniCalendar } from "@/components/employee-portal-mini-calendar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateYyMmDd } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  FileText,
  Home,
  Leaf,
  LogOut,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

function leaveStatusBadge(row: LeaveRequestRow) {
  if (row.status === "pending") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 bg-amber-100 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/60 dark:text-amber-100"
      >
        待審核
      </Badge>
    );
  }
  if (row.status === "approved") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 bg-emerald-100 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100"
      >
        已核准
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-500/45 bg-red-100 text-red-900 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-100"
    >
      退回
    </Badge>
  );
}

function formatNtd(n: number) {
  return `NT$ ${n.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

/** 舊資料在事由後附帶的「［結束日時段 …］」不顯示 */
function displayLeaveReason(raw: string | null | undefined): string {
  const s = raw?.trim() ?? "";
  if (!s) return "";
  return s
    .replace(/\s*［結束日時段\s*[\d]+[–\-][\d]+\s*時］/g, "")
    .replace(/\s*［結束日時段[^］]*］/g, "")
    .trim();
}

function payslipStatusBadge(status: PayslipStatus) {
  if (status === "paid") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 bg-emerald-100 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100"
      >
        已發放
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/50 bg-amber-100 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/60 dark:text-amber-100"
    >
      計算中
    </Badge>
  );
}

function formatSlipDays(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  const s =
    Math.abs(rounded - Math.round(rounded)) < 1e-6
      ? String(Math.round(rounded))
      : rounded.toLocaleString("zh-TW", { maximumFractionDigits: 1 });
  return `${s} 天`;
}

function PayslipBreakdownPanel({
  monthLabel,
  periodKey,
  b,
  notes,
  annualLeaveRemaining,
  compact = false,
}: {
  monthLabel: string;
  periodKey: string;
  b: PayslipDetailBreakdown;
  notes: string | null;
  /** employees.annual_leave_remaining（目前剩餘，非該月薪資單歷史快照） */
  annualLeaveRemaining: number | null;
  /** 對話框內：較矮、較緊湊，減少整體高度 */
  compact?: boolean;
}) {
  const hp =
    b.health_insured_persons != null && Number.isFinite(b.health_insured_persons)
      ? String(b.health_insured_persons)
      : "—";
  const slipLabel = cn(
    "w-[56%] min-w-0 align-top text-xs leading-snug text-muted-foreground sm:w-[52%]",
    compact
      ? "py-1.5 pl-3 pr-1.5 sm:py-2 sm:pl-3.5 sm:pr-2 sm:text-[12px]"
      : "py-2.5 pl-4 pr-2 sm:py-3 sm:pl-5 sm:pr-3 sm:text-[13px]",
  );
  const slipVal = cn(
    "pl-2 text-right align-top text-xs font-semibold tabular-nums text-foreground",
    compact
      ? "py-1.5 pr-3 sm:py-2 sm:pr-3.5 sm:text-[12px]"
      : "py-2.5 pr-4 sm:py-3 sm:pr-5 sm:text-[13px]",
  );
  const slipValMoney = cn(slipVal, "text-primary");

  return (
    <div
      className={cn(
        "w-full border-t border-border/70 bg-gradient-to-b from-muted/25 via-muted/15 to-muted/10",
        compact ? "px-3 py-2.5 sm:px-4 sm:py-3" : "px-4 py-4 sm:px-6 sm:py-5",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          compact ? "max-w-2xl" : "max-w-md sm:max-w-lg",
        )}
      >
        <h3
          className={cn(
            "px-1 text-center font-semibold tracking-tight text-foreground sm:px-0",
            compact ? "text-xs sm:text-sm" : "text-sm",
          )}
        >
          {monthLabel}薪資明細
        </h3>
        {periodKey ? (
          <p
            className={cn(
              "px-1 text-center tabular-nums text-muted-foreground sm:px-0",
              compact ? "mt-0.5 text-[10px] sm:text-[11px]" : "mt-1 text-[11px] sm:mt-0.5",
            )}
          >
            結算期間 {periodKey}
          </p>
        ) : null}

        <div
          className={cn(
            "overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm ring-1 ring-border/20",
            compact ? "mt-2 sm:mt-2.5" : "mt-4 sm:mt-5",
          )}
        >
          <table className="w-full table-fixed border-collapse">
            <tbody>
              <tr className="border-b border-border/55 bg-muted/5">
                <td className={slipLabel}>底薪</td>
                <td className={slipValMoney}>{formatNtd(b.base_salary)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>勞保自付額</td>
                <td className={slipVal}>− {formatNtd(b.labor_insurance_employee)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={cn(slipLabel, "whitespace-normal")}>
                  <span className="inline sm:whitespace-nowrap">
                    健保自付額
                    <span className="font-normal text-muted-foreground">（加保人數 {hp} 人）</span>
                  </span>
                </td>
                <td className={slipVal}>− {formatNtd(b.health_insurance_employee)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>加班天數</td>
                <td className={slipVal}>{formatSlipDays(b.overtime_days)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>加班費（獎金／加班）</td>
                <td className={slipVal}>
                  {b.overtime_pay > 0 ? (
                    <>+ {formatNtd(b.overtime_pay)}</>
                  ) : (
                    <span className="font-normal text-muted-foreground">+ {formatNtd(0)}</span>
                  )}
                </td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>病、事假</td>
                <td className={slipVal}>{formatSlipDays(b.leave_days)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>特休請假</td>
                <td className={slipVal}>{formatSlipDays(b.special_leave_days_settled)}</td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={cn(slipLabel, "whitespace-normal")}>
                  <span className="block">特休假剩餘</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                    目前主檔（非該月歷史快照）
                  </span>
                </td>
                <td className={slipVal}>
                  {annualLeaveRemaining != null && Number.isFinite(annualLeaveRemaining) ? (
                    formatDayDecimalAsDayHour(annualLeaveRemaining)
                  ) : (
                    <span className="font-normal text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>其他加減項</td>
                <td className={slipVal}>
                  {b.other_adjust === 0 ? (
                    <span className="font-normal text-muted-foreground">無</span>
                  ) : (
                    <>
                      {b.other_adjust > 0 ? "+ " : "− "}
                      {formatNtd(Math.abs(b.other_adjust))}
                    </>
                  )}
                </td>
              </tr>
              <tr className="border-b border-border/55">
                <td className={slipLabel}>請假扣款（事／病假）</td>
                <td className={slipVal}>
                  {b.leave_deduction > 0 ? (
                    <>− {formatNtd(b.leave_deduction)}</>
                  ) : (
                    <span className="font-normal text-muted-foreground">無（NT$ 0）</span>
                  )}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-primary/[0.09]">
                <td
                  className={cn(
                    "font-semibold text-foreground",
                    compact
                      ? "px-3 py-2 text-[11px] sm:px-3.5 sm:py-2 sm:text-xs"
                      : "px-4 py-3 text-xs sm:px-5 sm:py-3.5 sm:text-sm",
                  )}
                >
                  實發總額
                </td>
                <td
                  className={cn(
                    "text-right font-bold tabular-nums text-primary",
                    compact
                      ? "px-3 py-2 text-sm sm:px-3.5 sm:py-2 sm:text-base"
                      : "px-4 py-3 text-base sm:px-5 sm:py-3.5 sm:text-lg",
                  )}
                >
                  {formatNtd(b.net_pay)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div
          className={cn(
            "rounded-xl border border-border/65 bg-muted/35",
            compact ? "mt-2 px-3 py-2 sm:mt-2.5 sm:px-3.5 sm:py-2" : "mt-4 px-4 py-3 sm:mt-5 sm:px-5 sm:py-3.5",
          )}
        >
          <p
            className={cn(
              "font-semibold uppercase tracking-wide text-muted-foreground",
              compact ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]",
            )}
          >
            出勤備註
          </p>
          {notes && notes.trim() ? (
            <p
              className={cn(
                "whitespace-pre-wrap break-words leading-relaxed text-foreground/95",
                compact
                  ? "mt-1 text-[11px] leading-snug sm:text-xs"
                  : "mt-2 text-xs sm:text-[13px] sm:leading-relaxed",
              )}
            >
              {notes.trim()}
            </p>
          ) : (
            <p
              className={cn(
                "leading-relaxed text-muted-foreground",
                compact ? "mt-1 text-[11px] sm:text-xs" : "mt-2 text-xs",
              )}
            >
              此筆薪資單尚無出勤備註說明。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatMini({
  label,
  children,
  footer,
  className,
}: {
  /** 省略時不顯示頂部小標（例如特休／補休合併卡僅保留內文「特休」「補休」） */
  label?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[5.5rem] min-w-0 w-full flex-col rounded-xl border border-border/80 bg-background/85 px-3 py-3.5 shadow-sm backdrop-blur-sm sm:px-4",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        {label ? (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        ) : null}
        <div
          className={cn(
            "break-words text-base font-semibold tabular-nums tracking-tight text-primary sm:text-lg md:text-xl",
            label ? "mt-1.5" : null,
          )}
        >
          {children}
        </div>
      </div>
      {footer ? (
        <div className="mt-3 shrink-0 border-t border-border/60 pt-2.5">{footer}</div>
      ) : null}
    </div>
  );
}

function workProgressRowTone(status: WorkProgressUiStatus) {
  switch (status) {
    case "done":
      return "bg-muted/50 opacity-[0.88]";
    case "in_progress":
      return "bg-secondary/35";
    default:
      return "bg-card hover:bg-muted/25";
  }
}

const PROGRESS_DEFAULTS: WorkProgressUiStatus[] = [
  "pending",
  "in_progress",
  "in_progress",
  "done",
];

function buildProgressMap(rows: WorkProgressSeedRow[]): Record<string, WorkProgressUiStatus> {
  const next: Record<string, WorkProgressUiStatus> = {};
  rows.forEach((r, i) => {
    next[r.id] = r.initial_ui_status ?? PROGRESS_DEFAULTS[i % PROGRESS_DEFAULTS.length];
  });
  return next;
}

function deductsSalaryForLeaveType(type: string): boolean {
  return type === "事假" || type === "病假";
}

function leaveDurationTableLabel(row: LeaveRequestRow): string {
  if (row.hours_count != null && row.hours_count > 0) {
    const { days, hours } = hoursToDayHourParts(row.hours_count);
    return `${days} 日 ${hours} 小時`;
  }
  return `${row.days_count} 天`;
}

type LeaveFormState = {
  type: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  reason: string;
};

const LEAVE_FORM_INITIAL: LeaveFormState = {
  type: "特休",
  start: "",
  end: "",
  startTime: "09:00",
  endTime: "18:00",
  reason: "",
};

/** 開始日變更時：結束日為空、仍等於「原本的」開始日、或早於新開始日 → 結束日跟進為新開始日（方便單日假）。 */
function applyLeaveStartDateChange(
  prev: LeaveFormState,
  newStart: string,
): LeaveFormState {
  const { start: prevStart, end: prevEnd } = prev;
  const shouldSyncEnd =
    !prevEnd || prevEnd < newStart || prevEnd === prevStart;
  return {
    ...prev,
    start: newStart,
    end: shouldSyncEnd ? newStart : prevEnd,
  };
}

type AssigneeWoSortKey =
  | "order_number"
  | "customer_name"
  | "item_size_label"
  | "category"
  | "stage"
  | "planned_end_date";

function parseDateMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 預計完成欄僅使用 work_orders.planned_end_date（不依訂單交期遞補） */
function compareAssigneeWoPlannedEndDate(
  a: { planned_end_date: string | null },
  b: { planned_end_date: string | null },
  asc: boolean,
): number {
  const na = parseDateMs(a.planned_end_date);
  const nb = parseDateMs(b.planned_end_date);
  if (na === null && nb === null) return 0;
  if (na === null) return 1;
  if (nb === null) return -1;
  const diff = na - nb;
  return asc ? diff : -diff;
}

export default function EmployeePortalPage() {
  const router = useRouter();
  const [data, setData] = useState<EmployeePortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"mock" | "supabase">("mock");
  const [progressById, setProgressById] = useState<Record<string, WorkProgressUiStatus>>({});
  const [savingProductionTaskId, setSavingProductionTaskId] = useState<string | null>(null);
  const [woStageById, setWoStageById] = useState<Record<string, string>>({});
  const [woSortBy, setWoSortBy] = useState<AssigneeWoSortKey>("planned_end_date");
  const [woSortAsc, setWoSortAsc] = useState(true);
  const [savingWorkOrderStageId, setSavingWorkOrderStageId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [payslipModalOpen, setPayslipModalOpen] = useState(false);
  const [expandedPayslipId, setExpandedPayslipId] = useState<string | null>(null);
  const [leaveForm, setLeaveForm] = useState<LeaveFormState>({ ...LEAVE_FORM_INITIAL });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  /** 請假計算：國定／特殊假日（is_workday=false 不計；補班 is_workday=true 計入）；未連線時僅排除週末 */
  const [leaveHolidayLookup, setLeaveHolidayLookup] = useState<
    Map<string, { is_workday: boolean }> | undefined
  >(undefined);
  /** 與管理端假單審核頁同一套邏輯：顯示「已扣除／尚未扣除」臨時假日提示用 */
  const [holidayRows, setHolidayRows] = useState<HolidayLookupRow[]>([]);
  /** Mock 無法辨識角色時保留捷徑；Supabase 僅 admin / manager 可看返回 ERP 連結 */
  const [showErpHomeLink, setShowErpHomeLink] = useState(() => !isSupabaseConfigured);
  /** Supabase 連線時由 user_profiles 填入；Mock 時為空字串 */
  const [portalUserRole, setPortalUserRole] = useState("");
  /** 開會紀錄／交辦狀態變更時遞增，讓子區塊重新載入 */
  const [meetingDataTick, setMeetingDataTick] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setShowErpHomeLink(true);
      setPortalUserRole("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await getSupabaseSession();
      const userId = session?.user?.id;
      if (!userId) {
        if (!cancelled) {
          setShowErpHomeLink(false);
          setPortalUserRole("");
        }
        return;
      }
      const role = await fetchNormalizedUserProfileRole(userId);
      if (!cancelled) {
        setShowErpHomeLink(isAdminOrManagerRole(role));
        setPortalUserRole(role);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Mock 模式顯示技術說明便於開發；連線時僅 admin */
  const showAdminFieldHints = useMemo(
    () => !isSupabaseConfigured || isAdminRole(portalUserRole),
    [portalUserRole]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let payload: EmployeePortalPayload;

      if (!isSupabaseConfigured) {
        payload = await fetchEmployeePortalData();
        setDataSource("mock");
      } else {
        const {
          data: { session },
          error: sessionErr,
        } = await getSupabaseSession();
        if (sessionErr && !isAuthSessionMissingError(sessionErr)) {
          setLoadError(sessionErr.message);
          setData(null);
          return;
        }
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        const result = await fetchEmployeePortalFromSupabase(
          session.user.id,
          session.user.email ?? undefined
        );
        if (!result.ok) {
          setLoadError(result.message);
          setData(null);
          setDataSource("supabase");
          return;
        }
        payload = result.payload;
        setDataSource("supabase");
      }

      let announcements: AnnouncementRow[] = payload.announcements;
      if (isSupabaseConfigured) {
        try {
          const fromDb = await fetchCompanyAnnouncementsFromEvents();
          announcements = fromDb.map((a) => ({
            id: a.id,
            title: a.title,
            body: a.body,
            published_at: a.published_at,
            is_active: true,
          }));
        } catch (e) {
          console.error("[employee-portal] company_event 載入失敗，沿用 payload 內公告列表", e);
        }
      }
      setData({ ...payload, announcements });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLeaveHolidayLookup(undefined);
      return;
    }
    let cancelled = false;
    const y = new Date().getFullYear();
    const from = `${y - 1}-01-01`;
    const to = `${y + 2}-12-31`;
    void (async () => {
      const { data, error } = await supabase
        .from("public_holidays")
        .select("*")
        .gte("holiday_date", from)
        .lte("holiday_date", to);
      if (cancelled) return;
      if (error) {
        console.warn("[employee-portal] public_holidays:", error.message);
        setLeaveHolidayLookup(new Map());
        setHolidayRows([]);
        return;
      }
      const rawRows = (data ?? []) as Record<string, unknown>[];
      const norm = normalizePublicHolidayRows(rawRows);
      setLeaveHolidayLookup(buildLeaveHolidayLookup(norm));
      const holidayList: HolidayLookupRow[] = [];
      for (const r of rawRows) {
        if (r.is_workday === true) continue;
        const d = r.holiday_date;
        if (!d) continue;
        holidayList.push({
          date: String(d).slice(0, 10),
          name: (typeof r.name === "string" ? r.name : "").trim() || "臨時假日",
          createdAt:
            typeof r.created_at === "string" ? r.created_at : new Date().toISOString(),
        });
      }
      setHolidayRows(holidayList);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data?.work_progress_seed?.length) return;
    setProgressById(buildProgressMap(data.work_progress_seed));
  }, [data]);

  useEffect(() => {
    const rows = data?.assignee_work_orders;
    if (!rows?.length) {
      setWoStageById({});
      return;
    }
    const m: Record<string, string> = {};
    for (const w of rows) {
      m[w.id] = normalizeWorkOrderStage(w.stage);
    }
    setWoStageById(m);
  }, [data?.assignee_work_orders]);

  const sortedAssigneeWorkOrders = useMemo(() => {
    const list = [...(data?.assignee_work_orders ?? [])];
    list.sort((a, b) => {
      const key = woSortBy;
      let cmp = 0;
      if (key === "stage") {
        const sa = woStageById[a.id] ?? normalizeWorkOrderStage(a.stage);
        const sb = woStageById[b.id] ?? normalizeWorkOrderStage(b.stage);
        cmp = workOrderStageSortIndex(sa) - workOrderStageSortIndex(sb);
        if (!woSortAsc) cmp = -cmp;
      } else if (key === "planned_end_date") {
        cmp = compareAssigneeWoPlannedEndDate(a, b, woSortAsc);
      } else {
        const av =
          key === "order_number"
            ? a.order_number
            : key === "customer_name"
              ? a.customer_name
              : key === "item_size_label"
                ? a.item_size_label
                : a.category;
        const bv =
          key === "order_number"
            ? b.order_number
            : key === "customer_name"
              ? b.customer_name
              : key === "item_size_label"
                ? b.item_size_label
                : b.category;
        const as = av == null ? "" : String(av);
        const bs = bv == null ? "" : String(bv);
        cmp = as.localeCompare(bs, "zh-Hant", { numeric: true });
        if (!woSortAsc) cmp = -cmp;
      }
      if (cmp !== 0) return cmp;
      return (
        workOrderStageSortIndex(woStageById[a.id] ?? normalizeWorkOrderStage(a.stage)) -
        workOrderStageSortIndex(woStageById[b.id] ?? normalizeWorkOrderStage(b.stage))
      );
    });
    return list;
  }, [data?.assignee_work_orders, woSortBy, woSortAsc, woStageById]);

  const payslipsSorted = useMemo(() => {
    if (!data?.payslips?.length) return [];
    return [...data.payslips].sort((a, b) => b.period_key.localeCompare(a.period_key));
  }, [data]);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    []
  );

  /** 所有假別皆與特休相同：依起迄日＋時間與行事曆計算有效工時 */
  const timedLeaveHourPreview = useMemo(() => {
    if (!leaveForm.start || !leaveForm.end || !leaveForm.startTime || !leaveForm.endTime) return null;
    const a = parseLocalDateTime(leaveForm.start, leaveForm.startTime);
    const b = parseLocalDateTime(leaveForm.end, leaveForm.endTime);
    if (!a || !b || b.getTime() <= a.getTime()) return null;
    const hrs = computeSpecialLeaveNetHoursFromRange(
      leaveForm.start,
      leaveForm.startTime,
      leaveForm.end,
      leaveForm.endTime,
      leaveHolidayLookup,
    );
    if (hrs <= 0) return null;
    return { totalHours: hrs, parts: hoursToDayHourParts(hrs) };
  }, [leaveForm.start, leaveForm.end, leaveForm.startTime, leaveForm.endTime, leaveHolidayLookup]);

  const annualLeaveRemainingParts = useMemo(() => {
    const r = data?.employee.annual_leave_remaining;
    if (r == null || !Number.isFinite(r)) return null;
    return splitRemainingDaysToDayHour(r);
  }, [data?.employee.annual_leave_remaining]);

  /** 補休：無餘額資料、或預覽時數超過剩餘時，不可送出 */
  const compLeaveSubmitBlocked = useMemo(() => {
    if (leaveForm.type !== "補休") return false;
    const rem = data?.employee.comp_leave_remaining;
    if (rem == null || !Number.isFinite(rem)) return true;
    if (!timedLeaveHourPreview) return false;
    return timedLeaveHourPreview.totalHours > rem;
  }, [leaveForm.type, data?.employee.comp_leave_remaining, timedLeaveHourPreview]);

  async function submitLeaveRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!data || leaveSubmitting) return;

    const deducts = deductsSalaryForLeaveType(leaveForm.type);

    if (!leaveForm.start || !leaveForm.end) {
      toast.error("請選擇請假起始日與結束日");
      return;
    }
    if (!leaveForm.startTime.trim() || !leaveForm.endTime.trim()) {
      toast.error("請填寫起始與結束時間");
      return;
    }
    const dtStart = parseLocalDateTime(leaveForm.start, leaveForm.startTime);
    const dtEnd = parseLocalDateTime(leaveForm.end, leaveForm.endTime);
    if (!dtStart || !dtEnd) {
      toast.error("時間格式須為 HH:MM（24 小時制）");
      return;
    }
    if (dtEnd.getTime() <= dtStart.getTime()) {
      toast.error("結束須晚於起始（同日時結束時間須晚於起始時間）");
      return;
    }
    const hrs = computeSpecialLeaveNetHoursFromRange(
      leaveForm.start,
      leaveForm.startTime,
      leaveForm.end,
      leaveForm.endTime,
      leaveHolidayLookup,
    );
    if (hrs <= 0) {
      toast.error(
        "有效請假時數為 0。可能原因：與 9:00–18:00 無重疊、區間內皆為週六日或國定放假，或午休扣除後無剩餘時數。",
      );
      return;
    }
    const { firstStartHour: s1, firstEndHour: e1, lastStartHour: s2, lastEndHour: e2 } =
      deriveLegacyHourFieldsForDb(dtStart, dtEnd);
    const sameDay = s2 == null;
    const daysEq = hrs / LEAVE_WORK_DAY_HOURS;

    if (leaveForm.type === "特休") {
      const rem = data.employee.annual_leave_remaining;
      if (rem != null && Number.isFinite(rem)) {
        const remH = rem * LEAVE_WORK_DAY_HOURS;
        if (hrs > remH) {
          toast.warning("申請時數超過目前剩餘特休換算時數，仍會送出供主管審核。");
        }
      }
    }

    if (leaveForm.type === "補休") {
      const remH = data.employee.comp_leave_remaining;
      if (remH == null || !Number.isFinite(remH)) {
        toast.error("無法確認補休剩餘（employees.comp_leave_remaining）。請洽人資維護。");
        return;
      }
      if (hrs > remH) {
        toast.error(
          `申請時數不可超過剩餘補休。目前剩餘 ${formatHoursAsDayHour(remH)}（${remH.toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 小時），本次有效時數為 ${hrs.toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 小時。`,
        );
        return;
      }
    }

    const newRow: LeaveRequestRow = {
      id: `local-${Date.now()}`,
      type_label: leaveForm.type,
      start_date: leaveForm.start,
      end_date: leaveForm.end,
      status: "pending",
      deducts_salary: deducts,
      days_count: daysEq,
      start_hour: s1,
      end_hour: e1,
      end_day_start_hour: sameDay ? null : s2,
      end_day_end_hour: sameDay ? null : e2,
      hours_count: hrs,
      reason: leaveForm.reason.trim() || null,
    };

    if (!isSupabaseConfigured) {
      setData((prev) =>
        prev ? { ...prev, leave_requests: [newRow, ...prev.leave_requests] } : prev
      );
      toast.success("假單已建立（Mock，未寫入資料庫）");
      setLeaveOpen(false);
      setLeaveForm({ ...LEAVE_FORM_INITIAL });
      return;
    }

    const {
      data: { session },
    } = await getSupabaseSession();
    const uid = session?.user?.id;
    if (!uid) {
      toast.error("請先登入");
      router.replace("/login");
      return;
    }

    setLeaveSubmitting(true);
    const ins = await insertEmployeeLeaveRequest({
      employeeId: data.employee.id,
      leaveType: leaveForm.type,
      startDate: leaveForm.start,
      endDate: leaveForm.end,
      startHour: s1,
      endHour: e1,
      startDayStartHour: s1,
      startDayEndHour: e1,
      endDayStartHour: s2,
      endDayEndHour: e2,
      hoursCount: hrs,
      daysCount: daysEq,
      reason: leaveForm.reason.trim() || null,
    });
    setLeaveSubmitting(false);
    if (!ins.ok) {
      toast.error(ins.message);
      return;
    }
    toast.success("假單已送出，狀態為待審核");
    setLeaveOpen(false);
    setLeaveForm({ ...LEAVE_FORM_INITIAL });
    await load();
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      if (!isAuthSessionMissingError(e)) console.error("[employee-portal] signOut:", e);
    }
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 bg-background px-4">
        <p className="text-sm text-muted-foreground tracking-wide">載入個人儀表板…</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {showErpHomeLink ? (
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline" }), "gap-2 text-muted-foreground")}
            >
              <Home className="h-4 w-4" />
              返回 ERP 主頁（暫用）
            </Link>
          ) : null}
          {isSupabaseConfigured ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-muted-foreground"
              onClick={() => void handleLogout()}
            >
              <LogOut className="h-4 w-4" />
              登出
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 bg-background px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-destructive">無法載入儀表板</p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{loadError ?? "未知錯誤"}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className={cn(buttonVariants({ variant: "outline" }), "text-muted-foreground")}
          >
            重新載入
          </button>
          <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
            返回登入
          </Link>
          {isSupabaseConfigured ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-muted-foreground"
              onClick={() => void handleLogout()}
            >
              <LogOut className="h-4 w-4" />
              登出
            </Button>
          ) : null}
          {showErpHomeLink ? (
            <Link href="/" className={cn(buttonVariants({ variant: "ghost" }), "gap-2 text-muted-foreground")}>
              <Home className="h-4 w-4" />
              ERP 首頁
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const { employee, stats, leave_requests, work_progress_seed, assignee_work_orders } = data;

  function toggleWoSort(key: AssigneeWoSortKey) {
    if (woSortBy === key) {
      setWoSortAsc((p) => !p);
    } else {
      setWoSortBy(key);
      setWoSortAsc(true);
    }
  }

  function WoSortHeader({ label, sortKey }: { label: string; sortKey: AssigneeWoSortKey }) {
    const active = woSortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleWoSort(sortKey)}
        className="inline-flex items-center gap-1 p-1.5 text-xs font-semibold align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
        aria-label={`依${label}排序${active ? (woSortAsc ? "升冪" : "降冪") : ""}`}
      >
        {label}
        {active ? (
          woSortAsc ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "min-h-dvh text-foreground",
        "bg-background",
        "bg-[radial-gradient(ellipse_120%_80%_at_100%_-20%,rgba(196,168,130,0.14),transparent_50%)]",
        "dark:bg-[radial-gradient(ellipse_120%_80%_at_100%_-20%,rgba(196,168,130,0.1),transparent_50%)]"
      )}
    >
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between lg:mb-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Føre Furniture
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              員工個人儀表板
            </h1>
          </div>
          <div className="flex shrink-0 flex-col gap-2 self-start sm:flex-row sm:items-center sm:self-auto">
            {showErpHomeLink ? (
              <Link
                href="/"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "gap-2 text-muted-foreground hover:text-foreground"
                )}
              >
                <Home className="h-4 w-4" />
                返回 ERP 主頁（暫用）
              </Link>
            ) : null}
            {isSupabaseConfigured ? (
              <Button
                type="button"
                variant="outline"
                className="gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4" />
                登出
              </Button>
            ) : null}
          </div>
        </header>

        <div className="flex flex-col gap-8 lg:gap-10">
          {/* 今日工作台 */}
          <section
            className={cn(
              "relative overflow-hidden rounded-2xl border border-border/90",
              "bg-gradient-to-br from-card via-card to-secondary/35",
              "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_12px_40px_-12px_rgba(44,36,24,0.1)]",
              "dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_12px_40px_-12px_rgba(0,0,0,0.4)]",
              "p-6 sm:p-8 lg:p-10"
            )}
          >
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/15 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-start lg:gap-10 xl:gap-12">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 lg:basis-0 lg:flex-[1]">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  今日工作台
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  歡迎回來，{employee.full_name}
                </h2>
                <p className="text-sm tabular-nums text-muted-foreground">{todayLabel}</p>
              </div>
              <div className="grid w-full shrink-0 grid-cols-2 gap-3 lg:min-w-0 lg:grid-cols-4 lg:basis-0 lg:flex-[3]">
                <StatMini
                  label="本月薪資"
                  footer={
                    <button
                      type="button"
                      onClick={() => setPayslipModalOpen(true)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] font-medium text-muted-foreground",
                        "transition-colors hover:bg-secondary/55 hover:text-foreground",
                        "focus:outline-none focus:ring-2 focus:ring-ring/50"
                      )}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      查詢薪資單
                    </button>
                  }
                >
                  NT${" "}
                  {stats.monthly_salary_ntd.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                </StatMini>
                <StatMini className="min-h-[7rem] sm:min-h-[7.5rem]">
                  <div className="flex flex-col gap-2.5 text-left font-normal">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        特休
                      </p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-primary sm:text-lg md:text-xl">
                        {formatDayDecimalAsDayHour(employee.annual_leave_remaining)}
                      </p>
                    </div>
                    <div className="min-w-0 border-t border-border/50 pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        補休
                      </p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-primary sm:text-lg md:text-xl">
                        {formatHoursAsDayHour(employee.comp_leave_remaining)}
                      </p>
                    </div>
                  </div>
                </StatMini>
                <StatMini label="本月加班天數">{stats.monthly_overtime_days} 天</StatMini>
                <StatMini label="本月請假天數">{stats.monthly_leave_days} 天</StatMini>
              </div>
            </div>
          </section>

          <EmployeePortalMiniCalendar
            employeeId={employee.id}
            showSubtitleHints={showAdminFieldHints}
          />

          {/* 公司公告（左）＋ 週五工坊輪替（右，lg 並排） */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <CompanyAnnouncementsBlock
              items={activeAnnouncements(data.announcements).map((a) => ({
                id: a.id,
                title: a.title,
                body: a.body,
                published_at: a.published_at,
              }))}
              subtitle={
                showAdminFieldHints
                  ? isSupabaseConfigured
                    ? "company_event · 類別為「公司」"
                    : "Mock 資料 · 設定 Supabase 後改讀資料庫"
                  : undefined
              }
            />
            <WorkshopWeeklyRotationBlock
              refreshTick={meetingDataTick}
              showSubtitleLine={showAdminFieldHints}
              subtitle={
                showAdminFieldHints
                  ? isSupabaseConfigured
                    ? "employees.meeting_minutes · 依開會日期最新一筆"
                    : undefined
                  : undefined
              }
            />
          </div>

          <MeetingMinutesSection
            currentEmployeeId={employee.id}
            currentEmployeeName={employee.full_name}
            onRefreshParent={load}
            refreshTick={meetingDataTick}
            onMeetingSaved={() => setMeetingDataTick((t) => t + 1)}
            canManageMeetingMinutes={showErpHomeLink}
            canDeleteMeetingMinutes={!isSupabaseConfigured ? showErpHomeLink : isAdminRole(portalUserRole)}
            showAdminHints={showAdminFieldHints}
          />

          {/* 我的交辦 */}
          <section className={epSection.card}>
            <div className={epSection.headerRow}>
              <div className={epSection.iconBox}>
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <h3 className={epSection.title}>我的交辦事項</h3>
                {showAdminFieldHints ? (
                  <p className={cn("mt-0.5", epSection.subtitle)}>
                    {dataSource === "supabase"
                      ? "交辦事項（開會 · 行事曆） · 生產交辦（work_orders · production_tasks）"
                      : "Mock · meeting_assignments · company_event_assignees · work_orders · work_progress_seed"}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  交辦事項
                </p>
                <div className="max-h-80 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
                  <MeetingAssignmentsBlock
                    employeeId={employee.id}
                    meetingDataTick={meetingDataTick}
                    onStatusChanged={() => setMeetingDataTick((t) => t + 1)}
                  />
                </div>
              </div>
              <div className="border-t border-border/60 pt-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  生產交辦
                </p>
                {showAdminFieldHints ? (
                  <p className="mb-3 text-xs text-muted-foreground">
                    {dataSource === "supabase"
                      ? "上方：work_orders（assignee_id），可改工序站別；下方：production_tasks。"
                      : "Mock 種子；工序變更僅存在此頁（未連線）。"}
                  </p>
                ) : null}
                <div className="max-h-[min(70vh,28rem)] overflow-y-auto overflow-x-auto pr-1 [scrollbar-gutter:stable]">
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        負責工單（work_orders）
                      </p>
                      {assignee_work_orders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">目前沒有以您為負責人的工單。</p>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card/40">
                          <Table className="min-w-[44rem]">
                            <TableHeader>
                              <TableRow className="hover:bg-transparent border-border/60">
                                <TableHead className="text-xs font-semibold whitespace-nowrap min-w-[7rem]">
                                  <WoSortHeader label="訂單編號" sortKey="order_number" />
                                </TableHead>
                                <TableHead className="text-xs font-semibold min-w-[8rem]">
                                  <WoSortHeader label="客戶 / 專案" sortKey="customer_name" />
                                </TableHead>
                                <TableHead className="text-xs font-semibold min-w-[10rem]">
                                  <WoSortHeader label="品項 / 尺寸" sortKey="item_size_label" />
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-right whitespace-nowrap w-[3.5rem]">
                                  數量
                                </TableHead>
                                <TableHead className="text-xs font-semibold whitespace-nowrap min-w-[3.5rem]">
                                  <WoSortHeader label="類別" sortKey="category" />
                                </TableHead>
                                <TableHead className="text-xs font-semibold whitespace-nowrap min-w-[7rem]">
                                  <WoSortHeader label="工序站別" sortKey="stage" />
                                </TableHead>
                                <TableHead className="text-xs font-semibold min-w-[5rem]">
                                  <WoSortHeader label="預計完成" sortKey="planned_end_date" />
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sortedAssigneeWorkOrders.map((wo) => {
                                const stageVal =
                                  woStageById[wo.id] ?? normalizeWorkOrderStage(wo.stage);
                                const safeStage = isWorkOrderStage(stageVal)
                                  ? stageVal
                                  : DEFAULT_WORK_ORDER_STAGE;
                                return (
                                  <TableRow key={wo.id} className="border-border/60">
                                    <TableCell className="p-2 align-middle font-mono text-xs font-medium whitespace-nowrap">
                                      {wo.order_number ? wo.order_number.replace(/^ORD-/i, "") : "—"}
                                    </TableCell>
                                    <TableCell className="p-2 align-middle text-sm">
                                      <div className="min-w-0 leading-snug">
                                        <span className="font-medium text-foreground">
                                          {wo.customer_name || "—"}
                                        </span>
                                        {wo.shipping_contact_name?.trim() ? (
                                          <span className="ml-1.5 text-xs text-muted-foreground">
                                            {wo.shipping_contact_name.trim()}
                                          </span>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell className="p-2 align-middle text-sm max-w-[14rem]">
                                      <span className="line-clamp-2">{wo.item_size_label || "—"}</span>
                                    </TableCell>
                                    <TableCell className="p-2 align-middle text-sm text-right tabular-nums">
                                      {Number.isFinite(wo.quantity) && wo.quantity > 0 ? wo.quantity : "—"}
                                    </TableCell>
                                    <TableCell className="p-2 align-middle text-sm text-muted-foreground whitespace-nowrap">
                                      {wo.category?.trim() || "—"}
                                    </TableCell>
                                    <TableCell className="p-2 align-middle">
                                      <select
                                        value={safeStage}
                                        disabled={savingWorkOrderStageId === wo.id}
                                        onChange={async (e) => {
                                          const next = e.target.value as WorkOrderStage;
                                          const prev = woStageById[wo.id] ?? normalizeWorkOrderStage(wo.stage);
                                          setWoStageById((p) => ({ ...p, [wo.id]: next }));
                                          if (dataSource !== "supabase") return;
                                          setSavingWorkOrderStageId(wo.id);
                                          const r = await updateWorkOrderStageForAssignee(
                                            wo.id,
                                            employee.id,
                                            wo.order_id,
                                            next,
                                          );
                                          setSavingWorkOrderStageId(null);
                                          if (!r.ok) {
                                            setWoStageById((p) => ({ ...p, [wo.id]: prev }));
                                            toast.error(r.message);
                                            return;
                                          }
                                          if (r.syncWarning) {
                                            toast.warning(r.syncWarning);
                                          } else if (r.syncMessage) {
                                            toast.success(r.syncMessage);
                                          }
                                        }}
                                        className={cn(
                                          "h-8 max-w-[9.5rem] rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-none",
                                          stageStyleClassName(safeStage),
                                          savingWorkOrderStageId === wo.id && "opacity-70",
                                        )}
                                      >
                                        {WORK_ORDER_STAGES.map((s) => (
                                          <option key={s} value={s}>
                                            {s}
                                          </option>
                                        ))}
                                      </select>
                                    </TableCell>
                                    <TableCell className="p-2 align-middle text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                      <div className="flex items-center gap-1">
                                        <CalendarDays className="h-3 w-3 shrink-0" />
                                        <span>
                                          {wo.planned_end_date
                                            ? formatDateYyMmDd(wo.planned_end_date)
                                            : "—"}
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-border/60 pt-4">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        生產任務（production_tasks）
                      </p>
                      {work_progress_seed.length === 0 ? (
                        <p className="text-sm text-muted-foreground">目前沒有生產任務交辦。</p>
                      ) : (
                        <ul className="space-y-2 pr-2">
                          {work_progress_seed.map((row) => {
                        const status = progressById[row.id] ?? "pending";
                        const isDone = status === "done";
                        return (
                          <li
                            key={row.id}
                            className={cn(
                              "rounded-xl border border-border/60 px-3 py-3 sm:px-4",
                              "transition-colors",
                              workProgressRowTone(status)
                            )}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <p
                                  className={cn(
                                    "font-medium leading-snug text-foreground",
                                    isDone && "text-muted-foreground line-through decoration-border/80"
                                  )}
                                >
                                  {row.order_ref}
                                </p>
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
                                  <span
                                    className={cn(
                                      isDone && "line-through opacity-90"
                                    )}
                                  >
                                    工序：{row.stage_label}
                                  </span>
                                  <span
                                    className={cn(
                                      "tabular-nums",
                                      isDone && "line-through opacity-90"
                                    )}
                                  >
                                    預計 {row.expected_complete_date}
                                  </span>
                                </div>
                              </div>
                              <div className="shrink-0 sm:w-[11rem]">
                                <label className="sr-only" htmlFor={`prod-progress-${row.id}`}>
                                  {row.order_ref} 狀態
                                </label>
                                <select
                                  id={`prod-progress-${row.id}`}
                                  value={status}
                                  disabled={savingProductionTaskId === row.id}
                                  onChange={async (e) => {
                                    const v = e.target.value as WorkProgressUiStatus;
                                    const prev = progressById[row.id] ?? row.initial_ui_status ?? "pending";
                                    setProgressById((p) => ({ ...p, [row.id]: v }));
                                    if (dataSource !== "supabase") return;
                                    setSavingProductionTaskId(row.id);
                                    const r = await updateProductionTaskStatusForAssignee(
                                      row.id,
                                      employee.id,
                                      v,
                                    );
                                    setSavingProductionTaskId(null);
                                    if (!r.ok) {
                                      setProgressById((p) => ({ ...p, [row.id]: prev }));
                                      toast.error(r.message);
                                    }
                                  }}
                                  className={cn(
                                    "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground",
                                    "focus:outline-none focus:ring-2 focus:ring-ring",
                                    savingProductionTaskId === row.id && "opacity-70"
                                  )}
                                >
                                  {(Object.keys(workProgressStatusLabels) as WorkProgressUiStatus[]).map((k) => (
                                    <option key={k} value={k}>
                                      {workProgressStatusLabels[k]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 我的請假狀態 */}
          <section className={epSection.card}>
            <div className={cn(epSection.headerRowBetween, "sm:items-start")}>
              <div className="flex items-center gap-2">
                <div className={epSection.iconBox}>
                  <Leaf className="h-4 w-4" />
                </div>
                <div>
                  <h3 className={epSection.title}>我的請假狀態</h3>
                  {showAdminFieldHints ? (
                    <p className={cn("mt-0.5", epSection.subtitle)}>leave_requests · 近期紀錄</p>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                size="default"
                className="shrink-0 gap-1.5 self-start sm:self-auto"
                onClick={() => setLeaveOpen(true)}
              >
                <CalendarPlus className="h-4 w-4" />
                申請休假
              </Button>
            </div>
            <div className={epSection.tableWrap}>
              <table className={epSection.table}>
                <thead>
                  <tr className={epSection.thead}>
                    <th className={epSection.th}>假別</th>
                    <th className={epSection.th}>區間</th>
                    <th className={epSection.th}>天數/時數</th>
                    <th className={cn(epSection.th, "min-w-[6rem]")}>事由</th>
                    <th className={epSection.th}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {leave_requests.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/15"
                    >
                      <td className={cn(epSection.td, "font-medium text-foreground")}>{row.type_label}</td>
                      <td className={cn(epSection.td, "tabular-nums text-muted-foreground")}>
                        <span className="text-foreground">
                          {row.start_date} — {row.end_date}
                        </span>
                        {(() => {
                          const conflict = computeLeaveHolidayConflict(
                            row.start_date,
                            row.end_date,
                            row.created_at ?? null,
                            holidayRows,
                          );
                          if (!conflict) return null;
                          const { alreadyDeducted, notDeducted } = conflict;
                          return (
                            <span className="mt-0.5 block text-xs font-normal leading-snug">
                              {notDeducted.length > 0 ? (
                                <span className="text-amber-700 dark:text-amber-400">
                                  ⚠️ 與「{notDeducted.map((h) => h.name).join("、")}」重疊（尚未扣除 {notDeducted.length} 日，請洽管理者確認）
                                </span>
                              ) : null}
                              {alreadyDeducted.length > 0 ? (
                                <span className="block text-muted-foreground">
                                  ℹ️ 已扣除臨時假日「{alreadyDeducted.map((h) => h.name).join("、")}」{alreadyDeducted.length} 日
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                        {row.start_hour != null && row.end_hour != null ? (
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            起始日 {row.start_hour}–{row.end_hour} 時
                            {row.start_date !== row.end_date &&
                            row.end_day_start_hour != null &&
                            row.end_day_end_hour != null ? (
                              <>
                                {" "}
                                · 結束日 {row.end_day_start_hour}–{row.end_day_end_hour} 時
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className={cn(epSection.td, "tabular-nums text-muted-foreground")}>
                        {leaveDurationTableLabel(row)}
                      </td>
                      <td className={cn(epSection.td, "max-w-[14rem] text-muted-foreground")}>
                        <span className="break-words text-xs leading-snug text-foreground/90">
                          {displayLeaveReason(row.reason) || "—"}
                        </span>
                      </td>
                      <td className={cn(epSection.td, "align-top")}>
                        <div className="flex flex-col gap-1">
                          {leaveStatusBadge(row)}
                          {leaveRequestRowWasUpdated(row) ? (
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              已更新 · {formatLeaveUpdatedAtDisplay(row.updated_at)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <Dialog.Root
        open={payslipModalOpen}
        onOpenChange={(open) => {
          setPayslipModalOpen(open);
          if (!open) setExpandedPayslipId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,44rem)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl focus:outline-none sm:max-w-3xl sm:w-[calc(100%-2.5rem)] lg:max-w-4xl">
            <div className="shrink-0 border-b border-border/70 bg-secondary/20 px-3 py-2 sm:px-4 sm:py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
                    歷史薪資單
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                    點「明細」展開完整項目與出勤備註。
                    {showAdminFieldHints
                      ? dataSource === "supabase"
                        ? " 資料來源：payslips。"
                        : " （Mock）"
                      : null}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="關閉"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 max-h-[min(72vh,28rem)] overflow-y-auto overscroll-contain px-3 py-2.5 sm:max-h-[min(78vh,36rem)] sm:px-5 sm:py-4 lg:max-h-[min(82vh,40rem)]">
              {payslipsSorted.length === 0 ? (
                <p className="px-2 py-5 text-center text-xs text-muted-foreground sm:py-6 sm:text-sm">
                  尚無薪資單紀錄
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/80 bg-card shadow-sm">
                  <table className="w-full min-w-[20rem] text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-[10px] font-semibold text-muted-foreground sm:text-[11px]">
                        <th className="min-w-0 px-2 py-1.5 font-medium normal-case sm:px-2.5 sm:py-2">
                          薪資月份
                        </th>
                        <th className="px-1.5 py-1.5 text-right font-medium normal-case sm:px-2 sm:py-2">
                          實發總額
                        </th>
                        <th className="px-1.5 py-1.5 font-medium normal-case sm:px-2 sm:py-2">狀態</th>
                        <th className="w-10 shrink-0 px-1 py-1.5 sm:w-[4.25rem] sm:py-2" aria-hidden />
                      </tr>
                    </thead>
                    <tbody>
                      {payslipsSorted.map((row: PayslipRow) => {
                        const expanded = expandedPayslipId === row.id;
                        return (
                          <Fragment key={row.id}>
                            <tr
                              className={cn(
                                "border-b border-border/60 transition-colors",
                                expanded ? "bg-muted/25" : "hover:bg-muted/15"
                              )}
                            >
                              <td className="px-2 py-1.5 font-medium text-foreground sm:px-2.5 sm:py-2">
                                <span className="block">{row.month_label}</span>
                                {row.notes?.trim() ? (
                                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                                    含出勤備註
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-xs tabular-nums font-medium text-foreground sm:px-2 sm:py-2 sm:text-sm">
                                {formatNtd(row.net_pay)}
                              </td>
                              <td className="px-1.5 py-1.5 sm:px-2 sm:py-2 [&_.inline-flex]:scale-90 [&_.inline-flex]:origin-left">
                                {payslipStatusBadge(row.status)}
                              </td>
                              <td className="px-1 py-1.5 text-right sm:px-1.5 sm:py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPayslipId((id) => (id === row.id ? null : row.id))
                                  }
                                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:gap-1 sm:px-2 sm:text-xs"
                                  aria-expanded={expanded}
                                >
                                  明細
                                  <ChevronDown
                                    className={cn(
                                      "h-3 w-3 transition-transform duration-200 sm:h-3.5 sm:w-3.5",
                                      expanded && "rotate-180"
                                    )}
                                  />
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b border-border/60 bg-muted/10">
                                <td colSpan={4} className="w-full px-0.5 py-0.5 sm:px-1 sm:py-1">
                                  <PayslipBreakdownPanel
                                    compact
                                    monthLabel={row.month_label}
                                    periodKey={row.period_key}
                                    b={row.breakdown}
                                    notes={row.notes}
                                    annualLeaveRemaining={employee.annual_leave_remaining ?? null}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={leaveOpen}
        onOpenChange={(open) => {
          setLeaveOpen(open);
          if (!open) setLeaveForm({ ...LEAVE_FORM_INITIAL });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none max-h-[min(90vh,36rem)] overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">申請休假</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {showAdminFieldHints
                    ? isSupabaseConfigured
                      ? "送出後將寫入請假紀錄（leave_requests），狀態為待審核。"
                      : "Mock：送出後僅更新此頁列表，不寫入資料庫。"
                    : isSupabaseConfigured
                      ? "送出後將寫入請假紀錄，狀態為待審核。"
                      : "送出後僅更新此頁列表，不寫入資料庫。"}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={(e) => void submitLeaveRequest(e)} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">目前特休剩餘</p>
                  {annualLeaveRemainingParts ? (
                    <p className="mt-1 tabular-nums text-base font-medium text-foreground">
                      {annualLeaveRemainingParts.days} 日 {annualLeaveRemainingParts.hours} 小時
                    </p>
                  ) : (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {showAdminFieldHints
                        ? "尚未設定（employees.annual_leave_remaining）。請洽人資維護。"
                        : "尚未設定。請洽人資維護。"}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">目前補休剩餘</p>
                  {data?.employee.comp_leave_remaining != null &&
                  Number.isFinite(data.employee.comp_leave_remaining) ? (
                    <p className="mt-1 tabular-nums text-base font-medium text-foreground">
                      {formatHoursAsDayHour(data.employee.comp_leave_remaining)}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {showAdminFieldHints
                        ? "尚未設定（employees.comp_leave_remaining）。請洽人資維護。"
                        : "尚未設定。請洽人資維護。"}
                    </p>
                  )}
                </div>
              </div>
              {leaveForm.type === "補休" ? (
                <p className="text-xs text-muted-foreground">
                  補休假單之有效請假時數不可超過上方「補休剩餘」總時數；超額無法送出。
                </p>
              ) : null}
              <div>
                <label htmlFor="leave-type" className="mb-1.5 block text-sm font-medium text-foreground">
                  假別
                </label>
                <select
                  id="leave-type"
                  value={leaveForm.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    setLeaveForm((f) => ({
                      ...f,
                      type: t,
                      startTime: f.startTime || "09:00",
                      endTime: f.endTime || "18:00",
                    }));
                  }}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="特休">特休</option>
                  <option value="事假">事假</option>
                  <option value="病假">病假</option>
                  <option value="補休">補休</option>
                </select>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
                <p className="text-xs font-medium text-foreground">請假起始（日＋時間）</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    id="leave-start-date"
                    type="date"
                    value={leaveForm.start}
                    onChange={(e) =>
                      setLeaveForm((f) => applyLeaveStartDateChange(f, e.target.value))
                    }
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div>
                    <label
                      htmlFor="leave-start-time"
                      className="mb-1 block text-[10px] text-muted-foreground"
                    >
                      起始時間
                    </label>
                    <input
                      id="leave-start-time"
                      type="time"
                      step={60}
                      value={leaveForm.startTime}
                      onChange={(e) =>
                        setLeaveForm((f) => ({ ...f, startTime: e.target.value }))
                      }
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
                <p className="text-xs font-medium text-foreground">請假結束（日＋時間）</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    id="leave-end-date"
                    type="date"
                    value={leaveForm.end}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, end: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div>
                    <label
                      htmlFor="leave-end-time"
                      className="mb-1 block text-[10px] text-muted-foreground"
                    >
                      結束時間
                    </label>
                    <input
                      id="leave-end-time"
                      type="time"
                      step={60}
                      value={leaveForm.endTime}
                      onChange={(e) => setLeaveForm((f) => ({ ...f, endTime: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                上班時段 {LEAVE_WORKDAY_START_HOUR}:00–{LEAVE_WORKDAY_END_HOUR}:00；午休{" "}
                {LEAVE_LUNCH_START_HOUR}:00–{LEAVE_LUNCH_END_HOUR}:00 不計入。僅計算與上班時段重疊的時間；跨日時中間完整工作
                日各計 {LEAVE_WORK_DAY_HOURS} 小時（已扣午休）。
                {showAdminFieldHints
                  ? ` 週六、週日及 public_holidays 之放假日（is_workday=false）不計入；補班日（is_workday=true）計入。${
                      isSupabaseConfigured ? " 已自資料庫載入假日設定。" : " 未連線資料庫時僅排除週末。"
                    }`
                  : ` 週六、週日及國定放假日不計入；補班日計入。${
                      isSupabaseConfigured ? " 已載入國定／假日設定。" : " 未連線時僅排除週末。"
                    }`}
              </p>
              {timedLeaveHourPreview ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">本次申請：</span>
                  <span className="tabular-nums font-medium text-foreground">
                    共{" "}
                    {timedLeaveHourPreview.totalHours.toLocaleString("zh-TW", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    小時（{timedLeaveHourPreview.parts.days} 日 {timedLeaveHourPreview.parts.hours}{" "}
                    小時）
                  </span>
                </div>
              ) : leaveForm.start && leaveForm.end && leaveForm.startTime && leaveForm.endTime ? (
                <p className="text-xs text-amber-700 dark:text-amber-200/90">
                  請確認結束晚於起始，且與 9:00–18:00 有重疊；若仍無預覽，請檢查時間格式或是否區間皆落在週末／國定放假日。
                </p>
              ) : null}
              {leaveForm.type === "補休" &&
              (data?.employee.comp_leave_remaining == null ||
                !Number.isFinite(data?.employee.comp_leave_remaining ?? NaN)) ? (
                <p className="text-xs text-destructive">無法申請補休：尚無補休餘額資料。</p>
              ) : leaveForm.type === "補休" && timedLeaveHourPreview && compLeaveSubmitBlocked ? (
                <p className="text-xs text-destructive">
                  本次有效時數超過剩餘補休，請縮短區間或調整時間後再送出。
                </p>
              ) : null}

              <div>
                <label htmlFor="leave-reason" className="mb-1.5 block text-sm font-medium text-foreground">
                  事由
                </label>
                <textarea
                  id="leave-reason"
                  rows={3}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="簡述申請原因…"
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={leaveSubmitting}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={leaveSubmitting || compLeaveSubmitBlocked}>
                  {leaveSubmitting ? "送出中…" : "送出申請"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
