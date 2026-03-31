"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowBigUp, Hand } from "lucide-react";

type MarkId = "handle" | "fragile" | "up";

const MARKS: {
  id: MarkId;
  label: string;
  Icon: typeof Hand;
}[] = [
  { id: "handle", label: "小心輕放", Icon: Hand },
  { id: "fragile", label: "易碎品", Icon: AlertTriangle },
  { id: "up", label: "此處朝上", Icon: ArrowBigUp },
];

/** 一頁 A4 直式可排 3 格；單格約寬 × 高（mm），三列加細框約佔滿列印高度 */
const TILE_W_MM = 178;
const TILE_H_MM = 96;

const PER_PAGE = 3;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ShippingMarksPrintPage() {
  const [counts, setCounts] = useState<Record<MarkId, number>>({
    handle: 1,
    fragile: 1,
    up: 1,
  });

  const flatMarks = useMemo(() => {
    const out: { key: string; label: string; Icon: typeof Hand }[] = [];
    let seq = 0;
    for (const m of MARKS) {
      const n = Math.max(0, Math.min(99, Math.floor(Number(counts[m.id]) || 0)));
      for (let i = 0; i < n; i++) {
        seq += 1;
        out.push({ key: `${m.id}-${i}-${seq}`, label: m.label, Icon: m.Icon });
      }
    }
    return out;
  }, [counts]);

  const pages = useMemo(() => chunk(flatMarks, PER_PAGE), [flatMarks]);

  function setCount(id: MarkId, value: number) {
    const v = Math.max(0, Math.min(99, Math.floor(Number.isFinite(value) ? value : 0)));
    setCounts((prev) => ({ ...prev, [id]: v }));
  }

  const totalTiles = flatMarks.length;

  return (
    <div className="min-h-screen bg-white text-gray-900 print:bg-white">
      <div className="max-w-[210mm] mx-auto px-4 py-8 print:px-0 print:py-0 print:max-w-none">
        <div className="print:hidden mb-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold">物流警示標（獨立列印）</h1>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                disabled={totalTiles === 0}
              >
                列印 / 存成 PDF
              </button>
              <Link
                href="/print"
                className="inline-flex items-center rounded-md border border-transparent px-3 py-2 text-xs text-primary hover:underline"
              >
                ← 列印首頁
              </Link>
            </div>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            每格約 <strong className="font-medium text-gray-800">{TILE_W_MM}×{TILE_H_MM} mm</strong>
            ，<strong className="font-medium text-gray-800">一頁 A4 直式最多 3 格</strong>
            （由上而下）；外框與分隔線為<strong className="font-medium text-gray-800">細線</strong>
            。請為各標示設定列印數量（0 表示不印）。
          </p>
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/90 px-3 py-2.5">
            <p className="text-[11px] font-medium text-gray-700 mb-2">各標示列印數量（0–99）</p>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-gray-800">
              {MARKS.map((m) => (
                <div key={m.id} className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 min-w-[5.5rem]">
                    <m.Icon className="h-4 w-4 text-amber-800 shrink-0" aria-hidden />
                    {m.label}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={counts[m.id]}
                    onChange={(e) => setCount(m.id, parseInt(e.target.value, 10) || 0)}
                    className="h-8 w-16 rounded-md border border-gray-300 px-2 text-sm tabular-nums text-center"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {totalTiles === 0 ? (
          <p className="text-sm text-amber-800 print:hidden">請至少一項數量大於 0。</p>
        ) : (
          <div className="flex flex-col items-center gap-6 print:gap-0">
            {pages.map((group, pageIdx) => (
              <div
                key={pageIdx}
                className={pageIdx < pages.length - 1 ? "print:break-after-page" : ""}
              >
                <div className="flex flex-col w-fit mx-auto rounded-md overflow-hidden border-2 border-gray-900 print:border-gray-900">
                  {group.map((m, i) => (
                    <div
                      key={m.key}
                      className={
                        i < group.length - 1 ? "border-b-2 border-gray-900" : ""
                      }
                    >
                      <ShippingMarkTile
                        label={m.label}
                        Icon={m.Icon}
                        widthMm={TILE_W_MM}
                        heightMm={TILE_H_MM}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShippingMarkTile({
  label,
  Icon,
  widthMm,
  heightMm,
}: {
  label: string;
  Icon: typeof Hand;
  widthMm: number;
  heightMm: number;
}) {
  const w = `${widthMm}mm`;
  const h = `${heightMm}mm`;
  return (
    <div
      className="flex flex-col items-center justify-center bg-amber-50/90 box-border px-4 py-5 print:px-5 print:py-5"
      style={{
        width: w,
        height: h,
        minWidth: w,
        minHeight: h,
        maxWidth: w,
        maxHeight: h,
      }}
    >
      {/* 圖示約為原先 h-14／列印 4.5rem 的 3 倍線性尺寸 */}
      <Icon
        className="shrink-0 text-gray-900 w-[10.5rem] h-[10.5rem] print:w-[13.5rem] print:h-[13.5rem]"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="mt-2 text-center text-lg sm:text-xl print:text-[1.35rem] font-black tracking-[0.12em] text-gray-900 print:tracking-[0.15em] leading-tight px-2">
        {label}
      </p>
    </div>
  );
}
