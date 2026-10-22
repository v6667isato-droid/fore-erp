"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTwdShort, niceScale, type YearSummary } from "@/lib/invest-charts";
import { formatMoney, pnlClass } from "@/components/investments/invest-ui";
import {
  ChartCard,
  chartColors,
  formatSignedMoney,
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
        <Table wrapperClassName="rounded-lg border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>年度</TableHead>
              <TableHead className="text-right">已實現損益</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...rows].reverse().map((r) => (
              <TableRow key={r.year}>
                <TableCell className="tabular-nums">{r.year}</TableCell>
                <TableCell className={`text-right tabular-nums ${pnlClass(r.value)}`}>{formatSignedMoney(r.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
        <Table wrapperClassName="rounded-lg border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>年度</TableHead>
              <TableHead className="text-right">{split ? "股利（台股）" : "股利"}</TableHead>
              {split && <TableHead className="text-right">股利（美股）</TableHead>}
              <TableHead className="text-right">已實現損益</TableHead>
              <TableHead className="text-right">合計</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...rows, total].map((r) => {
              const isTotal = r === total;
              return (
                <TableRow key={r.year} className={isTotal ? "bg-muted/40 font-semibold" : undefined}>
                  <TableCell className={isTotal ? undefined : "font-medium tabular-nums"}>{r.year}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(split ? r.dividendsTw : r.dividendsTw + r.dividendsUs)}
                  </TableCell>
                  {split && <TableCell className="text-right tabular-nums">{formatMoney(r.dividendsUs)}</TableCell>}
                  <TableCell className={`text-right tabular-nums ${pnlClass(r.realized)}`}>{formatSignedMoney(r.realized)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(r.total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ChartCard>
  );
}
