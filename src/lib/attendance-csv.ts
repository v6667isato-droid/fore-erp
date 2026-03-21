/**
 * 打卡鐘 CSV：無標題陣列模式。
 * UID=2，上下班代碼在 Status（row[4]：1 上班、2 下班），DateTime=row[8]（8 欄列則為 row[7]）。
 */

import Papa from "papaparse";

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
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

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
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;

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
  const [h, mi] = row.time.split(":").map((x) => Number(x));
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

  let aggregatedRows: AttendanceDayRow[] = [];

  const parsed = Papa.parse<unknown[]>(bomStripped, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (results) => {
      console.log("無標題模式 · 列數:", results.data.length);
      console.log("首列原始陣列:", results.data[0]);

      const rawRows: AttendanceRawRow[] = [];
      const data = results.data;
      let loggedFirstRealRow = false;

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

        if (!loggedFirstRealRow) {
          console.log("第一筆真實資料陣列:", row);
          loggedFirstRealRow = true;
        }

        const uid = String(row[2]).trim();
        const displayNameRaw = String(row[3] ?? "").trim();
        const status = String(row[4]).trim();
        const dateTimeRaw = String(row[dateTimeIdx]).trim();

        if (status !== "1" && status !== "2") continue;

        const split = parseClockDateTimeCell(
          dateTimeRaw,
          `第 ${i + 1} 列`,
          parseErrors,
        );
        if (!split) continue;

        rawRows.push({
          uid: uid || "—",
          name: displayNameRaw || "—",
          action: status,
          date: split.date,
          time: split.time,
          dateTimeRaw,
        });
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
