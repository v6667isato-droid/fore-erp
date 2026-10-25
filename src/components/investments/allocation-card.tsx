"use client";

import { useState } from "react";
import { Cell, HeadCell, InvestTable, Row } from "@/components/investments/invest-table";
import { cn } from "@/lib/utils";
import type { Allocation } from "@/lib/invest-charts";
import type { InvestMarket } from "@/lib/invest-types";
import { formatMoney } from "@/components/investments/invest-ui";
import { ChartCard, chartColors, TableToggle } from "@/components/investments/chart-ui";

const MARKET_LABELS: Record<InvestMarket, string> = { TW: "台股", US: "美股" };
const MARKET_BG: Record<InvestMarket, string> = { TW: chartColors.twBg, US: chartColors.usBg };

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** 資產配置（目前市值）：台股／美股比例條＋持股排行 */
export function AllocationCard({ allocation, fxNote }: { allocation: Allocation; fxNote: string | null }) {
  const [showTable, setShowTable] = useState(false);
  const { total, byMarket, items, others, unpriced } = allocation;
  const notes = [
    fxNote,
    unpriced > 0 ? `${unpriced} 檔沒有現價，未列入` : null,
  ].filter(Boolean);

  return (
    <ChartCard
      title="資產配置"
      subtitle={`目前市值 NT$ ${formatMoney(total)}`}
      actions={<TableToggle showTable={showTable} onChange={setShowTable} />}
      footnote={notes.length > 0 ? `${notes.join("；")}。` : undefined}
    >
      {total <= 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">目前沒有持股</div>
      ) : showTable ? (
        <InvestTable minWidth={440} className="rounded-lg border border-border">
          <thead>
            <tr>
              <HeadCell sticky>標的</HeadCell>
              <HeadCell>市場</HeadCell>
              <HeadCell align="right">市值（台幣）</HeadCell>
              <HeadCell align="right">占比</HeadCell>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <Row key={`${i.market}|${i.symbol}`}>
                <Cell sticky>
                  <div className="font-medium">{i.symbol}</div>
                  <div className="text-xs text-muted-foreground">{i.name ?? ""}</div>
                </Cell>
                <Cell>{MARKET_LABELS[i.market]}</Cell>
                <Cell align="right">{formatMoney(i.value)}</Cell>
                <Cell align="right">{formatShare(i.share)}</Cell>
              </Row>
            ))}
            {others && (
              <Row>
                <Cell sticky>
                  <div className="font-medium">其他 {others.symbols.length} 檔</div>
                  <div className="text-xs text-muted-foreground">{others.symbols.join("、")}</div>
                </Cell>
                <Cell>—</Cell>
                <Cell align="right">{formatMoney(others.value)}</Cell>
                <Cell align="right">{formatShare(others.share)}</Cell>
              </Row>
            )}
          </tbody>
        </InvestTable>
      ) : (
        <div className="space-y-4">
          {byMarket.length > 1 && (
            <div className="space-y-3">
              <div
                className="flex h-3.5 gap-0.5"
                role="img"
                aria-label={byMarket.map((m) => `${MARKET_LABELS[m.market]} ${formatShare(m.share)}`).join("，")}
              >
                {byMarket.map((m, i) => (
                  <div
                    key={m.market}
                    className={cn(MARKET_BG[m.market], i === 0 && "rounded-l", i === byMarket.length - 1 && "rounded-r")}
                    style={{ width: `${m.share * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                {byMarket.map((m) => (
                  <div key={m.market} className="flex flex-wrap items-center gap-x-2">
                    <span className={cn("h-2.5 w-2.5 rounded-[3px]", MARKET_BG[m.market])} aria-hidden="true" />
                    <span className="text-muted-foreground">{MARKET_LABELS[m.market]}</span>
                    <span className="font-semibold tabular-nums">{formatShare(m.share)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">NT$ {formatMoney(m.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={cn("space-y-2.5", byMarket.length > 1 && "border-t border-border pt-3")}>
            <div className="text-xs text-muted-foreground">持股排行</div>
            {items.map((i) => (
              <AllocationRow
                key={`${i.market}|${i.symbol}`}
                symbol={i.symbol}
                name={i.name}
                share={i.share}
                value={i.value}
                barClassName={MARKET_BG[i.market]}
              />
            ))}
            {others && (
              <AllocationRow
                symbol={`其他 ${others.symbols.length} 檔`}
                name={others.symbols.join("、")}
                share={others.share}
                value={others.value}
                barClassName={chartColors.otherBg}
              />
            )}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function AllocationRow({
  symbol,
  name,
  share,
  value,
  barClassName,
}: {
  symbol: string;
  name: string | null;
  share: number;
  value: number;
  barClassName: string;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_3.5rem_6.5rem]">
      <div className="min-w-0">
        <div className="truncate font-medium">{symbol}</div>
        <div className="truncate text-[11px] text-muted-foreground">{name ?? ""}</div>
      </div>
      <div className="h-2 rounded bg-muted">
        <div className={cn("h-2 rounded", barClassName)} style={{ width: `${Math.max(share * 100, 0.6)}%` }} />
      </div>
      <div className="text-right tabular-nums">
        <div className="font-medium">{formatShare(share)}</div>
        <div className="text-[11px] text-muted-foreground sm:hidden">{formatMoney(value)}</div>
      </div>
      <div className="hidden text-right text-muted-foreground tabular-nums sm:block">{formatMoney(value)}</div>
    </div>
  );
}
