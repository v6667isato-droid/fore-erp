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

/** 方形邊長（mm），兩格直向疊放約等於 A4 高度 */
const TILE_MM = 136;

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

  const pages = useMemo(() => chunk(flatMarks, 2), [flatMarks]);

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
            每格為約 <strong className="font-medium text-gray-800">{TILE_MM}mm 方形</strong>
            ，同一頁最多上下兩格；請為各標示設定列印數量（0 表示不印）。
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
            {pages.map((pair, pageIdx) => (
              <div
                key={pageIdx}
                className={pageIdx < pages.length - 1 ? "print:break-after-page" : ""}
              >
                <div className="flex flex-col items-center w-full max-w-[210mm] mx-auto rounded-lg overflow-hidden border-4 border-gray-900 print:border-gray-900">
                  {pair.map((m, i) => (
                    <ShippingMarkTile
                      key={m.key}
                      label={m.label}
                      Icon={m.Icon}
                      showDivider={i < pair.length - 1}
                      sizeMm={TILE_MM}
                    />
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
  showDivider,
  sizeMm,
}: {
  label: string;
  Icon: typeof Hand;
  showDivider: boolean;
  sizeMm: number;
}) {
  const wh = `${sizeMm}mm`;
  return (
    <div
      className={[
        "flex flex-col items-center justify-center bg-amber-50/90 box-border",
        "mx-auto",
        showDivider ? "border-b-4 border-gray-900" : "",
        "px-4 py-6 print:px-6",
      ].join(" ")}
      style={{ width: wh, height: wh, minWidth: wh, minHeight: wh, maxWidth: wh, maxHeight: wh }}
    >
      <Icon
        className="shrink-0 text-gray-900 w-[22%] h-[22%] min-w-[3.5rem] min-h-[3.5rem] max-w-[5rem] max-h-[5rem] sm:max-w-[5.5rem] sm:max-h-[5.5rem] print:max-w-[6rem] print:max-h-[6rem]"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="mt-3 text-center text-2xl sm:text-3xl print:text-[1.65rem] font-black tracking-[0.15em] text-gray-900 print:tracking-[0.2em] leading-tight px-1">
        {label}
      </p>
    </div>
  );
}
