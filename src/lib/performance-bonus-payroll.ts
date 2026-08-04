import { halfYearLabel } from "@/lib/performance-bonus-compute";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type SemiAnnualBonusDetail = {
  yearEnd: number;
  profitSharing: number;
  share: number;
  total: number;
};

export type SemiAnnualBonusImportResult = {
  period: { year: number; half: "H1" | "H2"; label: string };
  bonusesByEmployeeId: Record<string, number>;
  detailByEmployeeId: Record<string, SemiAnnualBonusDetail>;
  /** 來源發放紀錄的說明（發放時間、當期利潤） */
  issuanceMeta: string;
  /** 期別非由發薪月份推得，而是退回最近一筆發放紀錄 */
  usedFallbackPeriod: boolean;
};

const ISSUANCE_SELECT =
  "id, year, half, profit, issued_at, total_bonus, performance_bonus_issuance_rows (employee_id, year_end_bonus, profit_sharing_bonus, share_bonus, total_bonus)";

type IssuanceQueryRow = {
  year: number;
  half: string;
  profit: number | null;
  issued_at: string;
  performance_bonus_issuance_rows: {
    employee_id: string | null;
    year_end_bonus: number | null;
    profit_sharing_bonus: number | null;
    share_bonus: number | null;
    total_bonus: number | null;
  }[];
};

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

/** 依發薪月份建議對應半年期別：7–8 月 → 當年上半年；1–2 月 → 上一年下半年 */
export function suggestBonusPeriodForPayMonth(
  ym: string,
): { year: number; half: "H1" | "H2"; label: string } | null {
  const p = parseYm(ym);
  if (!p) return null;
  if (p.m >= 7 && p.m <= 8) {
    return { year: p.y, half: "H1", label: halfYearLabel(p.y, "H1") };
  }
  if (p.m >= 1 && p.m <= 2) {
    return { year: p.y - 1, half: "H2", label: halfYearLabel(p.y - 1, "H2") };
  }
  return null;
}

/** 從薪資單 notes 還原獎金合計（舊資料未寫 payroll_bonus 欄時用） */
export function parsePayrollBonusFromNotes(notes: string | null | undefined): number {
  const text = (notes ?? "").trim();
  if (!text || !/【.+獎金】/.test(text)) return 0;
  const m = /合計\s*NT\$\s*([\d,]+)/.exec(text);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** 備註欄的獎金說明行格式，如「2026年上半年度獎金24,600元」（帶入時去重用） */
export const SEMI_ANNUAL_BONUS_REMARK_RE = /^\d{4}年[上下]半年度獎金[\d,]+元$/;

export function formatSemiAnnualBonusRemark(
  period: { year: number; half: "H1" | "H2" },
  amount: number,
): string {
  const halfLabel = period.half === "H1" ? "上" : "下";
  return `${period.year}年${halfLabel}半年度獎金${Math.round(amount).toLocaleString("zh-TW")}元`;
}

export function formatSemiAnnualBonusPayrollNote(
  periodLabel: string,
  detail: SemiAnnualBonusDetail,
): string {
  const parts: string[] = [];
  if (detail.yearEnd > 0) {
    parts.push(`年終 NT$ ${detail.yearEnd.toLocaleString("zh-TW")}`);
  }
  if (detail.profitSharing > 0) {
    parts.push(`考績分潤 NT$ ${detail.profitSharing.toLocaleString("zh-TW")}`);
  }
  if (detail.share > 0) {
    parts.push(`股份 NT$ ${detail.share.toLocaleString("zh-TW")}`);
  }
  const breakdown = parts.length > 0 ? `${parts.join("、")}，` : "";
  return `【${periodLabel}獎金】${breakdown}合計 NT$ ${detail.total.toLocaleString("zh-TW")}`;
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function formatIssuedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short", hour12: false });
}

/**
 * 帶入薪資的獎金一律讀「考績獎金」的發放紀錄，不重算：
 * 毛利與草稿設定會隨時間變動，重算會與已記錄的發放金額對不上。
 */
export async function loadSemiAnnualBonusesForPayroll(
  payPeriodYm: string,
  options?: { year?: number; half?: "H1" | "H2" },
): Promise<SemiAnnualBonusImportResult | { error: string }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase 尚未設定，無法讀取獎金發放紀錄。" };
  }

  const wanted =
    options?.year != null && (options.half === "H1" || options.half === "H2")
      ? { year: options.year, half: options.half }
      : suggestBonusPeriodForPayMonth(payPeriodYm);

  let query = supabase
    .from("performance_bonus_issuances")
    .select(ISSUANCE_SELECT)
    .order("issued_at", { ascending: false })
    .limit(1);
  if (wanted) {
    query = query.eq("year", wanted.year).eq("half", wanted.half);
  }

  const res = await query;
  if (res.error) return { error: res.error.message };

  const rec = (res.data ?? [])[0] as IssuanceQueryRow | undefined;
  if (!rec) {
    return {
      error: wanted
        ? `尚無「${halfYearLabel(wanted.year, wanted.half)}」的獎金發放紀錄，請先至「考績獎金」分頁按「確定發放」再回來帶入。`
        : "尚無任何獎金發放紀錄，請先至「考績獎金」分頁按「確定發放」。",
    };
  }

  const half: "H1" | "H2" = rec.half === "H2" ? "H2" : "H1";
  const period = { year: rec.year, half, label: halfYearLabel(rec.year, half) };

  const bonusesByEmployeeId: Record<string, number> = {};
  const detailByEmployeeId: Record<string, SemiAnnualBonusDetail> = {};
  for (const row of rec.performance_bonus_issuance_rows ?? []) {
    if (!row.employee_id) continue;
    bonusesByEmployeeId[row.employee_id] = num(row.total_bonus);
    detailByEmployeeId[row.employee_id] = {
      yearEnd: num(row.year_end_bonus),
      profitSharing: num(row.profit_sharing_bonus),
      share: num(row.share_bonus),
      total: num(row.total_bonus),
    };
  }

  return {
    period,
    bonusesByEmployeeId,
    detailByEmployeeId,
    issuanceMeta: `發放紀錄 ${formatIssuedAt(rec.issued_at)}；當期利潤 NT$ ${num(rec.profit).toLocaleString("zh-TW")}`,
    usedFallbackPeriod: !wanted,
  };
}
