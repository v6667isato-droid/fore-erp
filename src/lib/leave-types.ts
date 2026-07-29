import { supabase } from "@/lib/supabase";
import { LEAVE_WORK_DAY_HOURS } from "@/lib/employee-leave-time";

/**
 * 假別主檔（public.leave_types）。
 * `leave_requests.leave_type` 存的是 `name`（中文顯示名），與既有假單資料及
 * 薪資結算（以「特休」「事假」「病假」字串比對）維持相容；`code` 僅作主鍵。
 */
export type LeaveTypeRow = {
  code: string;
  name: string;
  category: "balance" | "event" | "general" | "maternity";
  tracks_balance: boolean;
  statutory_days: number | null;
  annual_limit_days: number | null;
  pay_ratio: number;
  proof_required: "never" | "optional" | "required" | "over_n_days";
  proof_threshold_days: number | null;
  description: string | null;
  approval_notes: string | null;
  sort_order: number;
  active: boolean;
};

/** 事假＋家庭照顧假合併年度上限（勞工請假規則／性別平等工作法） */
export const PERSONAL_FAMILY_ANNUAL_LIMIT_DAYS = 14;
/** 病假年度上限（半薪） */
export const SICK_ANNUAL_LIMIT_DAYS = 30;
/** 病假不利處分保護線：一年內未超過 10 日不得扣考績、減薪等 */
export const SICK_PROTECTION_LINE_DAYS = 10;
/** 生理假每年 3 日內不併入病假；超過部分併入病假 30 日計算 */
export const MENSTRUAL_DAYS_EXCLUDED_FROM_SICK = 3;

/** Mock／離線時的最小假別集合（與既有下拉一致），連線後一律以資料庫為準 */
export const FALLBACK_LEAVE_TYPES: LeaveTypeRow[] = [
  { code: "annual", name: "特休", category: "balance", tracks_balance: true, statutory_days: null, annual_limit_days: null, pay_ratio: 1, proof_required: "never", proof_threshold_days: null, description: null, approval_notes: null, sort_order: 1, active: true },
  { code: "comp", name: "補休", category: "balance", tracks_balance: true, statutory_days: null, annual_limit_days: null, pay_ratio: 1, proof_required: "never", proof_threshold_days: null, description: null, approval_notes: null, sort_order: 2, active: true },
  { code: "personal", name: "事假", category: "general", tracks_balance: false, statutory_days: null, annual_limit_days: 14, pay_ratio: 0, proof_required: "optional", proof_threshold_days: null, description: null, approval_notes: null, sort_order: 3, active: true },
  { code: "sick", name: "病假", category: "general", tracks_balance: false, statutory_days: null, annual_limit_days: 30, pay_ratio: 0.5, proof_required: "over_n_days", proof_threshold_days: 3, description: null, approval_notes: null, sort_order: 4, active: true },
];

function normalizeRow(r: Record<string, unknown>): LeaveTypeRow {
  return {
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    category: (r.category as LeaveTypeRow["category"]) ?? "general",
    tracks_balance: r.tracks_balance === true,
    statutory_days: r.statutory_days == null ? null : Number(r.statutory_days),
    annual_limit_days: r.annual_limit_days == null ? null : Number(r.annual_limit_days),
    pay_ratio: r.pay_ratio == null ? 1 : Number(r.pay_ratio),
    proof_required: (r.proof_required as LeaveTypeRow["proof_required"]) ?? "optional",
    proof_threshold_days:
      r.proof_threshold_days == null ? null : Number(r.proof_threshold_days),
    description: r.description == null ? null : String(r.description),
    approval_notes: r.approval_notes == null ? null : String(r.approval_notes),
    sort_order: r.sort_order == null ? 0 : Number(r.sort_order),
    active: r.active !== false,
  };
}

/** 申請表單下拉用：active 假別依 sort_order 排序 */
export async function fetchActiveLeaveTypes(): Promise<LeaveTypeRow[]> {
  const { data, error } = await supabase
    .from("leave_types")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeRow);
}

/** 審核頁用：含停用假別，讓歷史假單仍可對到規則說明 */
export async function fetchAllLeaveTypes(): Promise<LeaveTypeRow[]> {
  const { data, error } = await supabase
    .from("leave_types")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeRow);
}

