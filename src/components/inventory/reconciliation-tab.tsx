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
import type { MaterialRow } from "@/types/inventory";
import {
  applicableBomLines,
  fetchMaterials,
  resolveMaterialCode,
  specKeyFromSpec1,
} from "@/lib/part-variants";

interface MovementRow {
  part_id: string;
  part_variant_id: string | null;
  movement_type: string;
  quantity: number;
  order_id: string | null;
  work_order_id: string | null;
}

interface OrderItemRow {
  id: string;
  order_id: string | null;
  variant_id: string | null;
  quantity: number;
  wood_type: string | null;
  work_orders: { id: string }[] | null;
  product_variants: { series_id: string | null; wood_type: string | null; spec1: string | null } | null;
}

interface BomLineJoined {
  series_id: string;
  line_type: string;
  part_id: string | null;
  part_variant_id: string | null;
  quantity: number;
  exclusive_key: string | null;
  parts: { name: string; deleted_at: string | null } | null;
  part_variants: { part_id: string; deleted_at: string | null } | null;
}

interface VariantInfo {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  material_name: string | null;
  unit: string;
}

interface DiffLine {
  /** 變體 id；舊資料無變體時為 part:{part_id} */
  key: string;
  part_id: string;
  variant_id: string | null;
  sku: string;
  name: string;
  material_name: string | null;
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
  /** 無法展開應扣的品項警示（材質無法對應或缺變體） */
  warnings: string[];
  hasOrphan: boolean;
}

export interface ReconciliationTabProps {
  isAdmin?: boolean;
}

/**
 * 出貨對帳：訂單已出貨/結案後，比對「目前品項×系列 BOM 展開的應扣」與「實際已扣（含歷次調整）」。
 * 展開語義與 DB trigger work_orders_auto_deduct_parts 相同：
 * 材質＝品項 wood_type（有值優先）→ 產品規格 wood_type，經 materials 對照成代碼；
 * 座墊互斥依 spec1 尾碼過濾；隨單材質線落到 part_id×材質 的變體、固定線直接取變體。
 * 僅對「有扣帳紀錄」的品項對帳；庫品直出（無扣帳）與無 BOM 品項不列入。
 * 調整寫入後差異歸零，訂單自動從清單消失。
 */
