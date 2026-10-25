"use client";

import { useState } from "react";
import { Cell, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
import { formatTwdShort, monthEnds, niceScale, timeTicks, type ValuePoint } from "@/lib/invest-charts";
import { formatMoney, formatPercent, formatSignedMoney, pnlClass } from "@/components/investments/invest-ui";
import {
  ChartCard,
  chartColors,
  ChartTooltip,
  LegendItem,
  TableToggle,
  TooltipRow,
  tooltipLeft,
  useElementWidth,
} from "@/components/investments/chart-ui";

function formatDate(date: string): string {
  return date.replaceAll("-", "/");
}

function returnRate(p: ValuePoint): number | null {
  return p.cost > 0 ? (p.marketValue - p.cost) / p.cost : null;
}

export type TrendStatus = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

/** 總資產走勢：市值（藍線＋淡色面積）與持股成本（灰線），兩線差距就是未實現損益 */
export function TrendCard({
  points,
  latest,
  status,
}: {
  /** 期間內的每日資料點 */
  points: ValuePoint[];
  /** 最近一個交易日（不受期間影響） */
  latest: ValuePoint | null;
  status: TrendStatus;
}) {
  const [showTable, setShowTable] = useState(false);
  const hasUnpriced = points.some((p) => p.unpriced > 0);

  return (
    <ChartCard
      title="總資產走勢"
      actions={
        <>
          <LegendItem label="市值" swatchClassName={chartColors.valueBg} line />
          <LegendItem label="持股成本" swatchClassName={chartColors.costBg} line />
          <TableToggle showTable={showTable} onChange={setShowTable} />
        </>
      }
      footnote={
        <>
          每個交易日收盤後更新；市值＝當天收盤價 × 當時持股（拆股前依拆股紀錄換算），美股依當天匯率換算台幣。
          {hasUnpriced && " 部分日期有持股沒有歷史價格，以成本計。"}
        </>
      }
    >
      {latest && (
        <div className="space-y-1">
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">
            NT$ {formatMoney(latest.marketValue)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>持股成本 NT$ {formatMoney(latest.cost)}</span>
            <span>
              未實現損益{" "}
              <span className={`font-semibold ${pnlClass(latest.marketValue - latest.cost)}`}>
                {formatSignedMoney(latest.marketValue - latest.cost)}（{formatPercent(returnRate(latest))}）
              </span>
            </span>
            <span>{formatDate(latest.date).slice(5)} 收盤</span>
          </div>
        </div>
      )}

      {status.kind === "loading" ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">讀取歷史收盤價中…</div>
      ) : status.kind === "error" ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          讀取歷史收盤價失敗：{status.message}。需要先在個人投資資料庫執行
          supabase-invest/migrations/20261022140000_invest_price_history.sql（步驟見 README）。
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">這段期間沒有資料</div>
      ) : showTable ? (
        <TrendTable points={points} />
      ) : (
        <TrendPlot points={points} />
      )}
    </ChartCard>
  );
}

