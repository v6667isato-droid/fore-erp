"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import type { Database } from "@/types/database.types";

type IssuanceRow =
  Database["public"]["Tables"]["performance_bonus_issuance_rows"]["Row"];

type Issuance = Database["public"]["Tables"]["performance_bonus_issuances"]["Row"] & {
  performance_bonus_issuance_rows: IssuanceRow[];
};

function formatMoney(value: number | null): string {
  return Math.round(value ?? 0).toLocaleString("zh-TW");
}

function formatPct(value: number | null): string {
  return `${(value ?? 0).toFixed(1)}%`;
}

function periodLabel(year: number, half: string): string {
  return half === "H1" ? `${year} 上半年` : `${year} 下半年`;
}

function formatIssuedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short", hour12: false });
}

/** 從 profit_meta 字串（「統計至 …；營收 X、成本 Y」）取出營收、成本與統計說明 */
function parseProfitMeta(meta: string | null): {
  revenue?: string;
  cost?: string;
  note?: string;
} {
  if (!meta) return {};
  return {
    revenue: /營收\s*([\d,]+)/.exec(meta)?.[1],
    cost: /成本\s*([\d,]+)/.exec(meta)?.[1],
    note: /統計至[^；;]*/.exec(meta)?.[0],
  };
}

/** 獎金發放紀錄查詢：列出每次「確定發放」的快照，可展開看每人明細、刪除誤發紀錄 */
export function PerformanceBonusHistory({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<Issuance[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    const res = await supabase
      .from("performance_bonus_issuances")
      .select("*, performance_bonus_issuance_rows(*)")
      .is("deleted_at", null)
      .order("issued_at", { ascending: false });
    if (res.error) {
      toast.error(res.error.message);
      setLoading(false);
      return;
    }
    setRecords((res.data ?? []) as Issuance[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function softDelete(rec: Issuance) {
    const ok = window.confirm(
      `刪除 ${periodLabel(rec.year, rec.half)}（${formatIssuedAt(rec.issued_at)}）的發放紀錄？\n合計 ${formatMoney(rec.total_bonus)} 元、${rec.performance_bonus_issuance_rows.length} 人`,
    );
    if (!ok) return;
    setDeletingId(rec.id);
    const res = await supabase
      .from("performance_bonus_issuances")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", rec.id);
    setDeletingId(null);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("發放紀錄已刪除");
    void load();
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">
          發放紀錄
          {records.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              共 {records.length} 筆
            </span>
          )}
        </h3>
        <Button
          type="button"
          variant="ghost"
          className="h-8 gap-1.5 px-2.5 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          重新整理
        </Button>
      </div>

      {loading && records.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">載入中…</p>
      ) : records.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          尚無發放紀錄；按「確定發放」後會記錄在這裡
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {records.map((rec) => {
            const expanded = expandedId === rec.id;
            const rows = [...rec.performance_bonus_issuance_rows].sort(
              (a, b) => a.sort_order - b.sort_order,
            );
            return (
              <li key={rec.id}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/30"
                    onClick={() => setExpandedId(expanded ? null : rec.id)}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{periodLabel(rec.year, rec.half)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatIssuedAt(rec.issued_at)} · {rows.length} 人
                    </span>
                    <span className="ml-auto text-sm font-semibold tabular-nums">
                      {formatMoney(rec.total_bonus)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void softDelete(rec)}
                    disabled={deletingId === rec.id}
                    aria-label="刪除發放紀錄"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {expanded && (
                  <div className="border-t border-border/60 bg-muted/10 px-4 py-3">
                    {(() => {
                      // 營收、成本優先讀獨立欄位；更早的舊紀錄退回解析 profit_meta 文字
                      const meta = parseProfitMeta(rec.profit_meta);
                      const revenue = rec.revenue != null ? formatMoney(rec.revenue) : meta.revenue;
                      const cost = rec.cost != null ? formatMoney(rec.cost) : meta.cost;
                      const retainPct = Math.max(
                        0,
                        Math.round((100 - rec.profit_sharing_pct - rec.share_bonus_pct) * 10) / 10,
                      );
                      const retainAmount = Math.max(
                        0,
                        rec.profit - rec.profit_sharing_pool - rec.share_bonus_pool,
                      );
                      return (
                        <div className="mb-2 space-y-0.5 text-xs leading-relaxed text-muted-foreground">
                          <p>
                            {rec.year}年{rec.half === "H1" ? "上" : "下"}半年
                            {revenue ? `營收 ${revenue}、` : ""}
                            {cost ? `成本 ${cost}、` : ""}
                            總利潤 {formatMoney(rec.profit)}
                            {meta.note ? `（${meta.note}）` : ""}
                          </p>
                          <p>
                            分潤獎金（{rec.profit_sharing_pct}%）：{formatMoney(rec.profit_sharing_pool)}
                            {"　"}股份獎金（{rec.share_bonus_pct}%）：{formatMoney(rec.share_bonus_pool)}
                            {"　"}公司留存（{retainPct}%）：{formatMoney(retainAmount)}
                          </p>
                          {rec.issue_year_end_bonus && (
                            <p>
                              年終獎金（{rec.year_end_bonus_salary_pct}% 月薪）：
                              {formatMoney(rec.year_end_bonus_total)}（自分潤獎金池扣除）
                            </p>
                          )}
                          <p>
                            加權：能力 {rec.weight_ability}／考績 {rec.weight_performance}／年資{" "}
                            {rec.weight_seniority}／薪資 {rec.weight_salary}
                          </p>
                        </div>
                      );
                    })()}
                    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
                      <table className="w-full min-w-[960px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                            <th className="px-2 py-1.5 text-left font-medium">姓名</th>
                            <th className="px-1.5 py-1.5 text-center font-medium">參與分紅</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">能力分級</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">考績</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">年資</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">薪資</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">股份</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">能力%</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">考績%</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">年資%</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">薪資%</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">總%</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">年終獎金</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">考績分潤</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">股份分紅</th>
                            <th className="px-2 py-1.5 text-right font-medium">總獎金</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className="border-b border-border/60 last:border-b-0">
                              <td className="px-2 py-1.5 font-medium">{r.employee_name}</td>
                              <td className="px-1.5 py-1.5 text-center">
                                {r.participates_in_profit_sharing ? "✓" : "—"}
                              </td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{r.ability_grade}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{r.performance}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                                {r.seniority_label ?? "—"}
                              </td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatMoney(r.salary)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">
                                {(r.shares ?? 0).toLocaleString("zh-TW")}
                              </td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatPct(r.ability_pct)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatPct(r.performance_pct)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatPct(r.seniority_pct)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatPct(r.salary_pct)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums font-medium">{formatPct(r.total_pct)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatMoney(r.year_end_bonus)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatMoney(r.profit_sharing_bonus)}</td>
                              <td className="px-1.5 py-1.5 text-right tabular-nums">{formatMoney(r.share_bonus)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatMoney(r.total_bonus)}</td>
                            </tr>
                          ))}
                          <tr className="bg-muted/30 font-medium">
                            <td className="px-2 py-1.5">合計</td>
                            <td className="px-1.5 py-1.5" colSpan={11} />
                            <td className="px-1.5 py-1.5 text-right tabular-nums">
                              {formatMoney(rec.year_end_bonus_total)}
                            </td>
                            <td className="px-1.5 py-1.5 text-right tabular-nums">
                              {formatMoney(rows.reduce((s, r) => s + (r.profit_sharing_bonus ?? 0), 0))}
                            </td>
                            <td className="px-1.5 py-1.5 text-right tabular-nums">
                              {formatMoney(rows.reduce((s, r) => s + (r.share_bonus ?? 0), 0))}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                              {formatMoney(rec.total_bonus)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
