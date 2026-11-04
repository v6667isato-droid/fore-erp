import { supabase } from "@/lib/supabase";
import { LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";
import { formatLeaveHoursLabel } from "@/lib/leave-hours";
import { milestoneLabel } from "@/lib/annual-leave-grant";

/** leave_balance_ledger 一筆：特休／補休餘額異動（一律以小時記錄，特休 1 天＝8 小時） */
export type LeaveLedgerEntry = {
  id: string;
  employee_id: string;
  kind: "annual" | "comp";
  delta_hours: number;
  balance_after_hours: number | null;
  reason:
    | "leave_approved"
    | "leave_revoked"
    | "holiday_refund"
    | "annual_grant"
    | "manual_adjust"
    | "cutover";
  leave_request_id: string | null;
  ref_id: string | null;
  note: string | null;
  payslip_period: string | null;
  created_at: string;
};

/** 備註用的假單摘要 */
export type LedgerLeaveRef = { leave_type: string; start_date: string; end_date: string };
/** 備註用的年資特休授予摘要 */
export type LedgerGrantRef = { milestone_years: number; days: number; statutory_days: number | null };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeLedgerRow(r: Record<string, unknown>): LeaveLedgerEntry {
  return {
    id: String(r.id),
    employee_id: String(r.employee_id),
    kind: r.kind === "comp" ? "comp" : "annual",
    delta_hours: num(r.delta_hours),
    balance_after_hours: r.balance_after_hours == null ? null : num(r.balance_after_hours),
    reason: String(r.reason) as LeaveLedgerEntry["reason"],
    leave_request_id: r.leave_request_id == null ? null : String(r.leave_request_id),
    ref_id: r.ref_id == null ? null : String(r.ref_id),
    note: r.note == null || String(r.note).trim() === "" ? null : String(r.note),
    payslip_period: r.payslip_period == null ? null : String(r.payslip_period),
    created_at: String(r.created_at),
  };
}

/** 台北時間 M/D */
function mdTaipei(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${m}/${day}`;
}

function mdYmd(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

function leaveRange(l: LedgerLeaveRef | undefined): string {
  if (!l) return "";
  const s = mdYmd(l.start_date);
  return l.end_date && l.end_date !== l.start_date ? `${s}–${mdYmd(l.end_date)}` : s;
}

function signedHours(h: number): string {
  const sign = h < 0 ? "−" : "+";
  return `${sign}${formatLeaveHoursLabel(Math.abs(h))}`;
}

function fmtDays(d: number): string {
  return d.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

/** 單筆異動說明（不含日期與種類前綴） */
export function describeLedgerEntry(
  e: LeaveLedgerEntry,
  leaves: ReadonlyMap<string, LedgerLeaveRef>,
  grants: ReadonlyMap<string, LedgerGrantRef>,
): string {
  const leave = e.leave_request_id ? leaves.get(e.leave_request_id) : undefined;
  const leaveText = leave ? `${leave.leave_type} ${leaveRange(leave)}` : "假單";
  const amount = signedHours(e.delta_hours);
  switch (e.reason) {
    case "leave_approved":
      return `核准 ${leaveText}（${amount}）`;
    case "leave_revoked":
      return `撤銷 ${leaveText}（${amount}${e.note ? `；${e.note}` : ""}）`;
    case "holiday_refund":
      return `${e.note ?? "放假日"}回補，${leaveText}（${amount}）`;
    case "annual_grant": {
      const g = e.ref_id ? grants.get(e.ref_id) : undefined;
      const label = g ? milestoneLabel(g.milestone_years) : "年資";
      const statutory =
        g && g.statutory_days != null && Math.abs(g.statutory_days - g.days) > 0.001
          ? `；法定 ${fmtDays(g.statutory_days)} 天${e.note ? `，${e.note}` : ""}`
          : "";
      return `年資新增 ${label}（${amount}${statutory}）`;
    }
    case "manual_adjust":
      return `人工調整（${amount}${e.note ? `；${e.note}` : ""}）`;
    case "cutover":
      return `系統切換補扣 ${leaveText}（${amount}）`;
    default:
      return amount;
  }
}

/** 薪資單備註的異動行前綴；重新產生備註時以此移除舊行 */
export const LEAVE_LEDGER_REMARK_RE = /^(特休|補休)異動 \d{1,2}\/\d{1,2}：/;

/** 「特休異動 11/5：10/23 颱風假回補，特休 10/21–10/28（+1 天）」，依時間排序 */
export function formatLedgerRemarkLines(
  entries: readonly LeaveLedgerEntry[],
  leaves: ReadonlyMap<string, LedgerLeaveRef>,
  grants: ReadonlyMap<string, LedgerGrantRef>,
): string[] {
  return [...entries]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(
      (e) =>
        `${e.kind === "annual" ? "特休" : "補休"}異動 ${mdTaipei(e.created_at)}：${describeLedgerEntry(e, leaves, grants)}`,
    );
}

/** 移除備註中舊的異動行，再附上新的 */
export function withLedgerRemarkLines(notes: string, lines: readonly string[]): string {
  const cleaned = notes
    .split("\n")
    .filter((line) => !LEAVE_LEDGER_REMARK_RE.test(line.trim()))
    .join("\n")
    .replace(/\n+$/, "");
  return [cleaned, ...lines].filter(Boolean).join("\n");
}

/** 請假造成的特休淨使用（天）：核准扣除、撤銷退回、回補、切換補扣（不含年資新增與人工調整） */
export function annualLeaveUsedDays(entries: readonly LeaveLedgerEntry[]): number {
  const h = entries
    .filter(
      (e) =>
        e.kind === "annual" &&
        (e.reason === "leave_approved" ||
          e.reason === "leave_revoked" ||
          e.reason === "holiday_refund" ||
          e.reason === "cutover"),
    )
    .reduce((s, e) => s + e.delta_hours, 0);
  return -h / LEAVE_WORK_DAY_HOURS;
}

/** 依種類加總（小時） */
export function ledgerNetHours(entries: readonly LeaveLedgerEntry[], kind: "annual" | "comp"): number {
  return entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.delta_hours, 0);
}

/** 尚未列入薪資單、且發生在 `beforeIso` 之前的異動（結算月份備註用） */
export function unbilledLedgerEntries(
  entries: readonly LeaveLedgerEntry[],
  beforeIso: string,
): LeaveLedgerEntry[] {
  const limit = new Date(beforeIso).getTime();
  return entries.filter(
    (e) => e.payslip_period == null && new Date(e.created_at).getTime() < limit,
  );
}

export type LedgerContext = {
  entries: LeaveLedgerEntry[];
  leaves: Map<string, LedgerLeaveRef>;
  grants: Map<string, LedgerGrantRef>;
  /** 資料表尚未建立（migration 未套用） */
  missing: boolean;
};

/** 載入多位員工的異動紀錄，以及備註需要的假單／授予摘要 */
export async function fetchLeaveLedger(employeeIds: readonly string[]): Promise<LedgerContext> {
  const empty: LedgerContext = { entries: [], leaves: new Map(), grants: new Map(), missing: false };
  if (employeeIds.length === 0) return empty;
  const { data, error } = await supabase
    .from("leave_balance_ledger")
    .select("*")
    .in("employee_id", employeeIds as string[])
    .order("created_at", { ascending: true });
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return { ...empty, missing: true };
    throw new Error(error.message);
  }
  const entries = ((data ?? []) as Record<string, unknown>[]).map(normalizeLedgerRow);

  const leaveIds = [...new Set(entries.map((e) => e.leave_request_id).filter((x): x is string => !!x))];
  const grantIds = [
    ...new Set(entries.filter((e) => e.reason === "annual_grant").map((e) => e.ref_id).filter((x): x is string => !!x)),
  ];
  const [leaveRes, grantRes] = await Promise.all([
    leaveIds.length
      ? supabase.from("leave_requests").select("id, leave_type, start_date, end_date").in("id", leaveIds)
      : Promise.resolve({ data: [], error: null }),
    grantIds.length
      ? supabase
          .from("annual_leave_grants")
          .select("id, milestone_years, days, statutory_days")
          .in("id", grantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const leaves = new Map<string, LedgerLeaveRef>();
  for (const r of (leaveRes.data ?? []) as Record<string, unknown>[]) {
    leaves.set(String(r.id), {
      leave_type: String(r.leave_type ?? "").trim(),
      start_date: String(r.start_date ?? "").slice(0, 10),
      end_date: String(r.end_date ?? r.start_date ?? "").slice(0, 10),
    });
  }
  const grants = new Map<string, LedgerGrantRef>();
  for (const r of (grantRes.data ?? []) as Record<string, unknown>[]) {
    grants.set(String(r.id), {
      milestone_years: num(r.milestone_years),
      days: num(r.days),
      statutory_days: r.statutory_days == null ? null : num(r.statutory_days),
    });
  }
  return { entries, leaves, grants, missing: false };
}
