"use client";

import { useState } from "react";
import { Cell, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
import { formatTwdShort, niceScale, type YearSummary } from "@/lib/invest-charts";
import { formatMoney, formatSignedMoney, pnlClass } from "@/components/investments/invest-ui";
import {
  ChartCard,
  chartColors,
  roundedBottomPath,
  roundedTopPath,
  TableToggle,
  useElementWidth,
} from "@/components/investments/chart-ui";

/** 每年已實現損益：獲利紅色往上、虧損綠色往下（台股慣例），柱子在 0 線上下也表示正負 */
export function RealizedChartCard({ rows }: { rows: { year: string; value: number }[] }) {
  const [showTable, setShowTable] = useState(false);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ChartCard
      title="每年已實現損益"
      subtitle={`賣出時實現的損益合計 NT$ ${formatSignedMoney(total)}`}
      actions={<TableToggle showTable={showTable} onChange={setShowTable} />}
      footnote="依賣出日期的年度加總；美股依賣出日匯率換算台幣。紅色為獲利、綠色為虧損。"
    >
      {rows.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">還沒有賣出紀錄</div>
      ) : showTable ? (
        <InvestTable minWidth={260} className="rounded-lg border border-border">
          <thead>
            <tr>
              <HeadCell sticky>年度</HeadCell>
              <HeadCell align="right">已實現損益</HeadCell>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <Row key={r.year}>
                <Cell sticky className="tabular-nums">{r.year}</Cell>
                <Cell align="right" className={pnlClass(r.value)}>{formatSignedMoney(r.value)}</Cell>
              </Row>
            ))}
          </tbody>
        </InvestTable>
      ) : (
        <RealizedPlot rows={rows} />
      )}
    </ChartCard>
  );
}

function RealizedPlot({ rows }: { rows: { year: string; value: number }[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 420;
  const height = narrow ? 200 : 240;
  const m = { top: 22, right: 4, bottom: 24, left: 52 };
  const plotW = Math.max(width - m.left - m.right, 10);
  const plotH = height - m.top - m.bottom;
  const values = rows.map((r) => r.value);
  const scale = niceScale(Math.min(...values), Math.max(...values), 4);
  const y = (v: number) => m.top + ((scale.max - v) / (scale.max - scale.min)) * plotH;
  const band = plotW / rows.length;
  const barW = Math.max(4, Math.min(24, band * 0.5));
  const zeroY = y(0);

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          role="img"
          aria-label={`每年已實現損益：${rows.map((r) => `${r.year} 年 ${formatSignedMoney(r.value)} 元`).join("、")}`}
        >
          {scale.ticks.map((t) => (
            <g key={t}>
              {t !== 0 && <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className={chartColors.grid} />}
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className={chartColors.axisText}>
                {formatTwdShort(t)}
              </text>
            </g>
          ))}
          <line x1={m.left} x2={m.left + plotW} y1={zeroY} y2={zeroY} className={chartColors.baseline} />
          {rows.map((r, i) => {
            const cx = m.left + i * band + band / 2;
            const x0 = cx - barW / 2;
            const positive = r.value >= 0;
            const barH = Math.abs(y(r.value) - zeroY);
            // 標籤寬度放不下完整金額時改用萬元縮寫
            const label = band >= 76 ? formatSignedMoney(r.value) : `${r.value > 0 ? "+" : ""}${formatTwdShort(r.value)}`;
            return (
              <g key={r.year}>
                <path
                  d={positive ? roundedTopPath(x0, zeroY - barH, barW, barH) : roundedBottomPath(x0, zeroY, barW, barH)}
                  className={positive ? chartColors.gainFill : chartColors.lossFill}
                >
                  <title>{`${r.year} 年：${formatSignedMoney(r.value)}`}</title>
                </path>
                <text
                  x={cx}
                  y={positive ? zeroY - barH - 7 : zeroY + barH + 15}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-semibold tabular-nums"
                >
                  {label}
                </text>
                <text x={cx} y={height - 6} textAnchor="middle" className={chartColors.axisText}>
                  {r.year}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** 合計列（凍結欄的儲存格有自己的底色，所以底色要加在每個儲存格上） */
const totalRowClass = "font-semibold [&>*]:bg-[color-mix(in_srgb,var(--color-muted)_45%,var(--color-card))]";

/** 年度彙總：股利＋已實現損益（報稅、年度檢討用） */
export function YearlySummaryCard({
  rows,
  total,
  markets,
}: {
  rows: YearSummary[];
  total: YearSummary;
  /** 篩選範圍內有哪些市場；兩個都有時股利分台股／美股兩欄 */
  markets: { tw: boolean; us: boolean };
}) {
  const split = markets.tw && markets.us;
  return (
    <ChartCard
      title="年度彙總"
      subtitle="報稅、年度檢討用"
      footnote={`股利為已入帳的實收金額${markets.us ? "；美股股利與損益依當時匯率換算台幣" : ""}。`}
    >
      {rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">還沒有股利或賣出紀錄</div>
      ) : (
        <InvestTable minWidth={520} className="rounded-lg border border-border">
          <thead>
            <tr>
              <HeadCell sticky>年度</HeadCell>
              <HeadCell align="right">{split ? "股利（台股）" : "股利"}</HeadCell>
              {split && <HeadCell align="right">股利（美股）</HeadCell>}
              <HeadCell align="right">已實現損益</HeadCell>
              <HeadCell align="right">合計</HeadCell>
            </tr>
          </thead>
          <tbody>
            {[...rows, total].map((r) => {
              const isTotal = r === total;
              return (
                <Row key={r.year} className={isTotal ? totalRowClass : undefined}>
                  <Cell sticky className={isTotal ? undefined : "font-medium tabular-nums"}>{r.year}</Cell>
                  <Cell align="right">
                    {formatMoney(split ? r.dividendsTw : r.dividendsTw + r.dividendsUs)}
                  </Cell>
                  {split && <Cell align="right">{formatMoney(r.dividendsUs)}</Cell>}
                  <Cell align="right" className={pnlClass(r.realized)}>{formatSignedMoney(r.realized)}</Cell>
                  <Cell align="right" className="font-semibold">{formatMoney(r.total)}</Cell>
                </Row>
              );
            })}
          </tbody>
        </InvestTable>
      )}
    </ChartCard>
  );
}
