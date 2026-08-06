"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Printer, Trash2, X, FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/use-require-auth";

type StatementStatus = "草稿" | "已請款" | "已收款";

interface StatementRow {
  id: string;
  statement_month: string;
  status: StatementStatus;
  total_amount: number;
  paid_amount: number | null;
  paid_date: string | null;
  notes: string | null;
  created_at: string | null;
  line_count: number;
}

interface StatementLineRow {
  id: string;
  line_type: "order" | "return" | "adjustment";
  order_id: string | null;
  description: string | null;
  amount: number;
}

/** 產生對帳單時的候選訂單（已出貨／結案、未結清、未納入任何對帳單） */
interface CandidateOrder {
  id: string;
  order_number: string;
  customer_name: string;
  shipped_date: string | null;
  order_date: string | null;
  status: string;
  total_amount: number;
}

interface CandidateReturn {
  id: string;
  order_number: string;
  customer_name: string;
  return_date: string;
  refund_amount: number;
  reason: string | null;
}

/** 手動調整列：運費、折讓、補收等，金額可正可負 */
interface AdjustmentLine {
  key: string;
  description: string;
  amount: string;
}

function monthStartYmd(month: string): string {
  return `${month}-01`;
}

function monthEndYmd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
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

/** 預設對上個月結帳（月結實務：本月初結上月出貨） */
function defaultStatementMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function statusBadgeClass(status: StatementStatus): string {
  switch (status) {
    case "草稿":
      return "bg-muted text-muted-foreground";
    case "已請款":
      return "bg-amber-100 text-amber-800";
    case "已收款":
      return "bg-emerald-100 text-emerald-800";
  }
}