export function ReconciliationTab({ isAdmin = false }: ReconciliationTabProps) {
  const [orders, setOrders] = useState<OrderDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  /** 取消勾選的差異列（key = orderId:lineKey），預設全選 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const fetchDiffs = useCallback(async () => {
    setLoading(true);
    const { data: movementsData, error: mvErr } = await supabase
      .from("stock_movements")
      .select("part_id, part_variant_id, movement_type, quantity, order_id, work_order_id")
      .not("order_id", "is", null)
      .in("movement_type", ["領用", "對帳調整"]);
    if (mvErr) {
      setLoading(false);
      toast.error(mvErr.message || "無法載入扣帳紀錄");
      return;
    }
    const movements = (movementsData as MovementRow[]) ?? [];
    const orderIds = [...new Set(movements.map((m) => m.order_id as string))];
    if (orderIds.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let materials: MaterialRow[];
    try {
      materials = await fetchMaterials();
    } catch (e) {
      setLoading(false);
      toast.error(e instanceof Error ? e.message : "無法載入材質對照表");
      return;
    }

    const [ordersRes, itemsRes, partVariantsRes, variantInfoRes, partsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status")
        .in("id", orderIds)
        .in("status", ["已出貨", "結案"])
        .is("deleted_at", null),
      supabase
        .from("order_items")
        .select(
          "id, order_id, variant_id, quantity, wood_type, work_orders(id), product_variants!variant_id(series_id, wood_type, spec1)",
        )
        .in("order_id", orderIds),
      supabase.from("part_variants").select("id, part_id, material_code").is("deleted_at", null),
      supabase.from("part_variant_stock_status").select("id, part_id, sku, name, material_name, unit"),
      supabase.from("parts").select("id, part_no, name, unit"),
    ]);
    if (ordersRes.error || itemsRes.error || partVariantsRes.error || variantInfoRes.error || partsRes.error) {
      setLoading(false);
      toast.error(
        ordersRes.error?.message ||
          itemsRes.error?.message ||
          partVariantsRes.error?.message ||
          variantInfoRes.error?.message ||
          partsRes.error?.message ||
          "載入失敗",
      );
      return;
    }
    const shippedOrders = ordersRes.data ?? [];
    const orderItems = (itemsRes.data as unknown as OrderItemRow[]) ?? [];

    const seriesIds = [
      ...new Set(
        orderItems.map((it) => it.product_variants?.series_id).filter((s): s is string => s != null),
      ),
    ];
    const { data: bomData, error: bomErr } =
      seriesIds.length > 0
        ? await supabase
            .from("bom_lines")
            .select(
              "series_id, line_type, part_id, part_variant_id, quantity, exclusive_key, " +
                "parts!part_id(name, deleted_at), part_variants!part_variant_id(part_id, deleted_at)",
            )
            .in("series_id", seriesIds)
        : { data: [], error: null };
    setLoading(false);
    if (bomErr) {
      toast.error(bomErr.message || "無法載入 BOM");
      return;
    }

    // 系列 → BOM 線（目標已軟刪除者不計入應扣）
    const bomBySeries = new Map<string, BomLineJoined[]>();
    for (const b of (bomData as unknown as BomLineJoined[]) ?? []) {
      if (b.line_type === "by_material") {
        if (!b.parts || b.parts.deleted_at) continue;
      } else {
        if (!b.part_variants || b.part_variants.deleted_at) continue;
      }
      const list = bomBySeries.get(b.series_id) ?? [];
      list.push(b);
      bomBySeries.set(b.series_id, list);
    }

    // part_id × 材質代碼 → 變體 id（隨單材質線 resolve 用；無材質軸以 "" 為鍵）
    const variantByPartMaterial = new Map<string, string>();
    const variantPartId = new Map<string, string>();
    for (const v of partVariantsRes.data ?? []) {
      variantByPartMaterial.set(`${v.part_id}:${v.material_code ?? ""}`, v.id);
      variantPartId.set(v.id, v.part_id);
    }
    // 已軟刪除變體仍可能留在扣帳紀錄／固定線上，補齊 part_id 對照
    for (const m of movements) {
      if (m.part_variant_id) variantPartId.set(m.part_variant_id, m.part_id);
    }
    for (const lines of bomBySeries.values()) {
      for (const b of lines) {
        if (b.line_type === "fixed" && b.part_variant_id && b.part_variants) {
          variantPartId.set(b.part_variant_id, b.part_variants.part_id);
        }
      }
    }

    const variantInfo = new Map<string, VariantInfo>(
      (((variantInfoRes.data as unknown as VariantInfo[]) ?? [])).map((v) => [v.id, v]),
    );
    const partInfo = new Map((partsRes.data ?? []).map((p) => [p.id, p]));

    const result: OrderDiff[] = [];
    for (const ord of shippedOrders) {
      const orderMovements = movements.filter((m) => m.order_id === ord.id);
      const ordItems = orderItems.filter((it) => it.order_id === ord.id);
      // 品項的工單 id → 品項；工單已被刪（品項刪除）的異動歸入 orphan
      const woToItem = new Map<string, OrderItemRow>();
      for (const it of ordItems) {
        for (const wo of it.work_orders ?? []) woToItem.set(wo.id, it);
      }
      const deducted = new Map<string, number>();
      const coveredItemIds = new Set<string>();
      let hasOrphan = false;
      for (const m of orderMovements) {
        const key = m.part_variant_id ?? `part:${m.part_id}`;
        deducted.set(key, (deducted.get(key) ?? 0) - Number(m.quantity));
        const item = m.work_order_id ? woToItem.get(m.work_order_id) : undefined;
        if (item) coveredItemIds.add(item.id);
        else if (m.movement_type === "領用") hasOrphan = true;
      }

      const expected = new Map<string, number>();
      const warnings = new Set<string>();
      for (const it of ordItems) {
        if (!coveredItemIds.has(it.id) || !it.variant_id) continue;
        const pv = it.product_variants;
        if (!pv?.series_id) continue;
        const seriesLines = bomBySeries.get(pv.series_id) ?? [];
        if (seriesLines.length === 0) continue;
        const woodRaw = (it.wood_type ?? "").trim() || (pv.wood_type ?? "").trim();
        const matCode = resolveMaterialCode(woodRaw, materials);
        const specKey = specKeyFromSpec1(pv.spec1);
        for (const line of applicableBomLines(seriesLines, specKey)) {
          const qty = Number(line.quantity) * (it.quantity ?? 1);
          let vid: string | null;
          if (line.line_type === "fixed") {
            vid = line.part_variant_id;
          } else {
            vid = line.part_id
              ? variantByPartMaterial.get(`${line.part_id}:${matCode ?? ""}`) ?? null
              : null;
            if (!vid) {
              warnings.add(`缺變體：${line.parts?.name ?? "?"} × 材質 ${matCode ?? (woodRaw || "未指定")}`);
              continue;
            }
          }
          if (!vid) continue;
          expected.set(vid, (expected.get(vid) ?? 0) + qty);
        }
      }

      const keys = new Set([...deducted.keys(), ...expected.keys()]);
      const lines: DiffLine[] = [];
      for (const key of keys) {
        const e = expected.get(key) ?? 0;
        const d = deducted.get(key) ?? 0;
        if (e === d) continue;
        if (key.startsWith("part:")) {
          // 舊資料：扣帳未帶變體，退回以邏輯零件對帳（目前沒有這種紀錄）
          const pid = key.slice("part:".length);
          const info = partInfo.get(pid);
          lines.push({
            key,
            part_id: pid,
            variant_id: null,
            sku: info?.part_no ?? "?",
            name: info?.name ?? "（零件已刪除）",
            material_name: null,
            unit: info?.unit ?? "",
            expected: e,
            deducted: d,
            diff: e - d,
          });
          continue;
        }
        const info = variantInfo.get(key);
        const pid = info?.part_id ?? variantPartId.get(key);
        if (!pid) continue; // 無法回推 part_id（不應發生），略過避免寫出壞資料
        const part = partInfo.get(pid);
        lines.push({
          key,
          part_id: pid,
          variant_id: key,
          sku: info?.sku ?? "?",
          name: info?.name ?? part?.name ?? "（零件已刪除）",
          material_name: info?.material_name ?? null,
          unit: info?.unit ?? part?.unit ?? "",
          expected: e,
          deducted: d,
          diff: e - d,
        });
      }
      if (lines.length > 0 || warnings.size > 0) {
        lines.sort((a, b) => a.sku.localeCompare(b.sku));
        result.push({
          order_id: ord.id,
          order_number: ord.order_number,
          status: ord.status ?? "",
          lines,
          warnings: [...warnings],
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
    const lines = order.lines.filter((l) => !unchecked.has(`${order.order_id}:${l.key}`));
    if (lines.length === 0) {
      toast.info("沒有勾選任何差異列");
      return;
    }
    setBusyOrderId(order.order_id);
    const payload = lines.map((l) => ({
      part_id: l.part_id,
      part_variant_id: l.variant_id,
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
          已出貨／結案訂單的「應扣（目前品項×系列 BOM 展開）」與「已扣」不一致時列在這裡；寫入調整後自動消失。
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
              {isAdmin && ord.lines.length > 0 && (
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
            {ord.warnings.length > 0 && (
              <div className="flex flex-col gap-0.5 border-b border-border px-4 py-2">
                {ord.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
                    {w}（無法計入應扣，請先補建變體或修正材質）
                  </p>
                ))}
              </div>
            )}
            {ord.lines.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-border">
                      {isAdmin && <TableHead className="text-xs font-semibold p-2 w-[44px]" aria-label="勾選" />}
                      <TableHead className="text-xs font-semibold p-2">SKU</TableHead>
                      <TableHead className="text-xs font-semibold p-2">零件</TableHead>
                      <TableHead className="text-xs font-semibold p-2 text-right">應扣</TableHead>
                      <TableHead className="text-xs font-semibold p-2 text-right">已扣</TableHead>
                      <TableHead className="text-xs font-semibold p-2 text-right">調整</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ord.lines.map((l) => {
                      const key = `${ord.order_id}:${l.key}`;
                      return (
                        <TableRow key={l.key} className="border-b border-border">
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
                                aria-label={`勾選 ${l.name}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="text-sm p-2 font-medium whitespace-nowrap">{l.sku}</TableCell>
                          <TableCell className="text-sm p-2">
                            {l.name}
                            {l.material_name ? `（${l.material_name}）` : ""}
                          </TableCell>
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
            )}
          </div>
        ))
      )}
    </div>
  );
}
