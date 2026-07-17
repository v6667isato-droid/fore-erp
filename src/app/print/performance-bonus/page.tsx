"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  loadPerformanceBonusExport,
  type PerformanceBonusExportSnapshot,
} from "@/lib/performance-bonus-export";

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PerformanceBonusPrintPage() {
  const [snapshot, setSnapshot] = useState<PerformanceBonusExportSnapshot | null>(null);

  useEffect(() => {
    setSnapshot(loadPerformanceBonusExport());
  }, []);

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-white p-8 text-gray-900">
        <p className="text-sm text-gray-600">找不到匯出資料，請從考績獎金分配頁重新匯出。</p>
        <Link href="/?page=leave_approvals" className="mt-4 inline-block text-sm text-blue-700 underline">
          返回 ERP
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 print:bg-white">
      <div className="max-w-[297mm] mx-auto px-6 py-8 print:px-8 print:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
          <Link href="/?page=leave_approvals" className="text-xs text-gray-500 hover:text-gray-800">
            ← 返回 ERP
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            列印 / 另存 PDF
          </button>
        </div>

        <header className="mb-6 border-b border-gray-300 pb-4">
          <h1 className="text-2xl font-bold tracking-tight">考績獎金分配明細</h1>
          <p className="mt-1 text-sm text-gray-600">{snapshot.halfLabel}</p>
          <p className="text-xs text-gray-500">匯出時間：{formatSavedAt(snapshot.savedAt)}</p>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">利潤</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(snapshot.profit)}</p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">分潤獎金池（{snapshot.profitSharingPct}%）</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(snapshot.profitSharingPool)}</p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">年終獎金合計</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(snapshot.yearEndBonusTotal ?? snapshot.totals.yearEndBonus ?? 0)}
            </p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">考績分潤池</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(snapshot.weightedProfitSharingPool ?? snapshot.totals.profitSharingBonus ?? 0)}
            </p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">股份獎金池（{snapshot.shareBonusPct}%）</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(snapshot.shareBonusPool)}</p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">獎金合計</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(snapshot.totals.totalBonus)}</p>
          </div>
        </section>

        {snapshot.profitMeta && (
          <p className="mb-4 text-xs text-gray-500 leading-relaxed">{snapshot.profitMeta}</p>
        )}

        <p className="mb-3 text-xs text-gray-600">
          加權：能力分級 {snapshot.weights.ability ?? 0}、考績 {snapshot.weights.performance}、年資{" "}
          {snapshot.weights.seniority}、薪資 {snapshot.weights.salary}
          {snapshot.issueYearEndBonus === false
            ? " · 本次不發放年終獎金"
            : snapshot.yearEndBonusSalaryPct != null
              ? ` · 年終 ${snapshot.yearEndBonusSalaryPct}% 月薪`
              : ""}
        </p>

        <table className="w-full border-collapse text-[11px] leading-snug">
          <thead>
            <tr className="border border-gray-400 bg-gray-100">
              <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold">姓名</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">參與分紅</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">能力分級</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">考績</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">年資</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">薪資</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">股份</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">能力%</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">考績%</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">年資%</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">薪資%</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">總%</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">年終獎金</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">考績分潤</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">股份分紅</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">總獎金</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.rows.map((row, i) => (
              <tr key={`${row.name}-${i}`}>
                <td className="border border-gray-300 px-2 py-1">{row.name}</td>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  {row.participatesInProfitSharing ? "✓" : "—"}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {row.abilityGrade ?? "—"}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{row.performance}</td>
                <td className="border border-gray-300 px-2 py-1 text-right">{row.seniorityLabel}</td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatMoney(row.salary)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {row.shares.toLocaleString("zh-TW")}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatPct(row.abilityPct ?? 0)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatPct(row.performancePct)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatPct(row.seniorityPct)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatPct(row.salaryPct)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums font-medium">
                  {formatPct(row.totalPct)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatMoney(row.yearEndBonus ?? 0)}
                  {row.tenureRatioPct && row.tenureRatioPct !== "100.0%" && (
                    <span className="text-[9px] text-gray-500"> ({row.tenureRatioPct})</span>
                  )}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatMoney(row.profitSharingBonus)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {formatMoney(row.shareBonus)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums font-semibold">
                  {formatMoney(row.totalBonus)}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="border border-gray-300 px-2 py-1.5">合計</td>
              <td className="border border-gray-300 px-2 py-1.5" />
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {snapshot.totals.ability ?? ""}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {snapshot.totals.performance}
              </td>
              <td className="border border-gray-300 px-2 py-1.5" />
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {formatMoney(snapshot.totals.salary)}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {snapshot.totals.shares.toLocaleString("zh-TW")}
              </td>
              <td className="border border-gray-300 px-2 py-1.5" colSpan={5} />
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {formatMoney(snapshot.totals.yearEndBonus ?? 0)}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {formatMoney(snapshot.totals.profitSharingBonus)}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {formatMoney(snapshot.totals.shareBonus)}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-right tabular-nums">
                {formatMoney(snapshot.totals.totalBonus)}
              </td>
            </tr>
          </tbody>
        </table>

        <footer className="mt-8 border-t border-gray-200 pt-4 text-[10px] text-gray-500 leading-relaxed">
          分潤獎金池先分配年終獎金
          {snapshot.issueYearEndBonus !== false && snapshot.yearEndBonusSalaryPct != null
            ? `（${snapshot.yearEndBonusSalaryPct}% 月薪，到職不足半年依比例）`
            : ""}
          ，剩餘依能力分級、考績、年資、薪資加權分配；股份分紅依持股數比例分配。本表僅供內部留存。
        </footer>
      </div>
    </div>
  );
}