function TrendPlot({ points }: { points: ValuePoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const narrow = width > 0 && width < 560;
  const height = narrow ? 220 : 300;
  const n = points.length;
  const activeIndex = active != null && active < n ? active : null;

  const m = { top: 12, right: narrow ? 8 : 96, bottom: 26, left: 52 };
  const plotW = Math.max(width - m.left - m.right, 10);
  const plotH = height - m.top - m.bottom;
  const scale = niceScale(0, Math.max(...points.map((p) => Math.max(p.marketValue, p.cost))), 4);
  const x = (i: number) => m.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => m.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
  const linePath = (pick: (p: ValuePoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join("");
  const valueLine = linePath((p) => p.marketValue);
  const areaPath = `${valueLine}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = timeTicks(
    points.map((p) => p.date),
    Math.floor(plotW / (narrow ? 64 : 84)),
    narrow
  );

  const last = points[n - 1];
  let labelValueY = y(last.marketValue) + 4;
  let labelCostY = y(last.cost) + 4;
  if (Math.abs(labelValueY - labelCostY) < 16) {
    // 兩條線終點太近時把標籤上下錯開
    const mid = (labelValueY + labelCostY) / 2;
    const valueOnTop = last.marketValue >= last.cost;
    labelValueY = valueOnTop ? mid - 8 : mid + 8;
    labelCostY = valueOnTop ? mid + 8 : mid - 8;
  }

  function pick(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    setActive(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))));
  }

  const shown = activeIndex ?? n - 1;
  const shownPoint = points[shown];
  const shownPnl = shownPoint.marketValue - shownPoint.cost;

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className="block overflow-visible"
            role="img"
            aria-label={`總資產走勢：${formatDate(points[0].date)} 到 ${formatDate(last.date)}，目前市值 ${formatMoney(last.marketValue)} 元、持股成本 ${formatMoney(last.cost)} 元`}
          >
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? chartColors.baseline : chartColors.grid} />
                <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className={chartColors.axisText}>
                  {formatTwdShort(t)}
                </text>
              </g>
            ))}
            {ticks.map((t) => (
              <text key={t.index} x={x(t.index)} y={height - 8} textAnchor="middle" className={chartColors.axisText}>
                {t.label}
              </text>
            ))}
            <path d={areaPath} className={chartColors.valueFill} fillOpacity={0.1} />
            <path
              d={linePath((p) => p.cost)}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={chartColors.costStroke}
            />
            <path d={valueLine} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={chartColors.valueStroke} />

            {!narrow && (
              <g>
                <circle cx={x(n - 1)} cy={y(last.cost)} r={4} strokeWidth={2} className={`${chartColors.costFill} ${chartColors.ring}`} />
                <circle cx={x(n - 1)} cy={y(last.marketValue)} r={4} strokeWidth={2} className={`${chartColors.valueFill} ${chartColors.ring}`} />
                <text x={x(n - 1) + 10} y={labelValueY} className="fill-foreground text-xs font-semibold tabular-nums">
                  市值 {formatTwdShort(last.marketValue)}
                </text>
                <text x={x(n - 1) + 10} y={labelCostY} className="fill-muted-foreground text-xs tabular-nums">
                  成本 {formatTwdShort(last.cost)}
                </text>
              </g>
            )}

            {activeIndex != null && (
              <g>
                <line
                  x1={x(activeIndex)}
                  x2={x(activeIndex)}
                  y1={m.top}
                  y2={m.top + plotH}
                  strokeWidth={1}
                  className="stroke-foreground/35"
                />
                <circle cx={x(activeIndex)} cy={y(points[activeIndex].cost)} r={4} strokeWidth={2} className={`${chartColors.costFill} ${chartColors.ring}`} />
                <circle
                  cx={x(activeIndex)}
                  cy={y(points[activeIndex].marketValue)}
                  r={4}
                  strokeWidth={2}
                  className={`${chartColors.valueFill} ${chartColors.ring}`}
                />
              </g>
            )}

            <rect
              x={m.left}
              y={m.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              style={{ touchAction: "pan-y" }}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setActive(null);
              }}
            />
          </svg>
        )}
        {!narrow && activeIndex != null && (
          <ChartTooltip left={tooltipLeft(x(activeIndex), width)}>
            <div className="text-muted-foreground">{formatDate(shownPoint.date)}</div>
            <TooltipRow label="市值" value={formatMoney(shownPoint.marketValue)} swatchClassName={chartColors.valueBg} line />
            <TooltipRow label="持股成本" value={formatMoney(shownPoint.cost)} swatchClassName={chartColors.costBg} line />
            <div className="border-t border-border pt-1.5">
              <TooltipRow label="未實現損益" value={formatSignedMoney(shownPnl)} valueClassName={pnlClass(shownPnl)} />
            </div>
          </ChartTooltip>
        )}
      </div>

      {narrow && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
          <div className="col-span-3 text-muted-foreground">
            {formatDate(shownPoint.date)}
            {activeIndex == null && "（點選或左右拖曳圖表看每天的數字）"}
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground">市值</div>
            <div className="font-semibold tabular-nums">{formatTwdShort(shownPoint.marketValue)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground">持股成本</div>
            <div className="font-semibold tabular-nums">{formatTwdShort(shownPoint.cost)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground">未實現</div>
            <div className={`font-semibold tabular-nums ${pnlClass(shownPnl)}`}>
              {shownPnl > 0 ? "+" : ""}
              {formatTwdShort(shownPnl)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendTable({ points }: { points: ValuePoint[] }) {
  const rows = monthEnds(points).reverse();
  return (
    <InvestTable minWidth={560} className="max-h-96 rounded-lg border border-border">
      <thead>
        <tr>
          <HeadCell sticky>日期（每月最後交易日）</HeadCell>
          <HeadCell align="right">市值</HeadCell>
          <HeadCell align="right">持股成本</HeadCell>
          <HeadCell align="right">未實現損益</HeadCell>
          <HeadCell align="right">報酬率</HeadCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const pnl = p.marketValue - p.cost;
          return (
            <Row key={p.date}>
              <Cell sticky className="tabular-nums">{formatDate(p.date)}</Cell>
              <Cell align="right">{formatMoney(p.marketValue)}</Cell>
              <Cell align="right">{formatMoney(p.cost)}</Cell>
              <Cell align="right" className={pnlClass(pnl)}>{formatSignedMoney(pnl)}</Cell>
              <Cell align="right" className={pnlClass(pnl)}>{formatPercent(returnRate(p))}</Cell>
            </Row>
          );
        })}
      </tbody>
    </InvestTable>
  );
}