export default function ChannelStatementsPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = params?.channelId ?? "";
  const { ready: authReady } = useRequireAuth();

  const [channelName, setChannelName] = useState("");
  const [loading, setLoading] = useState(true);
  const [statements, setStatements] = useState<StatementRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [viewStatement, setViewStatement] = useState<StatementRow | null>(null);
  const [collectStatement, setCollectStatement] = useState<StatementRow | null>(null);
  const [deleteStatement, setDeleteStatement] = useState<StatementRow | null>(null);

  const fetchData = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const [channelRes, stmtRes] = await Promise.all([
        supabase.from("channels").select("id, name").eq("id", channelId).single(),
        supabase
          .from("channel_statements")
          .select(
            "id, statement_month, status, total_amount, paid_amount, paid_date, notes, created_at, channel_statement_lines(count)"
          )
          .eq("channel_id", channelId)
          .order("statement_month", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (!channelRes.error && channelRes.data) {
        setChannelName(String(channelRes.data.name ?? ""));
      }

      if (stmtRes.error) {
        toast.error(stmtRes.error.message || "載入對帳單失敗");
        setStatements([]);
        return;
      }

      setStatements(
        ((stmtRes.data ?? []) as any[]).map((r) => ({
          id: String(r.id),
          statement_month: String(r.statement_month),
          status: (r.status ?? "草稿") as StatementStatus,
          total_amount: Number(r.total_amount ?? 0),
          paid_amount: r.paid_amount != null ? Number(r.paid_amount) : null,
          paid_date: r.paid_date ?? null,
          notes: r.notes != null ? String(r.notes) : null,
          created_at: r.created_at ?? null,
          line_count: Number(r.channel_statement_lines?.[0]?.count ?? 0),
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (!authReady) return;
    fetchData();
  }, [authReady, fetchData]);

  async function markInvoiced(row: StatementRow) {
    const { error } = await supabase
      .from("channel_statements")
      .update({ status: "已請款" })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "更新失敗");
      return;
    }
    toast.success("已標記為已請款");
    fetchData();
  }

  async function performDelete() {
    if (!deleteStatement) return;
    const { error } = await supabase
      .from("channel_statements")
      .delete()
      .eq("id", deleteStatement.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除對帳單，訂單可重新納入對帳");
    setDeleteStatement(null);
    fetchData();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-foreground">
            通路對帳{channelName ? `（${channelName}）` : ""}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => window.open(`/channels/${channelId}/orders`, "_blank", "noopener,noreferrer")}
            >
              <FileText className="h-4 w-4 mr-1" />
              通路訂單
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              產生對帳單
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          流程：產生對帳單（草稿）→ 列印／寄給通路商 → 標記已請款 → 收到款後登錄收款（可同時將訂單批次標為已結清）。
          一張訂單只會出現在一張對帳單中；刪除對帳單後訂單可重新納入。
        </p>

        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>對帳月份</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">筆數</TableHead>
                <TableHead className="text-right">總額</TableHead>
                <TableHead>收款</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              ) : statements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    尚無對帳單，請點「產生對帳單」
                  </TableCell>
                </TableRow>
              ) : (
                statements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {formatMonthLabel(row.statement_month)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          statusBadgeClass(row.status)
                        )}
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.line_count}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatAmount(row.total_amount)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.status === "已收款"
                        ? `${ymd(row.paid_date)} 收 ${formatAmount(row.paid_amount ?? 0)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-nowrap justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2.5 text-xs"
                          onClick={() => setViewStatement(row)}
                        >
                          明細
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2.5 text-xs"
                          onClick={() =>
                            window.open(
                              `/print/channel-statement/${row.id}`,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {row.status === "草稿" && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => markInvoiced(row)}
                          >
                            標記已請款
                          </Button>
                        )}
                        {row.status !== "已收款" && (
                          <Button
                            type="button"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => setCollectStatement(row)}
                          >
                            登錄收款
                          </Button>
                        )}
                        {row.status !== "已收款" && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-destructive hover:text-destructive"
                            onClick={() => setDeleteStatement(row)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CreateStatementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        channelId={channelId}
        onSuccess={fetchData}
      />
      <StatementLinesDialog
        statement={viewStatement}
        onOpenChange={(open) => !open && setViewStatement(null)}
      />
      <CollectPaymentDialog
        statement={collectStatement}
        onOpenChange={(open) => !open && setCollectStatement(null)}
        onSuccess={fetchData}
      />
      <ConfirmDialog
        open={!!deleteStatement}
        onOpenChange={(open) => !open && setDeleteStatement(null)}
        title="確定刪除對帳單？"
        description={
          deleteStatement ? (
            <>
              刪除「{formatMonthLabel(deleteStatement.statement_month)}」對帳單後，
              其中的訂單與退貨將可重新納入其他對帳單。
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        destructive
        onConfirm={performDelete}
      />
    </div>
  );
}

// ----- 產生對帳單 -----

interface CreateStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  onSuccess: () => void;
}

function CreateStatementDialog({
  open,
  onOpenChange,
  channelId,
  onSuccess,
}: CreateStatementDialogProps) {
  const [month, setMonth] = useState(defaultStatementMonth);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<CandidateOrder[]>([]);
  const [returns, setReturns] = useState<CandidateReturn[]>([]);
  const [checkedOrders, setCheckedOrders] = useState<Record<string, boolean>>({});
  const [checkedReturns, setCheckedReturns] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<AdjustmentLine[]>([]);
  const [notes, setNotes] = useState("");

  const loadCandidates = useCallback(async () => {
    if (!channelId || !month) return;
    setLoading(true);
    try {
      const from = monthStartYmd(month);
      const to = monthEndYmd(month);

      const [ordersRes, billedOrdersRes, returnsRes, billedReturnsRes] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, order_number, order_date, shipped_date, status, payment_status, total_amount, customers!inner(channel_id, name, alias)"
          )
          .eq("customers.channel_id", channelId)
          .is("deleted_at", null)
          .eq("status", "已出貨")
          .order("shipped_date", { ascending: true }),
        supabase
          .from("channel_statement_lines")
          .select("order_id")
          .eq("line_type", "order")
          .not("order_id", "is", null),
        supabase
          .from("order_returns")
          .select(
            "id, return_date, refund_amount, reason, orders!inner(order_number, deleted_at, customers!inner(channel_id, name, alias))"
          )
          .eq("orders.customers.channel_id", channelId)
          .gte("return_date", from)
          .lte("return_date", to),
        supabase
          .from("channel_statement_lines")
          .select("return_id")
          .eq("line_type", "return")
          .not("return_id", "is", null),
      ]);

      if (ordersRes.error) throw new Error(ordersRes.error.message);
      if (billedOrdersRes.error) throw new Error(billedOrdersRes.error.message);

      const billedOrderIds = new Set(
        ((billedOrdersRes.data ?? []) as any[]).map((r) => String(r.order_id))
      );
      const billedReturnIds = new Set(
        ((billedReturnsRes.data ?? []) as any[]).map((r) => String(r.return_id))
      );

      const candidates: CandidateOrder[] = ((ordersRes.data ?? []) as any[])
        .filter((r) => r.payment_status !== "已結清" && !billedOrderIds.has(String(r.id)))
        .map((r) => {
          const cust = r.customers as { name?: string | null; alias?: string | null } | undefined;
          const alias = cust?.alias != null ? String(cust.alias).trim() : "";
          return {
            id: String(r.id),
            order_number: String(r.order_number ?? ""),
            customer_name: alias || String(cust?.name ?? "").trim(),
            shipped_date: r.shipped_date ?? null,
            order_date: r.order_date ?? null,
            status: String(r.status ?? ""),
            total_amount: Number(r.total_amount ?? 0),
          };
        });

      const candidateReturns: CandidateReturn[] = ((returnsRes.error
        ? []
        : (returnsRes.data ?? [])) as any[])
        .filter((r) => {
          const ord = r.orders as { deleted_at?: string | null } | undefined;
          return !billedReturnIds.has(String(r.id)) && ord?.deleted_at == null;
        })
        .map((r) => {
          const ord = r.orders as
            | { order_number?: string | null; customers?: { name?: string | null; alias?: string | null } }
            | undefined;
          const cust = ord?.customers;
          const alias = cust?.alias != null ? String(cust.alias).trim() : "";
          return {
            id: String(r.id),
            order_number: String(ord?.order_number ?? ""),
            customer_name: alias || String(cust?.name ?? "").trim(),
            return_date: String(r.return_date),
            refund_amount: Number(r.refund_amount ?? 0),
            reason: r.reason != null ? String(r.reason) : null,
          };
        })
        .filter((r) => r.refund_amount > 0);

      setOrders(candidates);
      setReturns(candidateReturns);

      // 預設勾選：出貨日落在對帳月內；沒有出貨日的舊訂單（欄位上線前出貨）也預設納入
      const nextChecked: Record<string, boolean> = {};
      const nextAmounts: Record<string, string> = {};
      candidates.forEach((o) => {
        const sd = o.shipped_date ? String(o.shipped_date).slice(0, 10) : null;
        nextChecked[o.id] = sd == null || (sd >= from && sd <= to);
        nextAmounts[o.id] = String(o.total_amount);
      });
      setCheckedOrders(nextChecked);
      setAmounts(nextAmounts);

      const nextCheckedReturns: Record<string, boolean> = {};
      candidateReturns.forEach((r) => {
        nextCheckedReturns[r.id] = true;
      });
      setCheckedReturns(nextCheckedReturns);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入未結帳訂單失敗");
      setOrders([]);
      setReturns([]);
    } finally {
      setLoading(false);
    }
  }, [channelId, month]);

  useEffect(() => {
    if (!open) return;
    setAdjustments([]);
    loadCandidates();
  }, [open, loadCandidates]);

  const selectedOrders = orders.filter((o) => checkedOrders[o.id]);
  const selectedReturns = returns.filter((r) => checkedReturns[r.id]);

  const total = useMemo(() => {
    const orderSum = selectedOrders.reduce((sum, o) => {
      const n = Number(amounts[o.id]);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const returnSum = selectedReturns.reduce((sum, r) => sum + r.refund_amount, 0);
    const adjustmentSum = adjustments.reduce((sum, a) => {
      const n = Number(a.amount);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    return orderSum - returnSum + adjustmentSum;
  }, [selectedOrders, selectedReturns, amounts, adjustments]);

  function addAdjustment() {
    setAdjustments((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: "", amount: "" },
    ]);
  }

  function updateAdjustment(key: string, patch: Partial<Omit<AdjustmentLine, "key">>) {
    setAdjustments((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  function removeAdjustment(key: string) {
    setAdjustments((prev) => prev.filter((a) => a.key !== key));
  }

  async function handleCreate() {
    if (!month) return;
    // 忽略完全空白的調整列（沒填摘要也沒填金額）
    const effectiveAdjustments = adjustments.filter(
      (a) => a.description.trim() !== "" || a.amount.trim() !== ""
    );
    if (
      selectedOrders.length === 0 &&
      selectedReturns.length === 0 &&
      effectiveAdjustments.length === 0
    ) {
      toast.error("請至少勾選一筆訂單、退貨或填寫調整列");
      return;
    }
    for (const o of selectedOrders) {
      const n = Number(amounts[o.id]);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`訂單 ${o.order_number} 的金額不正確`);
        return;
      }
    }
    for (const a of effectiveAdjustments) {
      const n = Number(a.amount);
      if (!Number.isFinite(n) || n === 0) {
        toast.error(`調整列「${a.description.trim() || "未命名"}」請填寫非零金額`);
        return;
      }
    }
    setSaving(true);
    try {
      const { data: stmt, error: stmtErr } = await supabase
        .from("channel_statements")
        .insert({
          channel_id: channelId,
          statement_month: monthStartYmd(month),
          status: "草稿",
          total_amount: total,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (stmtErr || !stmt) throw new Error(stmtErr?.message || "建立對帳單失敗");

      const lines = [
        ...selectedOrders.map((o) => ({
          statement_id: String(stmt.id),
          line_type: "order",
          order_id: o.id,
          description: `${o.order_number} ${o.customer_name}`.trim(),
          amount: Number(amounts[o.id]),
        })),
        ...selectedReturns.map((r) => ({
          statement_id: String(stmt.id),
          line_type: "return",
          return_id: r.id,
          description: `退貨扣款 ${r.order_number} ${r.customer_name}${r.reason ? `（${r.reason}）` : ""}`.trim(),
          amount: -r.refund_amount,
        })),
        ...effectiveAdjustments.map((a) => ({
          statement_id: String(stmt.id),
          line_type: "adjustment",
          description: a.description.trim() || "調整",
          amount: Number(a.amount),
        })),
      ];

      const { error: linesErr } = await supabase.from("channel_statement_lines").insert(lines);
      if (linesErr) {
        // 建明細失敗時回收主檔，避免留下空對帳單
        await supabase.from("channel_statements").delete().eq("id", String(stmt.id));
        if (linesErr.code === "23505") {
          throw new Error("部分訂單或退貨已納入其他對帳單，請重新整理後再試");
        }
        throw new Error(linesErr.message || "建立對帳明細失敗");
      }

      toast.success("已建立對帳單（草稿）");
      onOpenChange(false);
      setNotes("");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "建立對帳單失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="create-statement-desc"
        >
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                產生對帳單
              </Dialog.Title>
              <p id="create-statement-desc" className="mt-1 text-xs text-muted-foreground">
                列出未納入對帳單且未結清的「已出貨（未結案）」訂單。預設勾選出貨日在對帳月內者（無出貨日的舊訂單也預設納入），金額可個別調整。
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="text-xs text-muted-foreground">對帳月份</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            />
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">載入未結帳訂單中…</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>單號</TableHead>
                      <TableHead>客戶</TableHead>
                      <TableHead className="whitespace-nowrap">出貨日</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead className="text-right whitespace-nowrap">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          目前沒有待對帳的訂單
                        </TableCell>
                      </TableRow>
                    ) : (
                      orders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={!!checkedOrders[o.id]}
                              onChange={(e) =>
                                setCheckedOrders((prev) => ({ ...prev, [o.id]: e.target.checked }))
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {o.order_number}
                          </TableCell>
                          <TableCell className="text-sm">{o.customer_name || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {o.shipped_date ? ymd(o.shipped_date) : "無（舊訂單）"}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{o.status}</TableCell>
                          <TableCell className="text-right">
                            <input
                              type="number"
                              min={0}
                              value={amounts[o.id] ?? ""}
                              onChange={(e) =>
                                setAmounts((prev) => ({ ...prev, [o.id]: e.target.value }))
                              }
                              disabled={!checkedOrders[o.id]}
                              className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums disabled:opacity-50"
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {returns.length > 0 && (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>退貨扣款</TableHead>
                        <TableHead className="whitespace-nowrap">退貨日</TableHead>
                        <TableHead className="text-right whitespace-nowrap">扣款</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {returns.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={!!checkedReturns[r.id]}
                              onChange={(e) =>
                                setCheckedReturns((prev) => ({ ...prev, [r.id]: e.target.checked }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.order_number} {r.customer_name}
                            {r.reason ? (
                              <span className="text-xs text-muted-foreground">（{r.reason}）</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {ymd(r.return_date)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-destructive whitespace-nowrap">
                            −{formatAmount(r.refund_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    調整列（選填）：運費、折讓、補收等，金額可輸入負數
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={addAdjustment}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    新增調整列
                  </Button>
                </div>
                {adjustments.length > 0 && (
                  <div className="space-y-2">
                    {adjustments.map((a) => (
                      <div key={a.key} className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={a.description}
                          onChange={(e) => updateAdjustment(a.key, { description: e.target.value })}
                          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                          placeholder="摘要（例如：運費、折讓）"
                        />
                        <input
                          type="number"
                          value={a.amount}
                          onChange={(e) => updateAdjustment(a.key, { amount: e.target.value })}
                          className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums"
                          placeholder="±金額"
                        />
                        <button
                          type="button"
                          onClick={() => removeAdjustment(a.key)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-accent/40"
                          aria-label="移除調整列"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">備註（選填）</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  placeholder="例如：含 6 月補單"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-sm text-muted-foreground">
                  已勾選 {selectedOrders.length} 筆訂單
                  {selectedReturns.length > 0 ? `、${selectedReturns.length} 筆退貨扣款` : ""}
                  {adjustments.length > 0 ? `、${adjustments.length} 筆調整` : ""}
                </p>
                <p className="text-base font-semibold text-foreground tabular-nums">
                  總計 {formatAmount(total)}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={saving}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button
                  type="button"
                  onClick={handleCreate}
                  disabled={
                    saving ||
                    loading ||
                    (selectedOrders.length === 0 &&
                      selectedReturns.length === 0 &&
                      adjustments.length === 0)
                  }
                >
                  {saving ? "建立中…" : "建立對帳單"}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ----- 明細檢視 -----

interface StatementLinesDialogProps {
  statement: StatementRow | null;
  onOpenChange: (open: boolean) => void;
}

function StatementLinesDialog({ statement, onOpenChange }: StatementLinesDialogProps) {
  const [lines, setLines] = useState<StatementLineRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!statement) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("channel_statement_lines")
        .select("id, line_type, order_id, description, amount")
        .eq("statement_id", statement.id)
        .order("line_type", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) {
        toast.error(error.message || "載入明細失敗");
        setLines([]);
      } else {
        setLines(
          ((data ?? []) as any[]).map((r) => ({
            id: String(r.id),
            line_type: (r.line_type ?? "order") as StatementLineRow["line_type"],
            order_id: r.order_id != null ? String(r.order_id) : null,
            description: r.description != null ? String(r.description) : null,
            amount: Number(r.amount ?? 0),
          }))
        );
      }
      setLoading(false);
    })();
  }, [statement]);

  return (
    <Dialog.Root open={!!statement} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-4 mb-3">
            <Dialog.Title className="text-base font-semibold text-foreground">
              對帳單明細{statement ? `（${formatMonthLabel(statement.statement_month)}）` : ""}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">載入中…</p>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>項目</TableHead>
                    <TableHead className="text-right whitespace-nowrap">金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">{l.description || "—"}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums whitespace-nowrap",
                          l.amount < 0 && "text-destructive"
                        )}
                      >
                        {l.amount < 0 ? `−${formatAmount(-l.amount)}` : formatAmount(l.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold text-sm">總計</TableCell>
                    <TableCell className="text-right font-semibold text-sm tabular-nums whitespace-nowrap">
                      {formatAmount(lines.reduce((s, l) => s + l.amount, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ----- 登錄收款 -----

interface CollectPaymentDialogProps {
  statement: StatementRow | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function CollectPaymentDialog({ statement, onOpenChange, onSuccess }: CollectPaymentDialogProps) {
  const [paidDate, setPaidDate] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [markOrdersPaid, setMarkOrdersPaid] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!statement) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setPaidDate(today);
    setPaidAmount(String(statement.total_amount));
    setMarkOrdersPaid(true);
  }, [statement]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!statement) return;
    const amount = Number(paidAmount);
    if (!paidDate || !Number.isFinite(amount)) {
      toast.error("請輸入收款日期與金額");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("channel_statements")
        .update({ status: "已收款", paid_date: paidDate, paid_amount: amount })
        .eq("id", statement.id);
      if (error) throw new Error(error.message);

      if (markOrdersPaid) {
        const { data: lineRows, error: lineErr } = await supabase
          .from("channel_statement_lines")
          .select("order_id")
          .eq("statement_id", statement.id)
          .eq("line_type", "order")
          .not("order_id", "is", null);
        if (lineErr) throw new Error(lineErr.message);
        const orderIds = ((lineRows ?? []) as any[]).map((r) => String(r.order_id));
        if (orderIds.length > 0) {
          const { error: updErr } = await supabase
            .from("orders")
            .update({ payment_status: "已結清" })
            .in("id", orderIds);
          if (updErr) throw new Error(updErr.message);
        }
      }

      toast.success("已登錄收款");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登錄收款失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={!!statement} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              登錄收款{statement ? `（${formatMonthLabel(statement.statement_month)}）` : ""}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">收款日期 *</label>
                <input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">收款金額 *</label>
                <input
                  type="number"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-right tabular-nums"
                  required
                />
              </div>
            </div>
            {statement && Number(paidAmount) !== statement.total_amount && (
              <p className="text-xs text-amber-700">
                收款金額與對帳單總額 {formatAmount(statement.total_amount)} 不同，將照實記錄。
              </p>
            )}
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={markOrdersPaid}
                onChange={(e) => setMarkOrdersPaid(e.target.checked)}
              />
              <span>
                同時將對帳單內訂單的付款狀態標記為「已結清」
                <span className="block text-xs text-muted-foreground">
                  通路訂單頁的已結清／未結清會即時反映
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "處理中…" : "確認收款"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
