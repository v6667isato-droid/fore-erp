"use client";

import { useCallback, useEffect, useState } from "react";
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
import { RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DiffLine {
  part_id: string;
  part_no: string;
  part_name: string;
  unit: string;
  expected: number;
  deducted: number;
  /** 應扣 − 已扣；正=還要補扣、負=要回沖 */
  diff: number;
}

interface OrderDiff {
  order_id: string;
  order_number: string;
  status: string;
  lines: DiffLine[];
  hasOrphan: boolean;
}

export interface ReconciliationTabProps {
  isAdmin?: boolean;
}

/**
 * 出貨對帳：訂單已出貨/結案後，比對「目前品項×BOM 應扣」與「實際已扣（含歷次調整）」。
 * 僅對「有扣帳紀錄」的品項對帳；庫品直出（無扣帳）與無 BOM 品項不列入。
 * 調整寫入後差異歸零，訂單自動從清單消失。
 */
export function ReconciliationTab({ isAdmin = false }: ReconciliationTabProps) {
  const [orders, setOrders] = useState<OrderDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  /** 取消勾選的差異列（key = orderId:partId），預設全選 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const fetchDiffs = useCallback(async () => {
    setLoading(true);
    const { data: movements, error: mvErr } = await supabase
      .from("stock_movements")
      .select("part_id, movement_type, quantity, order_id, work_order_id")
      .not("order_id", "is", null)
      .in("movement_type", ["領用", "對帳調整"]);
    if (mvErr) {
      setLoading(false);
      toast.error(mvErr.message || "無法載入扣帳紀錄");
      return;
    }
    const orderIds = [...new Set((movements ?? []).map((m) => m.order_id as string))];
    if (orderIds.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }
    const [ordersRes, itemsRes, partsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status")
        .in("id", orderIds)
        .in("status", ["已出貨", "結案"])
        .is("deleted_at", null),
      supabase
        .from("order_items")
        .select("id, order_id, variant_id, quantity, work_orders(id)")
        .in("order_id", orderIds),
      supabase.from("parts").select("id, part_no, name, unit"),
    ]);
    if (ordersRes.error || itemsRes.error || partsRes.error) {
      setLoading(false);
      toast.error(
        ordersRes.error?.message || itemsRes.error?.message || partsRes.error?.message || "載入失敗",
      );
      return;
    }
    const shippedOrders = ordersRes.data ?? [];
    const variantIds = [
      ...new Set((itemsRes.data ?? []).map((it) => it.variant_id).filter((v): v is string => v != null)),
    ];
    const { data: bomRows, error: bomErr } =
      variantIds.length > 0
        ? await supabase.from("bom_items").select("variant_id, part_id, quantity").in("variant_id", variantIds)
        : { data: [], error: null };
    setLoading(false);
    if (bomErr) {
      toast.error(bomErr.message || "無法載入 BOM");
      return;
    }

    const partInfo = new Map((partsRes.data ?? []).map((p) => [p.id, p]));
    const bomByVariant = new Map<string, { part_id: string; quantity: number }[]>();
    for (const b of bomRows ?? []) {
      if (!b.variant_id) continue;
      const list = bomByVariant.get(b.variant_id) ?? [];
      list.push({ part_id: b.part_id, quantity: Number(b.quantity) });
      bomByVariant.set(b.variant_id, list);
    }

    const result: OrderDiff[] = [];
    for (const ord of shippedOrders) {
      const orderMovements = (movements ?? []).filter((m) => m.order_id === ord.id);
      const orderItems = (itemsRes.data ?? []).filter((it) => it.order_id === ord.id);
      // 品項的工單 id → 品項；工單已被刪（品項刪除）的異動歸入 orphan
      const woToItem = new Map<string, (typeof orderItems)[number]>();
      for (const it of orderItems) {
        for (const wo of (it.work_orders as { id: string }[]) ?? []) woToItem.set(wo.id, it);
      }
      const deducted = new Map<string, number>();
      const coveredItemIds = new Set<string>();
      let hasOrphan = false;
      for (const m of orderMovements) {
        deducted.set(m.part_id, (deducted.get(m.part_id) ?? 0) - Number(m.quantity));
        const item = m.work_order_id ? woToItem.get(m.work_order_id) : undefined;
        if (item) coveredItemIds.add(item.id);
        else if (m.movement_type === "領用") hasOrphan = true;
      }
      const expected = new Map<string, number>();
      for (const it of orderItems) {
        if (!coveredItemIds.has(it.id) || !it.variant_id) continue;
        for (const b of bomByVariant.get(it.variant_id) ?? []) {
          expected.set(b.part_id, (expected.get(b.part_id) ?? 0) + b.quantity * (it.quantity ?? 1));
        }
      }
      const partIds = new Set([...deducted.keys(), ...expected.keys()]);
      const lines: DiffLine[] = [];
      for (const pid of partIds) {
        const e = expected.get(pid) ?? 0;
        const d = deducted.get(pid) ?? 0;
        if (e === d) continue;
        const info = partInfo.get(pid);
        lines.push({
          part_id: pid,
          part_no: info?.part_no ?? "?",
          part_name: info?.name ?? "（零件已刪除）",
          unit: info?.unit ?? "",
          expected: e,
          deducted: d,
          diff: e - d,
        });
      }
      if (lines.length > 0) {
        lines.sort((a, b) => a.part_no.localeCompare(b.part_no));
        result.push({
          order_id: ord.id,
          order_number: ord.order_number,
          status: ord.status ?? "",
          lines,
          hasOrphan,
        });
      }
    }
    result.sort((a, b) => b.order_number.localeCompare(a.order_number));
    setOrders(result);
    setUnchecked(new Set());
  }, []);

  useEffect(() => {
    void fetchDiffs();
  }, [fetchDiffs]);

  async function applyAdjustments(order: OrderDiff) {
    const lines = order.lines.filter((l) => !unchecked.has(`${order.order_id}:${l.part_id}`));
    if (lines.length === 0) {
      toast.info("沒有勾選任何差異列");
      return;
    }
    setBusyOrderId(order.order_id);
    const payload = lines.map((l) => ({
      part_id: l.part_id,
      movement_type: "對帳調整",
      quantity: -l.diff,
      order_id: order.order_id,
      notes: `出貨對帳 ${order.order_number}`,
    }));
    const { error } = await supabase.from("stock_movements").insert(payload);
    setBusyOrderId(null);
    if (error) {
      toast.error(error.message || "寫入調整失敗");
      return;
    }
    toast.success(`已調整 ${order.order_number} 的 ${lines.length} 項零件`);
    void fetchDiffs();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" role="status">
        比對出貨訂單扣帳中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          已出貨／結案訂單的「應扣（目前品項×BOM）」與「已扣」不一致時列在這裡；寫入調整後自動消失。
        </p>
        <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => void fetchDiffs()}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          重新比對
        </Button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <Scale className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" aria-hidden />
          沒有需要對帳的訂單，帳是平的
        </div>
      ) : (
        orders.map((ord) => (
          <div key={ord.order_id} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">{ord.order_number}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{ord.status}</span>
              {ord.hasOrphan && (
                <span className="text-xs text-amber-700 dark:text-amber-400">含已刪除品項的扣帳</span>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  className="ml-auto h-8 px-3 text-xs"
                  disabled={busyOrderId === ord.order_id}
                  onClick={() => void applyAdjustments(ord)}
                >
                  {busyOrderId === ord.order_id ? "寫入中…" : "寫入勾選的調整"}
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border">
                    {isAdmin && <TableHead className="text-xs font-semibold p-2 w-[44px]" aria-label="勾選" />}
                    <TableHead className="text-xs font-semibold p-2">料號</TableHead>
                    <TableHead className="text-xs font-semibold p-2">零件</TableHead>
                    <TableHead className="text-xs font-semibold p-2 text-right">應扣</TableHead>
                    <TableHead className="text-xs font-semibold p-2 text-right">已扣</TableHead>
                    <TableHead className="text-xs font-semibold p-2 text-right">調整</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ord.lines.map((l) => {
                    const key = `${ord.order_id}:${l.part_id}`;
                    return (
                      <TableRow key={l.part_id} className="border-b border-border">
                        {isAdmin && (
                          <TableCell className="p-2">
                            <input
                              type="checkbox"
                              checked={!unchecked.has(key)}
                              onChange={(e) =>
                                setUnchecked((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                              className="h-4 w-4 rounded border-input accent-[var(--primary)]"
                              aria-label={`勾選 ${l.part_name}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-sm p-2 font-medium whitespace-nowrap">{l.part_no}</TableCell>
                        <TableCell className="text-sm p-2">{l.part_name}</TableCell>
                        <TableCell className="text-sm p-2 text-right tabular-nums">{l.expected}</TableCell>
                        <TableCell className="text-sm p-2 text-right tabular-nums">{l.deducted}</TableCell>
                        <TableCell className="text-sm p-2 text-right tabular-nums">
                          <span className={cn("font-medium", l.diff > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
                            {l.diff > 0 ? `補扣 ${l.diff}` : `回沖 ${-l.diff}`}
                            {l.unit ? ` ${l.unit}` : ""}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
