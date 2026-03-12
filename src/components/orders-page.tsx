"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Search, Plus, X } from "lucide-react";
import { toast } from "sonner";

type OrderStatus = "報價中" | "排程中" | "生產中" | "已出貨";
type PaymentStatus = "未付款" | "部分付款" | "已付訂金" | "已結清";

interface OrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  total_amount: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_id: string | null;
  customer_name: string;
   deposit_amount: number;
}

interface CustomerOption {
  id: string;
  name: string;
  delivery_address: string | null;
}

interface VariantOption {
  id: string;
  series_id: string;
  series_name: string;
  label: string;
  base_price: number | null;
}

interface OrderItemInput {
  id: string;
  variant_id: string;
  series_id?: string | null;
  quantity: number;
  unit_price: number;
  custom_notes: string;
  kind: "variant" | "custom";
  custom_category?: string | null;
  custom_name?: string | null;
  custom_description?: string | null;
  custom_dimension_w?: number | null;
  custom_dimension_d?: number | null;
  custom_dimension_h?: number | null;
}

const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "報價中",
  "排程中",
  "生產中",
  "已出貨",
];

const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  "未付款",
  "已付訂金",
  "已結清",
];

const statusStyles: Record<OrderStatus, string> = {
  報價中:
    "bg-[var(--badge-pending)] text-[var(--badge-pending-fg)] border-transparent",
  排程中:
    "bg-[var(--badge-progress)] text-[var(--badge-progress-fg)] border-transparent",
  生產中:
    "bg-[var(--badge-progress)] text-[var(--badge-progress-fg)] border-transparent",
  已出貨:
    "bg-[var(--badge-done)] text-[var(--badge-done-fg)] border-transparent",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={statusStyles[status] ?? ""}>
      {status}
    </Badge>
  );
}

function generateOrderNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `ORD-${ymd}-${suffix}`;
}

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerOption[];
  variants: VariantOption[];
  initialOrder?: OrderRow | null;
  initialItems?: OrderItemInput[];
  onSaved: () => void;
}

