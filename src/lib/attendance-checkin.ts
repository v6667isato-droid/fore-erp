/**
 * 線上打卡（LINE LIFF／員工儀表板）共用常數與工具。
 * 出勤主要依據仍為打卡鐘 CSV；線上打卡寫入 attendance_logs，
 * 測試期僅作為補卡審核佐證，不進月底出勤統計。
 */

/** 工廠中心點（WGS84） */
export const FACTORY_LAT = 22.97719574793936;
export const FACTORY_LNG = 120.27564517465072;
/** 允許打卡半徑（公尺） */
export const GEOFENCE_RADIUS_M = 100;

/** app_settings：儀表板打卡開放範圍（off=關閉／admin=僅管理員測試／all=全員） */
export const PORTAL_CHECKIN_SCOPE_KEY = "portal_checkin_scope";

export type PortalCheckinScope = "off" | "admin" | "all";

export function normalizePortalCheckinScope(raw: unknown): PortalCheckinScope {
  const s = String(raw ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase();
  if (s === "all") return "all";
  if (s === "admin") return "admin";
  return "off";
}

export type CheckinType = "in" | "out";

export function normalizeCheckinType(raw: unknown): CheckinType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "in" || s === "clock_in" || s === "上班") return "in";
  if (s === "out" || s === "clock_out" || s === "下班") return "out";
  return null;
}

export function checkinTypeLabel(raw: string | null | undefined): string {
  const t = normalizeCheckinType(raw);
  if (t === "in") return "上班";
  if (t === "out") return "下班";
  return String(raw ?? "—");
}

export function checkinSourceLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "portal") return "儀表板";
  if (s === "line") return "LINE";
  return s || "—";
}

/** 台灣固定 UTC+8（無日光節約）；把 YYYY-MM-DD 轉為該日在台北時區的 UTC 起訖 ISO */
export function taipeiDayRangeUtc(ymd: string): { startIso: string; endIso: string } {
  return {
    startIso: `${ymd}T00:00:00+08:00`,
    endIso: `${ymd}T23:59:59.999+08:00`,
  };
}

/** timestamptz ISO → 台北時區的 YYYY-MM-DD */
export function taipeiYmdOfIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

/** timestamptz ISO → 台北時區的 HH:MM */
export function taipeiHmOfIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
