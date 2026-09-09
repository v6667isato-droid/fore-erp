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

/** 單一打卡鈕開放時段（台北時間，自午夜起分鐘數，含頭尾）：上班卡 06:00–10:00、下班卡 16:00–20:00 */
export const CHECKIN_IN_WINDOW = { start: 6 * 60, end: 10 * 60 };
export const CHECKIN_OUT_WINDOW = { start: 16 * 60, end: 20 * 60 };

function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 打卡開放時段說明文字，如「上班卡 06:00–10:00、下班卡 16:00–20:00」 */
export const CHECKIN_WINDOW_HINT = `上班卡 ${minutesToHm(CHECKIN_IN_WINDOW.start)}–${minutesToHm(
  CHECKIN_IN_WINDOW.end,
)}、下班卡 ${minutesToHm(CHECKIN_OUT_WINDOW.start)}–${minutesToHm(CHECKIN_OUT_WINDOW.end)}`;

/** 依台北目前時間判定打卡類型：上班卡時段 → in、下班卡時段 → out、其他 → null */
export function resolveCheckinTypeByTime(now: Date = new Date()): CheckinType | null {
  const hm = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const mins = h * 60 + m;
  if (mins >= CHECKIN_IN_WINDOW.start && mins <= CHECKIN_IN_WINDOW.end) return "in";
  if (mins >= CHECKIN_OUT_WINDOW.start && mins <= CHECKIN_OUT_WINDOW.end) return "out";
  return null;
}

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

/** timestamptz ISO → 台北時區的 YYYY/M/D(星期X)，如 2026/9/7(星期一) */
export function taipeiDateWeekdayOfIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
  const weekday = d.toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    weekday: "long",
  });
  return `${date}(${weekday})`;
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
