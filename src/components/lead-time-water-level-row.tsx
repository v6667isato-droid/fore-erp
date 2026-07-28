"use client";

/**
 * 訂單水位條（單列）：以「月數負載」為單位的共用元件。
 * ERP 總覽（含 admin 金額）與通路商下單頁（無金額）共用；
 * 通路端由 /api/portal/lead-time 提供去金額化的月數資料。
 */

/** 滿水位＝當月起 4 個月（一季）的產能 */
export const LEAD_TIME_SCALE_MONTHS = 4;

/** 當月起連續 monthCount 個月的「N月」標籤 */
export function upcomingMonthLabels(monthCount: number = LEAD_TIME_SCALE_MONTHS): string[] {
  const now = new Date();
  return Array.from({ length: monthCount }, (_, i) => `${((now.getMonth() + i) % 12) + 1}月`);
}

export interface LeadTimeWaterLevelRowProps {
  label: string;
  sublabel?: string;
  /** 水位負載（月）＝backlog ÷ 月產能 */
  monthsLoad: number;
  /** 基準交期（月）；水位超過此線的部分以警示色顯示 */
  baseMonths: number;
  /** 對外交期（月，已進位到 0.5） */
  displayMonths: number;
  /** 有值才顯示金額列（ERP admin 專用） */
  amountText?: string;
  /** 有值才掛 hover 公式細節（ERP admin 專用） */
  detailTitle?: string;
}

export function LeadTimeWaterLevelRow({
  label,
  sublabel,
  monthsLoad,
  baseMonths,
  displayMonths,
  amountText,
  detailTitle,
}: LeadTimeWaterLevelRowProps) {
  // 刻度＝當月起 4 個月，每格一個月；超過基準交期的水位以警示色顯示
  const cappedLoad = Math.max(0, Math.min(monthsLoad, LEAD_TIME_SCALE_MONTHS));
  const cappedBase = Math.min(Math.max(baseMonths, 0), LEAD_TIME_SCALE_MONTHS);
  const normalPct = (Math.min(cappedLoad, cappedBase) / LEAD_TIME_SCALE_MONTHS) * 100;
  const excessPct = (Math.max(0, cappedLoad - cappedBase) / LEAD_TIME_SCALE_MONTHS) * 100;
  const overloaded = monthsLoad > cappedBase;
  const monthLabels = upcomingMonthLabels(LEAD_TIME_SCALE_MONTHS);

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-baseline justify-between gap-2 sm:w-40 sm:shrink-0 sm:flex-col sm:gap-0.5">
        <span className="text-xs font-medium text-foreground">
          {label}
          {sublabel && (
            <span className="ml-1 text-[9px] font-normal text-muted-foreground">{sublabel}</span>
          )}
        </span>
        {amountText && (
          <span className="text-xs font-semibold text-foreground">{amountText}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
          <div className="absolute inset-y-0 left-0 flex w-full">
            <div
              className="h-full bg-[var(--badge-progress)] transition-all"
              style={{ width: `${normalPct}%` }}
            />
            {excessPct > 0 && (
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${excessPct}%` }} />
            )}
          </div>
          {/* 月分隔線（每格＝一個月產能） */}
          {monthLabels.slice(1).map((_, i) => (
            <div
              key={i}
              className="absolute inset-y-0 w-px bg-foreground/30"
              style={{ left: `${((i + 1) / LEAD_TIME_SCALE_MONTHS) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex text-[9px] text-muted-foreground">
          {monthLabels.map((m) => (
            <span key={m} className="w-1/4 text-center">
              {m}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 text-xs text-foreground sm:w-36 sm:text-right" title={detailTitle}>
        預估交期：
        <span className={`font-semibold ${overloaded ? "text-amber-600 dark:text-amber-400" : ""}`}>
          {displayMonths.toFixed(1)} 個月
        </span>
      </div>
    </div>
  );
}
