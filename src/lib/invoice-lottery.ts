/**
 * 統一發票兌獎（純邏輯，無外部依賴）
 *
 * 家庭發票＝無買方統編的發票，可參加統一發票給獎。中獎號碼每 2 個月一期，
 * 於期別結束後次月 25 日開獎（如 5~6 月期在 7/25 開獎）。
 */

/** 一期的中獎號碼 */
export interface InvoiceLotteryDraw {
  /** 期別起月（西元 YYYY-MM，奇數月）：'2026-05' = 115年 05~06月 */
  period: string;
  /** 民國期別標籤，如 '115年 05~06月' */
  label: string;
  /** 特別獎（8 碼全對） */
  special_prize: string;
  /** 特獎（8 碼全對） */
  grand_prize: string;
  /** 頭獎號碼（通常 3 組）；末 8~3 碼相符對應頭獎至六獎 */
  first_prizes: string[];
  /** 增開六獎（末 3 碼，部分期別才有） */
  sixth_extra_prizes: string[];
  source_url?: string | null;
  synced_at?: string | null;
}

export type LotteryPrizeLevel =
  | "special"
  | "grand"
  | "first"
  | "second"
  | "third"
  | "fourth"
  | "fifth"
  | "sixth"
  | "sixth_extra";

/** 各獎項名稱與獎金（統一發票給獎辦法） */
export const LOTTERY_PRIZE_INFO: Record<LotteryPrizeLevel, { label: string; amount: number }> = {
  special: { label: "特別獎", amount: 10_000_000 },
  grand: { label: "特獎", amount: 2_000_000 },
  first: { label: "頭獎", amount: 200_000 },
  second: { label: "二獎", amount: 40_000 },
  third: { label: "三獎", amount: 10_000 },
  fourth: { label: "四獎", amount: 4_000 },
  fifth: { label: "五獎", amount: 1_000 },
  sixth: { label: "六獎", amount: 200 },
  sixth_extra: { label: "增開六獎", amount: 200 },
};

/** 與頭獎號碼相同的末幾碼 → 獎項 */
const SUFFIX_PRIZE_LEVELS: Record<number, LotteryPrizeLevel> = {
  8: "first",
  7: "second",
  6: "third",
  5: "fourth",
  4: "fifth",
  3: "sixth",
};

