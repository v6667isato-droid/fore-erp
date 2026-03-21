/**
 * 打卡鐘匯出：Tab（或逗號）分隔。
 * - 有表頭列且含 UID 欄：Papa header + transformHeader(trim)，以 row.UID / Status / DateTime 取值。
 * - 無表頭：固定欄位 UID=row[2]、Status=row[4]、DateTime=row[8]（8 欄則 row[7]）。
 * UID、Status 以 parseInt 去除前綴零；Status 僅接受數值 1（上班）、2（下班）。
 * DateTime 可含秒（HH:mm:ss），內部仍正規化為 HH:mm 供遲到早退（分鐘級）比對。
 */

import Papa from "papaparse";

function firstNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.replace(/\uFEFF/g, "").trim();
    if (t) return line.replace(/\uFEFF/g, "");
  }
  return "";
}

/** 首列是否為表頭（含 UID 欄位名） */
function looksLikeHeaderRow(line: string): boolean {
  const norm = line.replace(/\uFEFF/g, "").trim();
  if (!norm) return false;
  const byTab = norm.split("\t");
  const parts = byTab.length >= 3 ? byTab : norm.split(",");
  return parts.some((p) => String(p).trim().toUpperCase() === "UID");
}

function getField(row: Record<string, unknown>, names: string[]): unknown {
  const keys = Object.keys(row);
  for (const name of names) {
    const want = name.trim().toLowerCase();
    const k = keys.find((h) => String(h).trim().toLowerCase() === want);
    if (k != null) return row[k];
  }
  return undefined;
}

export type AttendanceRawRow = {
  uid: string;
  name: string;
  action: string;
  date: string;
  time: string;
  dateTimeRaw: string;
};

export type AttendanceDayRow = {
  uid: string;
  displayName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  missingPunch: boolean;
};

/**
 * 輸出日期如 2026/2/2；時間如 08:16。
 * 容錯：未補零的月日時分、/.- 分隔、全形空白、日期與時間間多種空白。
 */
