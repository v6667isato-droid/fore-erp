"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/use-require-auth";

interface PrintStatement {
  id: string;
  statement_month: string;
  status: string;
  total_amount: number;
  paid_amount: number | null;
  paid_date: string | null;
  notes: string | null;
  created_at: string | null;
  channel_name: string;
}

interface PrintLine {
  id: string;
  line_type: "order" | "return" | "adjustment";
  description: string | null;
  amount: number;
  order_number: string | null;
  shipped_date: string | null;
  customer_name: string | null;
}

function formatMonthLabel(statementMonth: string): string {
  const s = String(statementMonth).slice(0, 7);
  const [y, m] = s.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

function formatAmount(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function ymd(d: string | null): string {
  return d ? String(d).slice(0, 10) : "—";
}

export default function ChannelStatementPrintPage() {
  const params = useParams<{ statementId: string }>();
  const rawId = params?.statementId;
  const statementId = typeof rawId === "string" ? decodeURIComponent(rawId) : undefined;
  const { ready: authReady } = useRequireAuth();

  const [loading, setLoading] = useState(true);
  const [statement, setStatement] = useState<PrintStatement | null>(null);
  const [lines, setLines] = useState<PrintLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!statementId || !authReady) return;
    const safeId = statementId;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: stmtRow, error: stmtErr } = await supabase
          .from("channel_statements")
          .select(
            "id, statement_month, status, total_amount, paid_amount, paid_date, notes, created_at, channels(name)"
          )
          .eq("id", safeId)
          .single();
        if (stmtErr || !stmtRow) {
          throw new Error(stmtErr?.message || "找不到對帳單");
        }

        const channelRaw = (stmtRow as any).channels;
        const channelName = Array.isArray(channelRaw)
          ? String(channelRaw[0]?.name ?? "")
          : String(channelRaw?.name ?? "");

        setStatement({
          id: String(stmtRow.id),
          statement_month: String(stmtRow.statement_month),
          status: String(stmtRow.status ?? ""),
          total_amount: Number(stmtRow.total_amount ?? 0),
          paid_amount: stmtRow.paid_amount != null ? Number(stmtRow.paid_amount) : null,
          paid_date: stmtRow.paid_date ?? null,
          notes: stmtRow.notes != null ? String(stmtRow.notes) : null,
          created_at: stmtRow.created_at ?? null,
          channel_name: channelName,
        });

        const { data: lineRows, error: lineErr } = await supabase
          .from("channel_statement_lines")
          .select(
            "id, line_type, description, amount, orders(order_number, shipped_date, customers(name, alias))"
          )
          .eq("statement_id", safeId)
          .order("line_type", { ascending: true })
          .order("created_at", { ascending: true });
        if (lineErr) throw new Error(lineErr.message || "讀取對帳明細失敗");

        setLines(
          ((lineRows ?? []) as any[]).map((r) => {
            const ordRaw = r.orders;
            const ord = Array.isArray(ordRaw) ? ordRaw[0] : ordRaw;
            const custRaw = ord?.customers;
            const cust = Array.isArray(custRaw) ? custRaw[0] : custRaw;
            const alias = cust?.alias != null ? String(cust.alias).trim() : "";
            return {
              id: String(r.id),
              line_type: (r.line_type ?? "order") as PrintLine["line_type"],
              description: r.description != null ? String(r.description) : null,
              amount: Number(r.amount ?? 0),
              order_number: ord?.order_number != null ? String(ord.order_number) : null,
              shipped_date: ord?.shipped_date ?? null,
              customer_name: alias || (cust?.name != null ? String(cust.name).trim() : null),
            };
          })
        );
      } catch (err) {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : "讀取對帳單失敗");
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [statementId, authReady]);

  useEffect(() => {
    if (!statement) return;
    const ym = String(statement.statement_month).slice(0, 7).replace("-", "");
    document.title = `對帳單_${statement.channel_name || "通路"}_${ym}`;
  }, [statement]);

  const orderLines = useMemo(() => lines.filter((l) => l.line_type === "order"), [lines]);
  const deductionLines = useMemo(() => lines.filter((l) => l.line_type !== "order"), [lines]);
  const orderSubtotal = orderLines.reduce((s, l) => s + l.amount, 0);
  const deductionSubtotal = deductionLines.reduce((s, l) => s + l.amount, 0);
  const grandTotal = orderSubtotal + deductionSubtotal;

  if (!statementId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">無效的對帳單連結</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">載入對帳單中…</p>
      </div>
    );
  }

  if (loadError || !statement) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-red-600">{loadError || "找不到對帳單"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black px-6 py-8 shadow-lg print:shadow-none print:px-4 print:py-8">
        <div className="flex justify-end mb-6 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <span>🖨️ 列印 / 存成 PDF</span>
          </button>
        </div>

        <header className="mb-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[2fr_1fr]">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex h-full items-center justify-between gap-4">
                <img
                  src="/logo.png"
                  alt="Føre Furniture"
                  className="block h-24 w-auto shrink-0 object-contain object-left"
                />
                <div className="space-y-1 border-l border-gray-200 pl-5 text-xs text-gray-700 leading-relaxed">
                  <p>電話：06-2302861</p>
                  <p>聯絡時間：上班日 9:00 - 17:00</p>
                  <p className="whitespace-nowrap">地址：台南市歸仁區丁厝街125號</p>
                  <p className="whitespace-nowrap">
                    Email：
                    <a
                      href="mailto:forefurniture.studio@gmail.com"
                      className="text-gray-900 underline hover:no-underline"
                    >
                      forefurniture.studio@gmail.com
                    </a>
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700 leading-relaxed">
              <p className="mb-2 text-lg font-semibold leading-tight text-gray-900">對帳單</p>
              <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1.5 text-xs">
                <span className="text-gray-500">通路</span>
                <span className="text-gray-900">{statement.channel_name || "—"}</span>
                <span className="text-gray-500">對帳月份</span>
                <span className="text-gray-900">{formatMonthLabel(statement.statement_month)}</span>
                <span className="text-gray-500">製表日期</span>
                <span className="text-gray-900">{ymd(statement.created_at)}</span>
              </div>
            </div>
          </div>
        </header>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-800 text-left">
              <th className="px-2 py-2 font-semibold text-gray-700 w-10">#</th>
              <th className="px-2 py-2 font-semibold text-gray-700 whitespace-nowrap">出貨日</th>
              <th className="px-2 py-2 font-semibold text-gray-700 whitespace-nowrap">訂單編號</th>
              <th className="px-2 py-2 font-semibold text-gray-700">客戶</th>
              <th className="px-2 py-2 font-semibold text-gray-700 text-right whitespace-nowrap">金額</th>
            </tr>
          </thead>
          <tbody>
            {orderLines.map((l, idx) => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{ymd(l.shipped_date)}</td>
                <td className="px-2 py-2 font-mono text-gray-900 whitespace-nowrap">
                  {l.order_number ?? "—"}
                </td>
                <td className="px-2 py-2 text-gray-900">
                  {l.customer_name ?? l.description ?? "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-900 whitespace-nowrap">
                  {formatAmount(l.amount)}
                </td>
              </tr>
            ))}
            {deductionLines.map((l) => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="px-2 py-2 text-gray-500">—</td>
                <td className="px-2 py-2 text-gray-700" colSpan={3}>
                  {l.description || (l.line_type === "return" ? "退貨扣款" : "調整")}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${l.amount < 0 ? "text-red-700" : "text-gray-900"}`}
                >
                  {l.amount < 0 ? `−${formatAmount(-l.amount)}` : formatAmount(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {deductionLines.length > 0 && (
              <>
                <tr>
                  <td colSpan={4} className="px-2 pt-3 pb-1 text-right text-gray-600">
                    出貨小計（{orderLines.length} 筆）
                  </td>
                  <td className="px-2 pt-3 pb-1 text-right tabular-nums text-gray-900 whitespace-nowrap">
                    {formatAmount(orderSubtotal)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-right text-gray-600">
                    退貨／調整小計
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${deductionSubtotal < 0 ? "text-red-700" : "text-gray-900"}`}
                  >
                    {deductionSubtotal < 0
                      ? `−${formatAmount(-deductionSubtotal)}`
                      : formatAmount(deductionSubtotal)}
                  </td>
                </tr>
              </>
            )}
            <tr className="border-t-2 border-gray-800">
              <td colSpan={4} className="px-2 py-2.5 text-right font-semibold text-gray-900">
                本期應收總計
              </td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900 whitespace-nowrap text-base">
                {formatAmount(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>

        {statement.notes ? (
          <p className="mt-4 text-xs text-gray-600">備註：{statement.notes}</p>
        ) : null}

        <p className="mt-8 text-xs text-gray-500 leading-relaxed">
          請貴公司核對上列明細，如有出入請於收到本對帳單後儘速告知；確認無誤請依約定付款方式匯款，謝謝。
        </p>
      </div>
    </div>
  );
}
