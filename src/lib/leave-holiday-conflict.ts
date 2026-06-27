/**
 * 假單區間與 public_holidays（放假日，is_workday !== true）重疊判斷。
 *
 * 員工入口申請假單時，會用「申請當下」存在的 public_holidays 資料自動排除放假日
 * （見 employee-portal `countLeaveWorkdaysInclusive`/`computeSpecialLeaveNetHoursFromRange`），
 * 所以重疊的假日如果是在假單建立「之前」就已存在，代表 total_days 已經扣除過了——
 * 純粹顯示提示即可，不需要再次處理。
 * 若假日是在假單建立「之後」才新增（例如事後在出勤戰情室手動加的臨時假日），
 * 既有的 total_days 並未排除該日，才需要管理者決定是否撤銷或調整。
 */

export interface HolidayConflictEntry {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

export interface LeaveHolidayConflict {
  /** 重疊但假單建立時已存在（total_days 應已扣除） */
  alreadyDeducted: HolidayConflictEntry[];
  /** 重疊但假單建立「之後」才新增的假日（total_days 尚未扣除） */
  notDeducted: HolidayConflictEntry[];
}

export interface HolidayLookupRow {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** ISO timestamp */
  createdAt: string;
}

/** 將起訖日（含）逐日列出（UTC 運算，避免本地時區造成跨日誤差） */
function enumerateDatesUtc(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return [];
  }
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return [];
  const out: string[] = [];
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 730) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

export function computeLeaveHolidayConflict(
  startDate: string,
  endDate: string,
  leaveCreatedAt: string | null | undefined,
  holidays: readonly HolidayLookupRow[],
): LeaveHolidayConflict | null {
  const dates = enumerateDatesUtc(startDate, endDate);
  if (dates.length === 0) return null;

  const byDate = new Map<string, HolidayLookupRow>();
  for (const h of holidays) byDate.set(h.date, h);

  const hits = dates
    .map((d) => byDate.get(d))
    .filter((h): h is HolidayLookupRow => h != null);
  if (hits.length === 0) return null;

  const leaveCreatedMs = leaveCreatedAt ? new Date(leaveCreatedAt).getTime() : NaN;

  const alreadyDeducted: HolidayConflictEntry[] = [];
  const notDeducted: HolidayConflictEntry[] = [];
  for (const h of hits) {
    const holidayCreatedMs = new Date(h.createdAt).getTime();
    const entry = { date: h.date, name: h.name };
    // 無法判斷建立時間先後時，保守視為「尚未扣除」，提示管理者再次確認
    if (Number.isFinite(leaveCreatedMs) && Number.isFinite(holidayCreatedMs) && holidayCreatedMs <= leaveCreatedMs) {
      alreadyDeducted.push(entry);
    } else {
      notDeducted.push(entry);
    }
  }
  return { alreadyDeducted, notDeducted };
}