/** 發票號碼取出用來對獎的 8 碼數字（`AB-12345678` → `12345678`）；格式不符為 null */
export function invoiceLotteryDigits(invoiceNumber: string | null | undefined): string | null {
  const digits = (invoiceNumber ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

/** 發票日期（YYYY-MM-DD）所屬期別起月；日期無效為 null */
export function lotteryPeriodOfDate(invoiceDate: string | null | undefined): string | null {
  const m = (invoiceDate ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  // 1-2 月 → 01、3-4 月 → 03…（期別一律以奇數月起算）
  const startMonth = month % 2 === 1 ? month : month - 1;
  return `${m[1]}-${String(startMonth).padStart(2, "0")}`;
}

/** 期別的民國標籤，如 '2026-05' → '115年 05~06月' */
export function lotteryPeriodLabel(period: string): string {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return period;
  const rocYear = Number(m[1]) - 1911;
  const start = Number(m[2]);
  return `${rocYear}年 ${String(start).padStart(2, "0")}~${String(start + 1).padStart(2, "0")}月`;
}

/** 該期開獎日（期別結束後次月 25 日，YYYY-MM-DD） */
export function lotteryDrawDate(period: string): string | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]) + 2;
  if (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-25`;
}

/** 該期是否已到開獎日（today 為 YYYY-MM-DD） */
export function lotteryDrawAnnounced(period: string, today: string): boolean {
  const date = lotteryDrawDate(period);
  return date != null && today >= date;
}

/** 對中的獎項 */
export interface LotteryPrize {
  level: LotteryPrizeLevel;
  label: string;
  amount: number;
  /** 對中的中獎號碼（特別獎／特獎為該號；末幾碼中獎為對應頭獎號） */
  matched: string;
}

/** 單張發票對單期中獎號碼；未中獎為 null */
export function checkInvoiceLottery(
  invoiceNumber: string | null | undefined,
  draw: InvoiceLotteryDraw,
): LotteryPrize | null {
  const digits = invoiceLotteryDigits(invoiceNumber);
  if (!digits) return null;

  const prize = (level: LotteryPrizeLevel, matched: string): LotteryPrize => ({
    level,
    ...LOTTERY_PRIZE_INFO[level],
    matched,
  });

  if (digits === draw.special_prize) return prize("special", draw.special_prize);
  if (digits === draw.grand_prize) return prize("grand", draw.grand_prize);

  // 末幾碼與任一頭獎號相同（取相符碼數最多者）
  let bestLen = 0;
  let bestNumber = "";
  for (const raw of draw.first_prizes ?? []) {
    const target = (raw ?? "").replace(/\D/g, "");
    if (target.length !== 8) continue;
    let len = 0;
    while (len < 8 && digits[7 - len] === target[7 - len]) len += 1;
    if (len > bestLen) {
      bestLen = len;
      bestNumber = target;
    }
  }
  if (bestLen >= 3) return prize(SUFFIX_PRIZE_LEVELS[bestLen], bestNumber);

  // 增開六獎（末 3 碼）
  for (const raw of draw.sixth_extra_prizes ?? []) {
    const target = (raw ?? "").replace(/\D/g, "");
    if (target.length === 3 && digits.endsWith(target)) return prize("sixth_extra", target);
  }
  return null;
}

export type LotteryOutcome =
  /** 中獎 */
  | { state: "won"; period: string; prize: LotteryPrize }
  /** 已開獎、未中獎 */
  | { state: "lost"; period: string }
  /** 該期尚未開獎 */
  | { state: "pending"; period: string; drawDate: string | null }
  /** 已開獎但本機尚無該期號碼（需同步） */
  | { state: "no_data"; period: string }
  /** 發票號碼或日期不完整，無法對獎 */
  | { state: "unknown" };

/** 依發票號碼＋日期對獎；draws 為期別→中獎號碼 */
export function evaluateInvoiceLottery(
  invoiceNumber: string | null | undefined,
  invoiceDate: string | null | undefined,
  draws: Map<string, InvoiceLotteryDraw>,
  today: string,
): LotteryOutcome {
  const digits = invoiceLotteryDigits(invoiceNumber);
  const period = lotteryPeriodOfDate(invoiceDate);
  if (!digits || !period) return { state: "unknown" };
  const draw = draws.get(period);
  if (!draw) {
    return lotteryDrawAnnounced(period, today)
      ? { state: "no_data", period }
      : { state: "pending", period, drawDate: lotteryDrawDate(period) };
  }
  const prize = checkInvoiceLottery(digits, draw);
  return prize ? { state: "won", period, prize } : { state: "lost", period };
}

/** 財政部中獎號碼 RSS（只提供最近 6 期） */
export const LOTTERY_FEED_URL = "https://invoice.etax.nat.gov.tw/invoice.xml";

function cdataText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : "";
}

/**
 * 解析財政部中獎號碼 RSS。
 * item 格式：title=`115年 05~06月`、description=`<p>特別獎：…</p><p>特獎：…</p><p>頭獎：…、…、…</p>`
 */
export function parseLotteryFeed(xml: string): InvoiceLotteryDraw[] {
  const out: InvoiceLotteryDraw[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = cdataText(block, "title");
    const link = cdataText(block, "link");
    const description = cdataText(block, "description");

    // 期別：優先用 title（115年 05~06月），退回 link 尾碼（…_11505）
    let rocYear = 0;
    let startMonth = 0;
    const t = title.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*[~～-]\s*(\d{1,2})\s*月/);
    if (t) {
      rocYear = Number(t[1]);
      startMonth = Number(t[2]);
    } else {
      const l = link.match(/_(\d{3})(\d{2})$/);
      if (!l) continue;
      rocYear = Number(l[1]);
      startMonth = Number(l[2]);
    }
    if (!rocYear || startMonth < 1 || startMonth > 12) continue;
    if (startMonth % 2 === 0) startMonth -= 1;
    const period = `${rocYear + 1911}-${String(startMonth).padStart(2, "0")}`;

    // 逐段（<p>…</p> 或換行）取「獎項：號碼、號碼」
    const segments = description
      .replace(/<[^>]*>/g, "\n")
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    let special = "";
    let grand = "";
    const firsts: string[] = [];
    const sixthExtra: string[] = [];
    for (const seg of segments) {
      const sm = seg.match(/^([^:：]+)[:：]\s*(.+)$/);
      if (!sm) continue;
      const name = sm[1].replace(/\s+/g, "");
      const numbers = sm[2].match(/\d{3,8}/g) ?? [];
      if (numbers.length === 0) continue;
      if (name.includes("增開")) sixthExtra.push(...numbers.filter((n) => n.length === 3));
      else if (name.includes("特別獎")) special = numbers[0] ?? "";
      else if (name.includes("特獎")) grand = numbers[0] ?? "";
      else if (name.includes("頭獎")) firsts.push(...numbers.filter((n) => n.length === 8));
    }
    if (!/^\d{8}$/.test(special) || !/^\d{8}$/.test(grand)) continue;

    out.push({
      period,
      label: lotteryPeriodLabel(period),
      special_prize: special,
      grand_prize: grand,
      first_prizes: firsts,
      sixth_extra_prizes: sixthExtra,
      source_url: link || null,
    });
  }
  return out;
}