function OrderFormDialog({
  open,
  onOpenChange,
  customers,
  variants,
  initialOrder,
  initialItems,
  onSaved,
}: OrderFormProps) {
  const isEdit = Boolean(initialOrder);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState<string>(
    initialOrder?.customer_id ?? ""
  );
  const [orderDate, setOrderDate] = useState<string>(
    initialOrder?.order_date ?? ""
  );
  const [expectedDate, setExpectedDate] = useState<string>(
    initialOrder?.expected_delivery_date ?? ""
  );
  const [status, setStatus] = useState<OrderStatus>(
    initialOrder?.status ?? "報價中"
  );
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    initialOrder?.payment_status ?? "未付款"
  );
  const [deposit, setDeposit] = useState<string>(
    initialOrder?.total_amount ? "0" : "0"
  );
  const [depositPercent, setDepositPercent] = useState<string>("");
  const [shippingAddress, setShippingAddress] = useState<string>("");
  const [internalNotes, setInternalNotes] = useState<string>(
    ""
  );
  const [items, setItems] = useState<OrderItemInput[]>(
    initialItems && initialItems.length
      ? initialItems
      : [
          {
            id: "item-0",
            variant_id: "",
            quantity: 1,
            unit_price: 0,
            custom_notes: "",
            kind: "variant",
          },
        ]
  );

  useEffect(() => {
    if (initialOrder) {
      setCustomerId(initialOrder.customer_id ?? "");
      setOrderDate(initialOrder.order_date ?? "");
      setExpectedDate(initialOrder.expected_delivery_date ?? "");
      setStatus(initialOrder.status);
      setPaymentStatus(initialOrder.payment_status);
    }
    if (initialItems && initialItems.length) {
      setItems(initialItems);
    }
  }, [initialOrder, initialItems]);

  // 每次以「新增模式」打開時，重置表單為空白狀態
  useEffect(() => {
    if (!open || initialOrder) return;
    setCustomerId("");
    setOrderDate("");
    setExpectedDate("");
    setStatus("報價中");
    setPaymentStatus("未付款");
    setDeposit("0");
    setShippingAddress("");
    setInternalNotes("");
    setItems([
      {
        id: "item-0",
        variant_id: "",
        quantity: 1,
        unit_price: 0,
        custom_notes: "",
        kind: "variant",
      },
    ]);
  }, [open, initialOrder]);

  // 若是編輯模式，初始化送貨地址為既有訂單上的地址
  useEffect(() => {
    if (initialOrder && initialOrder.customer_id === customerId) {
      // 保留原本訂單上的 shipping_address（若之後想支援，可在 props 傳入）
      // 目前維持空字串，由使用者自行輸入或使用客戶預設地址。
    }
  }, [initialOrder, customerId]);

  const itemRows = items;

  // 系列下拉選項：從 variants 推出唯一系列列表
  const seriesOptions = useMemo(() => {
    const map = new Map<string, string>();
    variants.forEach((v) => {
      if (!v.series_id) return;
      const name = v.series_name || v.series_id;
      map.set(v.series_id, name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [variants]);

  const itemSubtotals = itemRows.map(
    (it) => (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
  );
  const totalAmount = itemSubtotals.reduce((sum, v) => sum + v, 0);

  function updateItem(id: string, patch: Partial<OrderItemInput>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${prev.length + 1}`,
        variant_id: "",
        quantity: 1,
        unit_price: 0,
        custom_notes: "",
        kind: "variant",
      },
    ]);
  }

  function removeItem(id: string) {
    if (items.length <= 1) return;
    const confirmed = window.confirm("是否確定移除此筆訂單明細？");
    if (!confirmed) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) {
      toast.error("請選擇客戶");
      return;
    }
    const validItems = items.filter(
      (it) =>
        (it.kind === "variant" ? it.variant_id : it.custom_name) &&
        it.quantity > 0
    );
    if (!validItems.length) {
      toast.error("請至少新增一筆有效的品項");
      return;
    }

    setSaving(true);
    try {
      const orderPayload = {
        order_number: initialOrder?.order_number ?? generateOrderNumber(),
        customer_id: customerId,
        order_date: orderDate || null,
        expected_delivery_date: expectedDate || null,
        status,
        payment_status: paymentStatus,
        total_amount: totalAmount,
        deposit_amount: Number(deposit) || 0,
        shipping_address: shippingAddress || null,
        internal_notes: internalNotes || null,
      };

      let orderId = initialOrder?.id ?? null;

      if (!orderId) {
        const { data, error } = await supabase
          .from("orders")
          .insert(orderPayload)
          .select("id")
          .single();
        if (error || !data) {
          toast.error(error?.message || "建立訂單失敗");
          return;
        }
        orderId = data.id as string;
      } else {
        const { error } = await supabase
          .from("orders")
          .update(orderPayload)
          .eq("id", orderId);
        if (error) {
          toast.error(error.message || "更新訂單失敗");
          return;
        }
        // 先清空舊明細
        await supabase.from("order_items").delete().eq("order_id", orderId);
      }

      const itemsPayload = validItems.map((it) => ({
        order_id: orderId,
        variant_id: it.kind === "variant" ? it.variant_id || null : null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        custom_notes: it.custom_notes || null,
        custom_category: it.kind === "custom" ? it.custom_category || null : null,
        custom_name: it.kind === "custom" ? it.custom_name || null : null,
        custom_description:
          it.kind === "custom" ? it.custom_description || null : null,
        custom_dimension_w:
          it.kind === "custom" && it.custom_dimension_w != null
            ? it.custom_dimension_w
            : null,
        custom_dimension_d:
          it.kind === "custom" && it.custom_dimension_d != null
            ? it.custom_dimension_d
            : null,
        custom_dimension_h:
          it.kind === "custom" && it.custom_dimension_h != null
            ? it.custom_dimension_h
            : null,
      }));

      const { data: insertedItems, error: itemsError } = await supabase
        .from("order_items")
        .insert(itemsPayload)
        .select("id");
      if (itemsError) {
        toast.error(itemsError.message || "寫入訂單明細失敗");
        return;
      }

      // 依照 order_items 自動建立工單（work_orders）
      const workOrderPayload =
        (insertedItems ?? []).map((row: any) => ({
          order_item_id: row.id,
          stage: "待排程",
          status: "未開始",
        })) ?? [];
      if (workOrderPayload.length > 0) {
        const { error: woError } = await supabase
          .from("work_orders")
          .insert(workOrderPayload);
        if (woError) {
          // 不阻擋訂單建立，只提示
          console.error("建立工單失敗:", woError);
          toast.error("訂單已建立，但工單建立失敗，請稍後到生產看板檢查。");
        }
      }

      toast.success(isEdit ? "已更新訂單" : "已建立訂單");
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-0">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {isEdit ? "編輯訂單" : "新增訂單"}
              </Dialog.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                設定訂單主檔與品項明細。
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-4 flex flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  訂單主檔
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-customer"
                      className="text-xs text-muted-foreground"
                    >
                      客戶 *
                    </label>
                    <select
                      id="order-customer"
                      value={customerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setCustomerId(id);
                        const customer = customers.find((c) => c.id === id);
                        if (customer?.delivery_address) {
                          setShippingAddress(customer.delivery_address);
                        }
                      }}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      required
                    >
                      <option value="">請選擇客戶</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-date"
                      className="text-xs text-muted-foreground"
                    >
                      下單日期
                    </label>
                    <input
                      id="order-date"
                      type="date"
                      value={orderDate ?? ""}
                      onChange={(e) => setOrderDate(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-expected"
                      className="text-xs text-muted-foreground"
                    >
                      預計交貨日
                    </label>
                    <input
                      id="order-expected"
                      type="date"
                      value={expectedDate ?? ""}
                      onChange={(e) => setExpectedDate(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-status"
                      className="text-xs text-muted-foreground"
                    >
                      訂單狀態
                    </label>
                    <select
                      id="order-status"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as OrderStatus)
                      }
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {ORDER_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-payment"
                      className="text-xs text-muted-foreground"
                    >
                      付款狀態
                    </label>
                    <select
                      id="order-payment"
                      value={paymentStatus}
                      onChange={(e) =>
                        setPaymentStatus(e.target.value as PaymentStatus)
                      }
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {PAYMENT_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-shipping"
                      className="text-xs text-muted-foreground"
                    >
                      送貨地址
                    </label>
                    <textarea
                      id="order-shipping"
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="系統會自動帶入客戶預設地址，若不同可在此覆寫。"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-notes"
                      className="text-xs text-muted-foreground"
                    >
                      內部備註
                    </label>
                    <textarea
                      id="order-notes"
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      className="min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    明細品項
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={addItem}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    新增品項
                  </Button>
                </div>
                <div className="space-y-3">
                  {itemRows.map((it, idx) => (
                    <div
                      key={it.id}
                      className="rounded-lg border border-border bg-card/40 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          品項 {idx + 1}
                        </p>
                        {itemRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(it.id)}
                            className="text-[11px] text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-0.5"
                          >
                            移除
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>品項類型：</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(it.id, {
                                kind: "variant",
                                // 切回規格模式時保留原 variant_id / 價格
                              })
                            }
                            className={`rounded-full px-2 py-0.5 border text-[11px] ${
                              it.kind === "variant"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background"
                            }`}
                          >
                            規格庫
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(it.id, {
                                kind: "custom",
                                variant_id: "",
                              })
                            }
                            className={`rounded-full px-2 py-0.5 border text-[11px] ${
                              it.kind === "custom"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background"
                            }`}
                          >
                            客製品項
                          </button>
                        </div>
                      </div>

                      {it.kind === "variant" ? (
                        <>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                              <label className="text-xs text-muted-foreground">
                                系列
                              </label>
                              <select
                                value={it.series_id ?? ""}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    series_id: e.target.value || null,
                                    // 重選系列時先清空規格
                                    variant_id: "",
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">全部系列</option>
                                {seriesOptions.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-variant-${it.id}`}
                              >
                                產品規格 *
                              </label>
                              <select
                                id={`item-variant-${it.id}`}
                                value={it.variant_id}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  const selected = variants.find(
                                    (v) => v.id === value
                                  );
                                  updateItem(it.id, {
                                    variant_id: value,
                                    unit_price:
                                      selected?.base_price ??
                                      it.unit_price ??
                                      0,
                                  });
                                }}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                required
                              >
                                <option value="">請選擇規格</option>
                                {variants
                                  .filter((v) =>
                                    it.series_id
                                      ? v.series_id === it.series_id
                                      : true
                                  )
                                  .map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.series_name
                                        ? `${v.series_name} / ${v.label}`
                                        : v.label}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5 sm:col-span-1">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-qty-${it.id}`}
                              >
                                數量
                              </label>
                              <input
                                id={`item-qty-${it.id}`}
                                type="number"
                                min={1}
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    quantity: Number(e.target.value) || 1,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5 sm:col-span-1">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-price-${it.id}`}
                              >
                                成交單價
                              </label>
                              <input
                                id={`item-price-${it.id}`}
                                type="number"
                                min={0}
                                value={it.unit_price}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    unit_price:
                                      Number(e.target.value) || 0,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label
                              className="text-xs text-muted-foreground"
                              htmlFor={`item-notes-${it.id}`}
                            >
                              客製化備註
                            </label>
                            <textarea
                              id={`item-notes-${it.id}`}
                              value={it.custom_notes}
                              onChange={(e) =>
                                updateItem(it.id, {
                                  custom_notes: e.target.value,
                                })
                              }
                              className="min-h-[50px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                類別
                              </label>
                              <select
                                value={it.custom_category ?? ""}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    custom_category: e.target.value || null,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">請選擇類別</option>
                                <option value="桌">桌</option>
                                <option value="椅">椅</option>
                                <option value="櫃">櫃</option>
                                <option value="架">架</option>
                                <option value="其他">其他</option>
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                品名 *
                              </label>
                              <input
                                type="text"
                                value={it.custom_name ?? ""}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    custom_name: e.target.value,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                required
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                長 / 寬 / 高
                              </label>
                              <div className="grid grid-cols-3 gap-1.5">
                                <input
                                  type="number"
                                  placeholder="長"
                                  value={it.custom_dimension_w ?? ""}
                                  onChange={(e) =>
                                    updateItem(it.id, {
                                      custom_dimension_w:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    })
                                  }
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <input
                                  type="number"
                                  placeholder="寬"
                                  value={it.custom_dimension_d ?? ""}
                                  onChange={(e) =>
                                    updateItem(it.id, {
                                      custom_dimension_d:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    })
                                  }
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <input
                                  type="number"
                                  placeholder="高"
                                  value={it.custom_dimension_h ?? ""}
                                  onChange={(e) =>
                                    updateItem(it.id, {
                                      custom_dimension_h:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    })
                                  }
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-1.5">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                數量
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    quantity: Number(e.target.value) || 1,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                成交單價
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={it.unit_price}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    unit_price:
                                      Number(e.target.value) || 0,
                                  })
                                }
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-muted-foreground">
                              詳細描述 / 備註
                            </label>
                            <textarea
                              value={it.custom_description ?? ""}
                              onChange={(e) =>
                                updateItem(it.id, {
                                  custom_description: e.target.value,
                                })
                              }
                              className="min-h-[50px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </>
                      )}
                      <p className="text-xs text-muted-foreground text-right">
                        小計：{" "}
                        <span className="font-semibold text-foreground">
                          {itemSubtotals[idx].toLocaleString()}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-3 border-t border-border pt-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    總金額：
                    <span className="ml-1 text-lg font-semibold text-foreground">
                      {totalAmount.toLocaleString()}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        訂金比例
                      </span>
                      <select
                        value={depositPercent}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDepositPercent(v);
                          const p = Number(v);
                          if (p > 0 && totalAmount > 0) {
                            const amt = Math.round(
                              (totalAmount * p) / 100
                            );
                            setDeposit(String(amt));
                          }
                        }}
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">自訂</option>
                        <option value="30">30%</option>
                        <option value="40">40%</option>
                        <option value="50">50%</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        預收訂金
                      </span>
                      <input
                        id="order-deposit"
                        type="number"
                        min={0}
                        value={deposit}
                        onChange={(e) => setDeposit(e.target.value)}
                        className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        尾款金額
                      </span>
                      <span className="text-sm font-semibold text-foreground">
                        {Math.max(
                          totalAmount - (Number(deposit) || 0),
                          0
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-5 pt-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "儲存中…" : "儲存訂單"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "全部">("全部");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [editingItems, setEditingItems] = useState<OrderItemInput[] | undefined>(
    undefined
  );
  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<OrderRow | null>(null);

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      // 客戶選單：只連結到 customers.delivery_address
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("id, name, delivery_address")
        .order("name", { ascending: true });
      if (!customerError && customerData) {
        setCustomers(
          (customerData as any[]).map((c) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
            delivery_address: c.delivery_address
              ? String(c.delivery_address)
              : null,
          }))
        );
      } else {
        setCustomers([]);
      }

      // 產品系列名稱（用於規格庫先選系列）
      const { data: seriesData } = await supabase
        .from("product_series")
        .select("id, series_name")
        .order("id", { ascending: true });
      const seriesMap = new Map<string, string>();
      (seriesData ?? []).forEach((s: any) => {
        const name = s.series_name ?? "";
        seriesMap.set(String(s.id), String(name));
      });

      // 產品規格選單（含 series_id）
      const { data: variantData } = await supabase
        .from("product_variants")
        .select(
          "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, base_price"
        )
        .order("product_code", { ascending: true });
      setVariants(
        ((variantData ?? []) as any[]).map((v) => {
          const w = v.dimension_w ?? "";
          const d = v.dimension_d ?? "";
          const h = v.dimension_h ?? "";
          const parts = [w, d, h].filter((x: unknown) => x !== "");
          const dim =
            parts.length === 0
              ? ""
              : `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
          const seriesId = String(v.series_id ?? "");
          const seriesName = seriesMap.get(seriesId) ?? "";
          const labelParts = [
            v.product_code ?? "",
            v.wood_type ?? "",
            dim,
          ].filter((s: string) => s && s.trim());
          return {
            id: String(v.id),
            series_id: seriesId,
            series_name: seriesName,
            label: labelParts.join(" / "),
            base_price:
              v.base_price !== undefined && v.base_price !== null
                ? Number(v.base_price)
                : null,
          };
        })
      );

      await fetchOrders();
      setLoading(false);
    }

    async function fetchOrders() {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, deposit_amount, customer_id, customers(name)")
        .order("order_date", { ascending: false });

      if (error) {
        console.error("訂單讀取失敗:", error);
        toast.error("訂單讀取失敗");
        setOrders([]);
        return;
      }
      const rows = (data ?? []) as any[];
      setOrders(
        rows.map((row) => ({
          id: String(row.id),
          order_number: String(row.order_number ?? ""),
          order_date: row.order_date ?? null,
          expected_delivery_date: row.expected_delivery_date ?? null,
          total_amount: Number(row.total_amount ?? 0),
          status: (row.status as OrderStatus) ?? "報價中",
          payment_status:
            (row.payment_status as PaymentStatus) ?? "未付款",
          deposit_amount: Number(row.deposit_amount ?? 0),
          customer_id: row.customer_id ? String(row.customer_id) : null,
          customer_name:
            (row.customers && row.customers.name) ||
            (Array.isArray(row.customers) && row.customers[0]?.name) ||
            "",
        }))
      );
    }

    bootstrap();
  }, []);

  async function reloadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, deposit_amount, customer_id, customers(name)")
      .order("order_date", { ascending: false });

    if (error) {
      console.error("訂單讀取失敗:", error);
      toast.error("訂單讀取失敗");
      setOrders([]);
      return;
    }
    const rows = (data ?? []) as any[];
    setOrders(
      rows.map((row) => ({
        id: String(row.id),
        order_number: String(row.order_number ?? ""),
        order_date: row.order_date ?? null,
        expected_delivery_date: row.expected_delivery_date ?? null,
        total_amount: Number(row.total_amount ?? 0),
        status: (row.status as OrderStatus) ?? "報價中",
        payment_status:
          (row.payment_status as PaymentStatus) ?? "未付款",
        deposit_amount: Number(row.deposit_amount ?? 0),
        customer_id: row.customer_id ? String(row.customer_id) : null,
        customer_name:
          (row.customers && row.customers.name) ||
          (Array.isArray(row.customers) && row.customers[0]?.name) ||
          "",
      }))
    );
  }

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "全部" || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, search, statusFilter]);

  async function handleEdit(order: OrderRow) {
    // 讀取該訂單的明細
    const { data, error } = await supabase
      .from("order_items")
      .select(
        "id, variant_id, quantity, unit_price, custom_notes, custom_category, custom_name, custom_description, custom_dimension_w, custom_dimension_d, custom_dimension_h"
      )
      .eq("order_id", order.id);
    if (error) {
      toast.error(error.message || "讀取訂單明細失敗");
      return;
    }
    const items: OrderItemInput[] = ((data ?? []) as any[]).map((d, idx) => {
      const isCustom = !d.variant_id;
      return {
        id: d.id ? String(d.id) : `item-${idx}`,
        variant_id: d.variant_id ? String(d.variant_id) : "",
        quantity: Number(d.quantity ?? 1),
        unit_price: Number(d.unit_price ?? 0),
        custom_notes: d.custom_notes ?? "",
        kind: isCustom ? "custom" : "variant",
        custom_category: d.custom_category ?? null,
        custom_name: d.custom_name ?? null,
        custom_description: d.custom_description ?? null,
        custom_dimension_w:
          d.custom_dimension_w !== undefined && d.custom_dimension_w !== null
            ? Number(d.custom_dimension_w)
            : null,
        custom_dimension_d:
          d.custom_dimension_d !== undefined && d.custom_dimension_d !== null
            ? Number(d.custom_dimension_d)
            : null,
        custom_dimension_h:
          d.custom_dimension_h !== undefined && d.custom_dimension_h !== null
            ? Number(d.custom_dimension_h)
            : null,
      };
    });
    setEditingOrder(order);
    setEditingItems(items);
    setFormOpen(true);
  }

  function requestDelete(order: OrderRow) {
    setDeleteConfirmOrder(order);
  }

  async function performDeleteOrder() {
    if (!deleteConfirmOrder) return;
    const order = deleteConfirmOrder;
    setDeleteConfirmOrder(null);
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) {
      toast.error(error.message || "刪除訂單失敗");
      return;
    }
    toast.success("已刪除訂單");
    reloadOrders();
  }

  async function updateOrderInline(
    id: string,
    patch: Partial<Pick<OrderRow, "status" | "payment_status" | "deposit_amount">>
  ) {
    const payload: any = {};
    if (patch.status) payload.status = patch.status;
    if (patch.payment_status) payload.payment_status = patch.payment_status;
    if (patch.deposit_amount !== undefined) {
      payload.deposit_amount = patch.deposit_amount;
    }
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase.from("orders").update(payload).eq("id", id);
    if (error) {
      toast.error(error.message || "更新訂單狀態失敗");
      return;
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, ...patch } : o
      )
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入訂單中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜尋訂單編號或客戶..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-72"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {(["全部", ...ORDER_STATUS_OPTIONS] as const).map((f) => (
              <button
                key={f}
                onClick={() =>
                  setStatusFilter(f === "全部" ? "全部" : (f as OrderStatus))
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent/40"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button
            type="button"
            className="h-9 px-3 text-xs"
            onClick={() => {
              setEditingOrder(null);
              setEditingItems(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            新增訂單
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold">訂單編號</TableHead>
              <TableHead className="text-xs font-semibold">客戶姓名</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                下單日
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                訂單狀態
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                付款狀態
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell text-right">
                訂金
              </TableHead>
              <TableHead className="text-xs font-semibold text-right">
                總金額
              </TableHead>
              <TableHead
                className="text-xs font-semibold text-right min-w-[120px]"
                aria-label="操作"
              >
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                      colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  查無符合條件的訂單
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order) => (
                <TableRow key={order.id} className="group">
                  <TableCell className="font-mono text-xs font-medium">
                    {order.order_number}
                  </TableCell>
                  <TableCell className="text-sm">{order.customer_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {order.order_date ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <select
                      value={order.status}
                      onChange={(e) =>
                        updateOrderInline(order.id, {
                          status: e.target.value as OrderStatus,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {ORDER_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    <select
                      value={order.payment_status}
                      onChange={(e) =>
                        updateOrderInline(order.id, {
                          payment_status: e.target.value as PaymentStatus,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {PAYMENT_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-right text-sm hidden sm:table-cell">
                    {order.deposit_amount
                      ? order.deposit_amount.toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {order.total_amount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const id = encodeURIComponent(order.id);
                          window.open(`/print/order/${id}`, "_blank", "noopener,noreferrer");
                        }}
                      >
                        預覽列印
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => handleEdit(order)}
                      >
                        總覽 / 編輯
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(order); }}
                      >
                        刪除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {orders.length} 筆訂單
      </p>

      <OrderFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditingOrder(null);
            setEditingItems(undefined);
          } else {
            setFormOpen(true);
          }
        }}
        customers={customers}
        variants={variants}
        initialOrder={editingOrder}
        initialItems={editingItems}
        onSaved={reloadOrders}
      />

      <ConfirmDialog
        open={deleteConfirmOrder != null}
        onOpenChange={(open) => !open && setDeleteConfirmOrder(null)}
        title="是否確定刪除訂單？"
        description={
          deleteConfirmOrder ? (
            <>
              <p className="font-medium text-foreground">訂單編號：{deleteConfirmOrder.order_number}</p>
              <p className="mt-2 text-muted-foreground">此操作會一併刪除所有訂單明細，且無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDeleteOrder}
        destructive
      />
    </div>
  );
}

