"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { supabase } from "@/lib/supabase";
import type { OrderRow } from "@/components/orders/types";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const labelCls = "text-xs font-medium text-muted-foreground";

type OrderItemRow = {
  id: string;
  quantity: number;
  unit_price: number;
  channel_unit_price: number | null;
  custom_name: string | null;
  product_variants: { product_code: string; product_series: { series_name: string } | null } | null;
};

type ReturnRecord = {
  id: string;
  return_date: string;
  refund_amount: number;
  reason: string | null;
  notes: string | null;
  order_return_items: { id: string; description: string | null; quantity: number }[];
};

function itemLabel(it: OrderItemRow): string {
  const seriesName = it.product_variants?.product_series?.series_name ?? "";
  const fallback = [seriesName, it.product_variants?.product_code ?? ""].filter(Boolean).join(" ");
  return it.custom_name?.trim() || fallback || "商品";
}

function todayYmd(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * 訂單退貨（MVP）：寫入 order_returns／order_return_items，整單退貨時將訂單標記「已退貨」。
 * 發票折讓／作廢與零件庫存回沖維持手動流程（提交後以提示引導）。
 */
export function OrderReturnDialog({
  order,
  open,
  onOpenChange,
  onSaved,
}: {
  order: OrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<OrderItemRow[] | null>(null);
  const [returns, setReturns] = useState<ReturnRecord[] | null>(null);
  const [inSettlementBatch, setInSettlementBatch] = useState(false);

  const [returnDate, setReturnDate] = useState(todayYmd());
  /** order_item_id → 退貨數量（未勾選則不在 map 中） */
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({});
  const [refundAmount, setRefundAmount] = useState("");
  const [refundTouched, setRefundTouched] = useState(false);
  const [markReturned, setMarkReturned] = useState(true);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReturnRecord | null>(null);

  async function reloadReturns(orderId: string) {
    const { data, error } = await supabase
      .from("order_returns")
      .select("id, return_date, refund_amount, reason, notes, order_return_items (id, description, quantity)")
      .eq("order_id", orderId)
      .order("return_date", { ascending: false });
    if (error) {
      toast.error(error.message || "載入退貨紀錄失敗");
      return;
    }
    setReturns((data ?? []) as unknown as ReturnRecord[]);
  }

  useEffect(() => {
    if (!open || !order) return;
    setItems(null);
    setReturns(null);
    setInSettlementBatch(false);
    setReturnDate(todayYmd());
    setSelectedQty({});
    setRefundAmount("");
    setRefundTouched(false);
    setMarkReturned(true);
    setReason("");
    setNotes("");
    void (async () => {
      const [itemsRes, orderRes] = await Promise.all([
        supabase
          .from("order_items")
          .select(
            "id, quantity, unit_price, channel_unit_price, custom_name, line_order, product_variants (product_code, product_series (series_name))",
          )
          .eq("order_id", order.id)
          .order("line_order", { ascending: true }),
        supabase
          .from("orders")
          .select("channel_settlement_batch_id")
          .eq("id", order.id)
          .maybeSingle(),
      ]);
      if (itemsRes.error) {
        toast.error(itemsRes.error.message || "載入訂單品項失敗");
        return;
      }
      const rows = (itemsRes.data ?? []) as unknown as OrderItemRow[];
      setItems(rows);
      // 預設整單退貨：全選、全數量
      setSelectedQty(Object.fromEntries(rows.map((r) => [r.id, r.quantity])));
      setInSettlementBatch(
        Boolean((orderRes.data as { channel_settlement_batch_id: string | null } | null)?.channel_settlement_batch_id),
      );
      await reloadReturns(order.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟時載入一次
  }, [open, order?.id]);

  const selectedAmount = useMemo(() => {
    if (!items) return 0;
    let sum = 0;
    for (const it of items) {
      const qty = selectedQty[it.id];
      if (!qty) continue;
      sum += (it.channel_unit_price ?? it.unit_price) * qty;
    }
    return sum;
  }, [items, selectedQty]);

  // 未手動改過退款金額時，隨勾選品項自動帶入（依通路價優先，可再手動修正）
  useEffect(() => {
    if (!refundTouched) setRefundAmount(selectedAmount > 0 ? String(selectedAmount) : "");
  }, [selectedAmount, refundTouched]);

  const allSelectedFull =
    items != null &&
    items.length > 0 &&
    items.every((it) => (selectedQty[it.id] ?? 0) >= it.quantity);

  function toggleItem(it: OrderItemRow, checked: boolean) {
    setSelectedQty((prev) => {
      const next = { ...prev };
      if (checked) next[it.id] = it.quantity;
      else delete next[it.id];
      return next;
    });
  }

  async function submitReturn() {
    if (!order) return;
    const selected = (items ?? []).filter((it) => (selectedQty[it.id] ?? 0) > 0);
    if (selected.length === 0) {
      toast.error("請至少勾選一項退貨品項");
      return;
    }
    const amount = Number(refundAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("退款金額格式錯誤");
      return;
    }
    if (!returnDate) {
      toast.error("請填退貨日期");
      return;
    }
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("order_returns")
        .insert({
          order_id: order.id,
          return_date: returnDate,
          refund_amount: amount,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        toast.error(error?.message || "建立退貨紀錄失敗");
        return;
      }
      const { error: itemsError } = await supabase.from("order_return_items").insert(
        selected.map((it) => ({
          return_id: inserted.id,
          order_item_id: it.id,
          description: itemLabel(it),
          quantity: selectedQty[it.id],
        })),
      );
      if (itemsError) {
        toast.error(itemsError.message || "寫入退貨品項失敗");
        return;
      }
      if (markReturned) {
        const { error: statusError } = await supabase
          .from("orders")
          .update({ status: "已退貨" })
          .eq("id", order.id);
        if (statusError) {
          toast.error(statusError.message || "退貨紀錄已建立，但更新訂單狀態失敗");
        }
      }
      toast.success("已建立退貨紀錄");
      toast.info("發票請至「會計＞銷項發票」開折讓（當期可作廢）；零件如需回庫請用「庫存＞盤點調整」。", {
        duration: 9000,
      });
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function performDeleteReturn() {
    if (!order || !deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const { error } = await supabase.from("order_returns").delete().eq("id", target.id);
    if (error) {
      toast.error(error.message || "刪除退貨紀錄失敗");
      return;
    }
    // 最後一筆退貨刪除後，訂單狀態自「已退貨」還原為「結案」
    const remaining = (returns ?? []).filter((r) => r.id !== target.id);
    if (remaining.length === 0 && order.status === "已退貨") {
      const { error: statusError } = await supabase
        .from("orders")
        .update({ status: "結案" })
        .eq("id", order.id);
      if (statusError) toast.error(statusError.message || "還原訂單狀態失敗");
      else toast.info("訂單狀態已還原為「結案」");
    }
    toast.success("已刪除退貨紀錄");
    setReturns(remaining);
    onSaved();
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
            aria-describedby="order-return-desc"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  訂單退貨：{order?.order_number ?? ""}
                </Dialog.Title>
                <p id="order-return-desc" className="mt-1 text-sm text-muted-foreground">
                  退款金額於營收統計按退貨日期月份扣除；訂單原金額不變。
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent/40"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </Dialog.Close>
            </div>

            {inSettlementBatch && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                此訂單已列入通路結算批次，退貨後請與會計確認結算金額是否需調整。
              </p>
            )}

            {returns != null && returns.length > 0 && (
              <div className="mt-4">
                <p className={labelCls}>既有退貨紀錄</p>
                <div className="mt-1 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">退貨日</th>
                        <th className="px-2 py-2 font-medium">品項</th>
                        <th className="px-2 py-2 text-right font-medium">退款金額</th>
                        <th className="px-2 py-2 font-medium">原因</th>
                        <th className="px-3 py-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {returns.map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-foreground">
                            {r.return_date}
                          </td>
                          <td className="px-2 py-2 text-foreground">
                            {r.order_return_items
                              .map((ri) => `${ri.description ?? "品項"}×${ri.quantity}`)
                              .join("、") || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-foreground">
                            ${Number(r.refund_amount).toLocaleString()}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">{r.reason ?? "—"}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="刪除退貨紀錄"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <p className={labelCls}>退貨品項</p>
                {items == null ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">載入品項中…</p>
                ) : items.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">此訂單沒有品項。</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-1 rounded-lg border border-border p-2">
                    {items.map((it) => {
                      const qty = selectedQty[it.id] ?? 0;
                      const checked = qty > 0;
                      return (
                        <label
                          key={it.id}
                          className="flex flex-wrap items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/30"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleItem(it, e.target.checked)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="min-w-0 flex-1 text-foreground">{itemLabel(it)}</span>
                          <span className="text-xs text-muted-foreground">
                            ${(it.channel_unit_price ?? it.unit_price).toLocaleString()}／件
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            退
                            <input
                              type="number"
                              min={1}
                              max={it.quantity}
                              value={checked ? qty : ""}
                              disabled={!checked}
                              onChange={(e) => {
                                const v = Math.max(
                                  1,
                                  Math.min(it.quantity, Math.floor(Number(e.target.value) || 1)),
                                );
                                setSelectedQty((prev) => ({ ...prev, [it.id]: v }));
                              }}
                              className="h-7 w-14 rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums disabled:opacity-40"
                            />
                            ／{it.quantity}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="order-return-date">
                    退貨日期
                  </label>
                  <input
                    id="order-return-date"
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="order-return-amount">
                    退款金額（含稅）
                  </label>
                  <input
                    id="order-return-amount"
                    type="number"
                    min={0}
                    value={refundAmount}
                    onChange={(e) => {
                      setRefundTouched(true);
                      setRefundAmount(e.target.value);
                    }}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="order-return-reason">
                    退貨原因
                  </label>
                  <input
                    id="order-return-reason"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例：瑕疵、客戶取消"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="order-return-notes">
                    備註
                  </label>
                  <input
                    id="order-return-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="退款方式、後續處理等"
                    className={inputCls}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={markReturned}
                  onChange={(e) => setMarkReturned(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                訂單標記為「已退貨」
                {!allSelectedFull && (
                  <span className="text-xs text-muted-foreground">（部分退貨可不勾，維持原狀態）</span>
                )}
              </label>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="h-8 px-3 text-sm">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                className="h-8 px-3 text-sm"
                disabled={saving || items == null || items.length === 0}
                onClick={() => void submitReturn()}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                {saving ? "建立中…" : "建立退貨紀錄"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="是否刪除此筆退貨紀錄？"
        description={
          deleteTarget ? (
            <p className="text-muted-foreground">
              {deleteTarget.return_date}／退款 ${Number(deleteTarget.refund_amount).toLocaleString()}
              ；刪除後營收統計不再扣除此金額。
            </p>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={() => void performDeleteReturn()}
        destructive
      />
    </>
  );
}
