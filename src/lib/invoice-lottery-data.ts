import { supabase, getSupabaseSession } from "@/lib/supabase";
import { lotteryDrawAnnounced, lotteryPeriodOfDate, type InvoiceLotteryDraw } from "@/lib/invoice-lottery";

/** 讀取本機保存的各期中獎號碼（期別 → 號碼） */
export async function fetchLotteryDraws(): Promise<Map<string, InvoiceLotteryDraw>> {
  const { data, error } = await supabase
    .from("invoice_lottery_draws")
    .select("period, label, special_prize, grand_prize, first_prizes, sixth_extra_prizes, source_url, synced_at")
    .order("period", { ascending: false });
  if (error) {
    console.error("中獎號碼讀取失敗:", error.message);
    return new Map();
  }
  const map = new Map<string, InvoiceLotteryDraw>();
  for (const row of (data ?? []) as unknown as InvoiceLotteryDraw[]) map.set(row.period, row);
  return map;
}

export interface LotterySyncResult {
  ok: boolean;
  periods: string[];
  latest?: string | null;
  error?: string;
}

/** 呼叫 API 自財政部同步最近 6 期中獎號碼 */
export async function syncLotteryDraws(): Promise<LotterySyncResult> {
  const {
    data: { session },
  } = await getSupabaseSession();
  const token = session?.access_token;
  if (!token) return { ok: false, periods: [], error: "尚未登入，請重新登入後再試" };
  try {
    const res = await fetch("/api/invoice-lottery", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      return { ok: true, periods: Array.isArray(json.periods) ? json.periods : [], latest: json.latest ?? null };
    }
    return { ok: false, periods: [], error: json?.error || "中獎號碼同步失敗" };
  } catch (err) {
    console.error(err);
    return { ok: false, periods: [], error: err instanceof Error ? err.message : "中獎號碼同步失敗" };
  }
}

/**
 * 這些發票日期中，已到開獎日卻還沒有中獎號碼的期別。
 * 有缺漏才需要打 API 同步（每次進入頁面只做一次）。
 */
export function missingAnnouncedPeriods(
  invoiceDates: (string | null)[],
  draws: Map<string, InvoiceLotteryDraw>,
  today: string,
): string[] {
  const missing = new Set<string>();
  for (const date of invoiceDates) {
    const period = lotteryPeriodOfDate(date);
    if (!period || draws.has(period)) continue;
    if (lotteryDrawAnnounced(period, today)) missing.add(period);
  }
  return [...missing].sort((a, b) => b.localeCompare(a));
}