export function splitDateTime(raw: string): { date: string; time: string } | null {
  let t = String(raw ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u3000\u00A0]/g, " ")
    .trim()
    .replace("T", " ");
  t = t.replace(/\s+/g, " ");
  if (!t) return null;

  const md = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(t);
  if (!md) return null;

  const rest = t.slice(md[0].length).trim();
  if (!rest) return null;

  const tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(rest);
  if (!tm) return null;

  const y = Number(md[1]);
  const mo = Number(md[2]);
  const d = Number(md[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

  const date = `${y}/${mo}/${d}`;

  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  const ss = tm[3] != null && tm[3] !== "" ? Number(tm[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  if (tm[3] != null && tm[3] !== "" && (!Number.isFinite(ss) || ss < 0 || ss > 59)) return null;

  const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return { date, time };
}

/**
 * 打卡鐘 DateTime 欄：清除上午/下午、AM/PM 後拆日期與時間，並轉成 24 小時制 HH:mm。
 * - 含「下午」或 PM（不分大小寫）且時數 &lt; 12 → 小時 +12
 * - 含「上午」或 AM 且時數為 12 → 小時改為 0（12 點半上午 → 00:xx）
 */
function parseClockDateTimeCell(
  dateTimeRaw: string,
  rowLabel: string,
  parseErrors: string[],
): { date: string; time: string } | null {
  const original = String(dateTimeRaw ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u3000\u00A0]/g, " ")
    .trim();
  if (!original) {
    parseErrors.push(`${rowLabel}：DateTime 為空。`);
    return null;
  }

  const isPM = /下午|\bpm\b/i.test(original);
  const isAM = !isPM && (/上午|\bam\b/i.test(original));

  let s = original
    .replace(/上午|下午/g, " ")
    .replace(/\bam\b|\bpm\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const md = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(s);
  if (!md) {
    parseErrors.push(
      `${rowLabel}：DateTime 無法辨識日期「${original.slice(0, 44)}${original.length > 44 ? "…" : ""}」。`,
    );
    return null;
  }

  const rest = s.slice(md[0].length).trim();
  const tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(rest);
  if (!tm) {
    parseErrors.push(
      `${rowLabel}：DateTime 無法辨識時間「${original.slice(0, 44)}${original.length > 44 ? "…" : ""}」。`,
    );
    return null;
  }

  let h = Number(tm[1]);
  const mi = Number(tm[2]);
  const ss = tm[3] != null && tm[3] !== "" ? Number(tm[3]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (tm[3] != null && tm[3] !== "" && (!Number.isFinite(ss) || ss < 0 || ss > 59)) {
    parseErrors.push(`${rowLabel}：DateTime 秒數無效。`);
    return null;
  }

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  if (h < 0 || h > 23 || mi < 0 || mi > 59) {
    parseErrors.push(`${rowLabel}：時間超出有效範圍（24 小時制換算後）。`);
    return null;
  }

  const y = Number(md[1]);
  const mo = Number(md[2]);
  const d = Number(md[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

  const date = `${y}/${mo}/${d}`;
  const time = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  return { date, time };
}

function rowSortMinutes(row: AttendanceRawRow): number {
  const parts = row.time.split(":");
  const h = Number(parts[0]);
  const mi = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return 0;
  return h * 60 + mi;
}

function dateSortKey(dateStr: string): number {
  const p = dateStr.split("/").map((x) => Number(x));
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return 0;
  return p[0] * 10_000 + p[1] * 100 + p[2];
}

function aggregateRawRows(rawRows: AttendanceRawRow[]): AttendanceDayRow[] {
  type Agg = {
    name: string;
    ins: AttendanceRawRow[];
    outs: AttendanceRawRow[];
  };

  const byKey = new Map<string, Agg>();

  for (const r of rawRows) {
    const key = `${r.uid}\t${r.date}`;
    let g = byKey.get(key);
    if (!g) {
      g = { name: r.name, ins: [], outs: [] };
      byKey.set(key, g);
    }
    if (r.name && r.name !== "—") g.name = r.name;

    if (r.action === "1") g.ins.push(r);
    else if (r.action === "2") g.outs.push(r);
  }

  const rows: AttendanceDayRow[] = [];

  for (const [key, g] of byKey) {
    const [uid, date] = key.split("\t");
    let clockIn: string | null = null;
    let clockOut: string | null = null;

    if (g.ins.length) {
      const earliest = g.ins.reduce((a, b) =>
        rowSortMinutes(a) <= rowSortMinutes(b) ? a : b,
      );
      clockIn = earliest.time;
    }
    if (g.outs.length) {
      const latest = g.outs.reduce((a, b) =>
        rowSortMinutes(a) >= rowSortMinutes(b) ? a : b,
      );
      clockOut = latest.time;
    }

    if (clockIn == null && clockOut == null) continue;

    const missingPunch =
      (clockIn != null && clockOut == null) || (clockIn == null && clockOut != null);

    rows.push({
      uid,
      displayName: g.name,
      date,
      clockIn,
      clockOut,
      missingPunch,
    });
  }

  rows.sort((a, b) => {
    const dc = dateSortKey(a.date) - dateSortKey(b.date);
    if (dc !== 0) return dc;
    return a.uid.localeCompare(b.uid, "zh-Hant");
  });

  return rows;
}

export function parseAttendanceCsvText(text: string): {
  rows: AttendanceDayRow[];
  parseErrors: string[];
} {
  const parseErrors: string[] = [];
  const bomStripped = text.replace(/^\uFEFF/, "");
  const useHeader = looksLikeHeaderRow(firstNonEmptyLine(bomStripped));

  let aggregatedRows: AttendanceDayRow[] = [];

  const parsed = Papa.parse<unknown[] | Record<string, unknown>>(bomStripped, {
    header: useHeader,
    transformHeader: useHeader
      ? (header: string) => String(header ?? "").replace(/\uFEFF/g, "").trim()
      : undefined,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (results) => {
      const rawRows: AttendanceRawRow[] = [];
      const data = results.data;

      if (useHeader) {
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const rec = row as Record<string, unknown>;

          const uidNum = parseInt(String(getField(rec, ["UID"]) ?? "").trim(), 10);
          if (!Number.isFinite(uidNum)) continue;

          const statusNum = parseInt(String(getField(rec, ["Status", "STATUS"]) ?? "").trim(), 10);
          if (statusNum !== 1 && statusNum !== 2) continue;

          const displayNameRaw = String(
            getField(rec, ["Name", "姓名", "USERNAME", "UserName"]) ?? "",
          ).trim();
          const dateTimeRaw = String(
            getField(rec, ["DateTime", "DATETIME", "Date Time", "日期時間"]) ?? "",
          ).trim();

          const split = parseClockDateTimeCell(
            dateTimeRaw,
            `第 ${i + 2} 列`,
            parseErrors,
          );
          if (!split) continue;

          rawRows.push({
            uid: String(uidNum),
            name: displayNameRaw || "—",
            action: String(statusNum),
            date: split.date,
            time: split.time,
            dateTimeRaw,
          });
        }
      } else {
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!Array.isArray(row)) continue;

          if (
            row.length < 8 ||
            String(row[0] ?? "").includes("No") ||
            !String(row[2] ?? "").trim()
          ) {
            continue;
          }

          const dateTimeIdx = row.length >= 9 ? 8 : 7;
          if (row.length <= dateTimeIdx) continue;

          const uidNum = parseInt(String(row[2]).trim(), 10);
          if (!Number.isFinite(uidNum)) continue;

          const displayNameRaw = String(row[3] ?? "").trim();
          const statusNum = parseInt(String(row[4]).trim(), 10);
          if (statusNum !== 1 && statusNum !== 2) continue;

          const dateTimeRaw = String(row[dateTimeIdx]).trim();

          const split = parseClockDateTimeCell(
            dateTimeRaw,
            `第 ${i + 1} 列`,
            parseErrors,
          );
          if (!split) continue;

          rawRows.push({
            uid: String(uidNum),
            name: displayNameRaw || "—",
            action: String(statusNum),
            date: split.date,
            time: split.time,
            dateTimeRaw,
          });
        }
      }

      aggregatedRows = aggregateRawRows(rawRows);
    },
  });

  for (const err of parsed.errors ?? []) {
    if (err.type === "Delimiter" || err.type === "FieldMismatch") {
      parseErrors.push(`CSV 解析：${err.message}${err.row != null ? `（列 ${err.row}）` : ""}`);
    }
  }

  if (!parsed.data?.length) {
    parseErrors.push("檔案為空或沒有資料列。");
    return { rows: [], parseErrors };
  }

  return { rows: aggregatedRows, parseErrors };
}
