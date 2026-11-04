import { buildLeaveHolidayLookup } from "@/lib/employee-leave-time";
import { formatLeaveHoursLabel, leaveRequestHoursInRange, leaveRequestTotalHours } from "@/lib/leave-hours";

/**
 * 假單送出之後才新增的放假日（颱風假等）：
 * 送單當下 hours_count 把那天算成上班日，需要扣回。
 * - 待審假單：核准時直接用扣回後的時數（approve_leave_request 的 p_hours）
 * - 已核准假單：產生假日回補單，審核通過才回補（decide_holiday_refund）
 */

export type HolidayRecord = {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  isWorkday: boolean;
  /** public_holidays.created_at（ISO） */
  createdAt: string | null;
};

export type HolidayHit = {
  date: string;
  name: string;
  /** 假單在該日的請假時數 */
  hours: number;
};

type Row = Record<string, unknown>;

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

/** 放假日是否晚於假單建立；任一時間不明時保守視為「晚於」（需要人工確認） */
function holidayAddedAfterLeave(h: HolidayRecord, leaveCreatedAt: string | null): boolean {
  const hc = ms(h.createdAt);
  const lc = ms(leaveCreatedAt);
  if (!Number.isFinite(hc) || !Number.isFinite(lc)) return true;
  return hc > lc;
}

/**
 * 找出假單區間內、在假單送出之後才新增的放假日，以及假單在那天的時數。
 * 時數以「送單當下的行事曆」把 hours_count 分攤到各日（與 leaveRequestHoursInRange 同一套比例），
 * `alreadyRefundedDates` 為已核准回補的日期（hours_count 已扣過，分攤時視為放假）。
 */
export function postCreationHolidayHits(
  row: Row,
  holidays: readonly HolidayRecord[],
  alreadyRefundedDates: ReadonlySet<string> = new Set(),
): HolidayHit[] {
  const start = String(row.start_date ?? "").slice(0, 10);
  const end = String(row.end_date ?? start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const leaveCreatedAt = row.created_at != null ? String(row.created_at) : null;

  const inRange = holidays.filter((h) => h.date >= start && h.date <= end);
  const late = inRange.filter(
    (h) => !h.isWorkday && !alreadyRefundedDates.has(h.date) && holidayAddedAfterLeave(h, leaveCreatedAt),
  );
  if (late.length === 0) return [];

  const lookupAtCreation = buildLeaveHolidayLookup([
    ...inRange
      .filter((h) => !holidayAddedAfterLeave(h, leaveCreatedAt))
      .map((h) => ({ holiday_date: h.date, is_workday: h.isWorkday })),
    ...[...alreadyRefundedDates].map((d) => ({ holiday_date: d, is_workday: false })),
  ]);

  const hits: HolidayHit[] = [];
  for (const h of late) {
    const hours = leaveRequestHoursInRange(row, h.date, h.date, lookupAtCreation);
    const rounded = Math.round(hours * 100) / 100;
    if (rounded > 0) hits.push({ date: h.date, name: h.name || "放假日", hours: rounded });
  }
  return hits;
}

function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/**
 * 待審假單核准時的時數調整：扣掉送單後才新增的放假日。
 * 回傳 null＝不需調整；否則回傳核准時數與附在假單事由後的系統備註。
 */
export function approvalHoursAdjustment(
  row: Row,
  holidays: readonly HolidayRecord[],
): { hours: number; note: string; hits: HolidayHit[] } | null {
  const hits = postCreationHolidayHits(row, holidays);
  if (hits.length === 0) return null;
  const original = leaveRequestTotalHours(row);
  const removed = hits.reduce((s, h) => s + h.hours, 0);
  const hours = Math.max(0, Math.round((original - removed) * 100) / 100);
  const detail = hits.map((h) => `${md(h.date)} ${h.name} ${formatLeaveHoursLabel(h.hours)}`).join("、");
  return {
    hours,
    note: `【系統】核准時已排除 ${detail}（原 ${formatLeaveHoursLabel(original)}）`,
    hits,
  };
}
