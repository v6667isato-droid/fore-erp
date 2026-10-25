"use client";

import { useState } from "react";
import { Cell, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
import { formatTwdShort, niceScale, type DividendBucket } from "@/lib/invest-charts";
import { formatMoney, Segmented } from "@/components/investments/invest-ui";
import {
  ChartCard,
  chartColors,
  ChartTooltip,
  LegendItem,
  roundedTopPath,
  TableToggle,
  TooltipRow,
  tooltipLeft,
  useElementWidth,
} from "@/components/investments/chart-ui";

export type DividendView = "month" | "year";

function bucketLabel(key: string, long = false): string {
  if (key.length === 4) return long ? `${key} 年` : key;
  return long ? `${key.slice(0, 4)} 年 ${key.slice(5)} 月` : `${key.slice(2, 4)}/${key.slice(5)}`;
}

/** 股利收入：台股、美股疊在同一根長條，可切換月／年 */
export function DividendChartCard({
  buckets,
  view,
  onViewChange,
  total,
  markets,
}: {
  buckets: DividendBucket[];
  view: DividendView;
  onViewChange: (view: DividendView) => void;
  /** 累計實收（全部期間） */
  total: number;
  /** 篩選範圍內有哪些市場；兩個都有時才分台股／美股 */
  markets: { tw: boolean; us: boolean };
}) {
  const [showTable, setShowTable] = useState(false);
  const split = markets.tw && markets.us;
  const isEmpty = buckets.every((b) => b.tw === 0 && b.us === 0);
  return (
    <ChartCard
      title="股利收入"
      subtitle={`累計實收 NT$ ${formatMoney(total)}`}
      actions={
        <>
          <Segmented
            label="股利檢視"
            options={[
              { value: "month", label: "月" },
              { value: "year", label: "年" },
            ]}
            value={view}
            onChange={onViewChange}
          />
          <TableToggle showTable={showTable} onChange={setShowTable} />
        </>
      }
      footnote={`已入帳的實收金額（${[markets.tw && "已扣補充保費", markets.us && "已扣美股 30% 預扣稅"].filter(Boolean).join("、")}），依除息月份${markets.us ? "；美股依除息日匯率換算台幣" : ""}。`}
    >
      {split && (
        <div className="flex flex-wrap gap-3">
          <LegendItem label="台股" swatchClassName={chartColors.twBg} />
          <LegendItem label="美股" swatchClassName={chartColors.usBg} />
        </div>
      )}
      {isEmpty ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">這段期間沒有已入帳的股利</div>
      ) : showTable ? (
        <InvestTable minWidth={360} className="max-h-80 rounded-lg border border-border">
          <thead>
            <tr>
              <HeadCell sticky>{view === "month" ? "除息月份" : "年度"}</HeadCell>
              {split && <HeadCell align="right">台股</HeadCell>}
              {split && <HeadCell align="right">美股</HeadCell>}
              <HeadCell align="right">合計</HeadCell>
            </tr>
          </thead>
          <tbody>
            {[...buckets]
              .reverse()
              .filter((b) => b.tw !== 0 || b.us !== 0)
              .map((b) => (
                <Row key={b.key}>
                  <Cell sticky className="tabular-nums">{bucketLabel(b.key, true)}</Cell>
                  {split && <Cell align="right">{formatMoney(b.tw)}</Cell>}
                  {split && <Cell align="right">{formatMoney(b.us)}</Cell>}
                  <Cell align="right" className="font-medium">{formatMoney(b.tw + b.us)}</Cell>
                </Row>
              ))}
          </tbody>
        </InvestTable>
      ) : (
        <DividendPlot buckets={buckets} view={view} split={split} />
      )}
    </ChartCard>
  );
}

function DividendPlot({ buckets, view, split }: { buckets: DividendBucket[]; view: DividendView; split: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const narrow = width > 0 && width < 420;
  const height = narrow ? 200 : 240;
  const activeIndex = active != null && active < buckets.length ? active : null;

  const m = { top: 20, right: 4, bottom: 24, left: 48 };
  const plotW = Math.max(width - m.left - m.right, 10);
  const plotH = height - m.top - m.bottom;
  const totals = buckets.map((b) => b.tw + b.us);
  const scale = niceScale(0, Math.max(...totals), 4);
  const y = (v: number) => m.top + plotH - (v / scale.max) * plotH;
  const band = plotW / buckets.length;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const maxIndex = totals.indexOf(Math.max(...totals));
  // 月份太多放不下時每隔幾個月標一次，從最近的月份往回對齊
  const axisEvery = view === "year" ? 1 : Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 48))));
  const base = m.top + plotH;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="股利收入長條圖，數字見表格檢視">
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? chartColors.baseline : chartColors.grid} />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className={chartColors.axisText}>
                {formatTwdShort(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x0 = m.left + i * band + (band - barW) / 2;
            const hTw = (b.tw / scale.max) * plotH;
            const hUs = (b.us / scale.max) * plotH;
            const gap = hTw > 0 && hUs > 0 ? 2 : 0;
            const top = base - hTw - gap - hUs;
            const dimmed = activeIndex != null && activeIndex !== i;
            // 月檢視只標最高的月份，避免整張圖都是數字；年檢視每年都標
            const showLabel = (view === "year" || i === maxIndex) && totals[i] > 0;
            return (
              <g key={b.key} opacity={dimmed ? 0.45 : 1}>
                {hTw > 0 &&
                  (hUs > 0 ? (
                    <rect x={x0} y={base - hTw} width={barW} height={hTw} className={chartColors.twFill} />
                  ) : (
                    <path d={roundedTopPath(x0, base - hTw, barW, hTw)} className={chartColors.twFill} />
                  ))}
                {hUs > 0 && <path d={roundedTopPath(x0, top, barW, hUs)} className={chartColors.usFill} />}
                {showLabel && (
                  <text x={x0 + barW / 2} y={top - 6} textAnchor="middle" className="fill-foreground text-[11px] font-semibold tabular-nums">
                    {narrow ? formatTwdShort(totals[i]) : formatMoney(totals[i])}
                  </text>
                )}
                {(buckets.length - 1 - i) % axisEvery === 0 && (
                  <text x={m.left + i * band + band / 2} y={height - 6} textAnchor="middle" className={chartColors.axisText}>
                    {bucketLabel(b.key)}
                  </text>
                )}
              </g>
            );
          })}
          {buckets.map((b, i) => (
            <rect
              key={b.key}
              x={m.left + i * band}
              y={m.top}
              width={band}
              height={plotH}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setActive(null);
              }}
            />
          ))}
        </svg>
      )}
      {activeIndex != null && (
        <ChartTooltip left={tooltipLeft(m.left + activeIndex * band + band / 2, width)} top={0}>
          <div className="text-muted-foreground">{bucketLabel(buckets[activeIndex].key, true)}</div>
          {split && <TooltipRow label="台股" value={formatMoney(buckets[activeIndex].tw)} swatchClassName={chartColors.twBg} />}
          {split && <TooltipRow label="美股" value={formatMoney(buckets[activeIndex].us)} swatchClassName={chartColors.usBg} />}
          <TooltipRow label="合計" value={formatMoney(totals[activeIndex])} />
        </ChartTooltip>
      )}
    </div>
  );
}