export function findLeaveTypeByName(
  list: LeaveTypeRow[],
  name: string,
): LeaveTypeRow | undefined {
  const t = name.trim();
  return list.find((x) => x.name === t);
}

export type AttachmentMode = "hidden" | "optional" | "required";

/**
 * 依假別的 proof_required 與本次申請天數決定附件欄位：
 * - never → 完全隱藏（生理假依法不得要求證明）
 * - over_n_days → 超過門檻天數轉必填，否則選填
 */
export function attachmentModeFor(
  leaveType: LeaveTypeRow | undefined,
  requestDays: number | null,
): AttachmentMode {
  if (!leaveType) return "hidden";
  switch (leaveType.proof_required) {
    case "never":
      return "hidden";
    case "required":
      return "required";
    case "over_n_days": {
      const threshold = leaveType.proof_threshold_days;
      if (threshold != null && requestDays != null && requestDays > threshold) {
        return "required";
      }
      return "optional";
    }
    default:
      return "optional";
  }
}

/** 假別名稱 → 年度已核准天數 */
export type YearlyLeaveUsageMap = Map<string, number>;

function rowDays(hoursCount: unknown, totalDays: unknown): number {
  const h = hoursCount == null || hoursCount === "" ? NaN : Number(hoursCount);
  if (Number.isFinite(h) && h > 0) return h / LEAVE_WORK_DAY_HOURS;
  const d = totalDays == null ? NaN : Number(totalDays);
  return Number.isFinite(d) ? d : 0;
}

/**
 * 年度累計一律由 approved 的 leave_requests 加總（不預存餘額欄位）。
 * 天數優先以 hours_count/8 反推（total_days 舊欄位精度不足）。
 */
export async function fetchYearlyApprovedLeaveDays(
  employeeId: string,
  year: number,
): Promise<YearlyLeaveUsageMap> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("leave_type, hours_count, total_days, status, start_date")
    .eq("employee_id", employeeId)
    .eq("status", "approved")
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);
  if (error) throw new Error(error.message);
  const map: YearlyLeaveUsageMap = new Map();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const name = String(r.leave_type ?? "").trim();
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + rowDays(r.hours_count, r.total_days));
  }
  return map;
}

export function usageDaysFor(usage: YearlyLeaveUsageMap, name: string): number {
  return usage.get(name.trim()) ?? 0;
}

/** 事假＋家庭照顧假（合併計入 14 日上限） */
export function personalFamilyCombinedDays(usage: YearlyLeaveUsageMap): number {
  return usageDaysFor(usage, "事假") + usageDaysFor(usage, "家庭照顧假");
}

/** 病假計入日數：病假＋生理假超過每年 3 日的部分 */
export function sickCountedDays(usage: YearlyLeaveUsageMap): number {
  const menstrualOverflow = Math.max(
    0,
    usageDaysFor(usage, "生理假") - MENSTRUAL_DAYS_EXCLUDED_FROM_SICK,
  );
  return usageDaysFor(usage, "病假") + menstrualOverflow;
}

const LEAVE_ATTACHMENTS_BUCKET = "leave-attachments";

function sanitizeFileName(name: string): string {
  const trimmed = name.trim() || "attachment";
  return trimmed.replace(/[^\w.\-一-鿿]+/g, "_").slice(-80);
}

/**
 * 上傳假單附件至 private bucket；路徑第一層為 auth uid（storage RLS 依此判斷本人）。
 * 回傳物件路徑，存入 leave_requests.attachment_url。
 */
export async function uploadLeaveAttachment(
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return { ok: false, message: "請先登入後再上傳附件" };
  const path = `${uid}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(LEAVE_ATTACHMENTS_BUCKET)
    .upload(path, file, { upsert: false });
  if (error) return { ok: false, message: `附件上傳失敗：${error.message}` };
  return { ok: true, path };
}

/** 以 signed URL 開啟附件（private bucket；RLS 限本人或 admin/manager） */
export async function getLeaveAttachmentSignedUrl(
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.storage
    .from(LEAVE_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl) {
    return { ok: false, message: error?.message ?? "無法取得附件連結" };
  }
  return { ok: true, url: data.signedUrl };
}
