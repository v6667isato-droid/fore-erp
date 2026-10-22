"use client";

import { useCallback, useId, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/components/investments/invest-ui";

/** 圖表配色：類別固定（台股藍、美股橘，每張圖一致），漲跌照台股慣例（紅漲綠跌） */
export const chartColors = {
  twFill: "fill-[#2a78d6] dark:fill-[#3987e5]",
  twBg: "bg-[#2a78d6] dark:bg-[#3987e5]",
  usFill: "fill-[#eb6834] dark:fill-[#d95926]",
  usBg: "bg-[#eb6834] dark:bg-[#d95926]",
  otherBg: "bg-[#b8b6ae] dark:bg-[#6b6a64]",
  valueStroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
  valueFill: "fill-[#2a78d6] dark:fill-[#3987e5]",
  valueBg: "bg-[#2a78d6] dark:bg-[#3987e5]",
  costStroke: "stroke-[#898781]",
  costFill: "fill-[#898781]",
  costBg: "bg-[#898781]",
  gainFill: "fill-[#e34948]",
  lossFill: "fill-[#008300] dark:fill-[#2fa84f]",
  grid: "stroke-border",
  baseline: "stroke-[#c3c2b7] dark:stroke-[#55534e]",
  axisText: "fill-muted-foreground text-[11px] tabular-nums",
  /** 資料點外圈（與卡片底色相同，重疊時分得開） */
  ring: "stroke-card",
};

/** 量測元素寬度（圖表依實際寬度重畫，文字才不會被縮放） */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** 正數加「+」的金額（台幣到元） */
export function formatSignedMoney(n: number): string {
  return `${n > 0 ? "+" : ""}${formatMoney(n)}`;
}

/** 頂端圓角的長條（資料端 4px 圓角，貼齊基準線的一端維持直角） */
export function roundedTopPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** 底端圓角的長條（負值往下長） */
export function roundedBottomPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y}H${x + w}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x + rr}Q${x},${y + h} ${x},${y + h - rr}Z`;
}

export function ChartCard({
  title,
  subtitle,
  actions,
  footnote,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footnote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );
}

/** 圖表／表格切換 */
export function TableToggle({ showTable, onChange }: { showTable: boolean; onChange: (showTable: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!showTable)}
      aria-pressed={showTable}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {showTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
      {showTable ? "圖表" : "表格"}
    </button>
  );
}

/** 小型分段選擇（例如股利的月／年） */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 min-w-9 rounded px-2.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
            value === o.value
              ? "border border-border bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LegendItem({ label, swatchClassName, line = false }: { label: string; swatchClassName: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn(line ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-[3px]", swatchClassName)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** 滑過圖表時的數字框 */
export function ChartTooltip({ left, top = 8, children }: { left: number; top?: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 w-44 space-y-1.5 rounded-lg border border-border bg-card p-2.5 text-xs shadow-lg"
      style={{ left, top }}
      role="presentation"
    >
      {children}
    </div>
  );
}

export function TooltipRow({
  label,
  value,
  swatchClassName,
  line = false,
  valueClassName,
}: {
  label: string;
  value: string;
  swatchClassName?: string;
  line?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {swatchClassName && (
          <span className={cn(line ? "h-0.5 w-3 rounded-full" : "h-2 w-2 rounded-[2px]", swatchClassName)} aria-hidden="true" />
        )}
        {label}
      </span>
      <span className={cn("font-semibold tabular-nums text-foreground", valueClassName)}>{value}</span>
    </div>
  );
}

/** 浮動數字框的 left：預設放在 x 右邊，超出容器時改放左邊 */
export function tooltipLeft(x: number, containerWidth: number, tooltipWidth = 176, gap = 12): number {
  if (x + gap + tooltipWidth <= containerWidth) return x + gap;
  return Math.max(0, x - gap - tooltipWidth);
}
