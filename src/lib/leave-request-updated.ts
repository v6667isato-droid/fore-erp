/** 判斷假單是否曾異動（建立後另有更新，如核准／退回或內容修改） */

const MIN_DELTA_MS = 1000;

export function leaveRecordWasUpdated(row: Record<string, unknown>): boolean {
  const cr = row.created_at;
  const up = row.updated_at;
  if (cr == null || up == null) return false;
  const c = new Date(String(cr)).getTime();
  const u = new Date(String(up)).getTime();
  if (Number.isNaN(c) || Number.isNaN(u)) return false;
  return u - c > MIN_DELTA_MS;
}

export function appendLeaveRemarkUpdateSuffix(
  line: string,
  row: Record<string, unknown>,
): string {
  if (!leaveRecordWasUpdated(row)) return line;
  return `${line}（已更新）`;
}

export function leaveRequestRowWasUpdated(row: {
  created_at?: string | null;
  updated_at?: string | null;
}): boolean {
  const cr = row.created_at;
  const up = row.updated_at;
  if (cr == null || up == null) return false;
  const c = new Date(String(cr)).getTime();
  const u = new Date(String(up)).getTime();
  if (Number.isNaN(c) || Number.isNaN(u)) return false;
  return u - c > MIN_DELTA_MS;
}

export function formatLeaveUpdatedAtDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
