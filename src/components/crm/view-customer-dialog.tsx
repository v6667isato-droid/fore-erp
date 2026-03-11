"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { CustomerRow } from "@/types/crm";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

interface CustomerOrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
}

interface CustomerOrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  kind: "variant" | "custom" | string;
  custom_name?: string | null;
  custom_category?: string | null;
  custom_description?: string | null;
}

export interface ViewCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CustomerRow | null;
}

function googleMapsUrl(address: string | null | undefined): string {
  if (!address?.trim()) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </section>
  );
}

export function ViewCustomerDialog({ open, onOpenChange, row }: ViewCustomerDialogProps) {
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<Record<string, CustomerOrderItemRow[]>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setLoadingOrders(true);
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, order_date, total_amount, status, payment_status")
        .eq("customer_id", row.id)
        .order("order_date", { ascending: false });
      if (error) {
        setOrders([]);
        setLoadingOrders(false);
        return;
      }
      const list: CustomerOrderRow[] = (data ?? []).map((o: any) => ({
        id: String(o.id),
        order_number: String(o.order_number ?? ""),
        order_date: o.order_date ?? null,
        total_amount: Number(o.total_amount ?? 0),
        status: String(o.status ?? ""),
        payment_status: String(o.payment_status ?? ""),
      }));
      setOrders(list);
      setLoadingOrders(false);
    })();
  }, [open, row]);

  async function toggleOrder(orderId: string) {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
    if (orderItems[orderId]) return;
    // 優先讀取完整欄位；若部分欄位不存在（舊資料庫），則退回精簡欄位
    let list: CustomerOrderItemRow[] = [];
    const baseQuery = supabase.from("order_items");
    let { data, error } = await baseQuery
      .select(
      "id, quantity, unit_price, kind, custom_name, custom_category, custom_description"
      )
      .eq("order_id", orderId);
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      const isColumnError =
        msg.includes("column") && msg.includes("does not exist");
      if (!isColumnError) {
        return;
      }
      const fallback = await baseQuery
        .select("id, quantity, unit_price")
        .eq("order_id", orderId);
      if (fallback.error) {
        return;
      }
      const fbData = (fallback.data ?? []) as any[];
      list = fbData.map((it: any) => ({
        id: String(it.id),
        quantity: Number(it.quantity ?? 0),
        unit_price: Number(it.unit_price ?? 0),
        kind: "variant",
        custom_name: null,
        custom_category: null,
        custom_description: null,
      }));
    } else {
      list = (data ?? []).map((it: any) => ({
        id: String(it.id),
        quantity: Number(it.quantity ?? 0),
        unit_price: Number(it.unit_price ?? 0),
        kind: (it.kind as string) ?? "variant",
        custom_name: it.custom_name ?? null,
        custom_category: it.custom_category ?? null,
        custom_description: it.custom_description ?? null,
      }));
    }
    setOrderItems((prev) => ({ ...prev, [orderId]: list }));
  }

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="view-customer-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                客戶總覽 — {row.name || "—"}
              </Dialog.Title>
              <p id="view-customer-desc" className="mt-0.5 text-sm text-muted-foreground">
                基本資料、聯絡方式與備註
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <Section title="基本資料">
                <div>
                  <dt className="text-muted-foreground">客戶姓名</dt>
                  <dd className="font-medium">{row.name || "—"}</dd>
                </div>
                {row.source?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">客戶來源</dt>
                    <dd>{row.source.trim()}</dd>
                  </div>
                )}
                {row.customer_type?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">客戶種類</dt>
                    <dd>{row.customer_type.trim()}</dd>
                  </div>
                )}
              </Section>

              <Section title="聯絡方式">
                <div>
                  <dt className="text-muted-foreground">電話</dt>
                  <dd>{row.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">LINE ID</dt>
                  <dd>{row.line_id?.trim() ? row.line_id.trim() : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">IG 帳號</dt>
                  <dd>{row.ig_account?.trim() ? row.ig_account.trim() : "—"}</dd>
                </div>
              </Section>
            </div>

            {(row.delivery_address?.trim() || row.notes?.trim()) && (
              <Section title="送貨與備註">
                {row.delivery_address?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">送貨地址</dt>
                    <dd className="whitespace-pre-wrap">
                      <a
                        href={googleMapsUrl(row.delivery_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        title="在 Google 地圖開啟"
                      >
                        {row.delivery_address.trim()}
                      </a>
                    </dd>
                  </div>
                )}
                {row.notes?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">客情備註</dt>
                    <dd className="whitespace-pre-wrap text-muted-foreground">
                      {row.notes.trim()}
                    </dd>
                  </div>
                )}
              </Section>
            )}

            <Section title="歷史訂單">
              {loadingOrders ? (
                <p className="text-sm text-muted-foreground">載入訂單中…</p>
              ) : orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無訂單紀錄。</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {orders.map((o) => {
                    const isExpanded = expandedOrderId === o.id;
                    const items = orderItems[o.id] ?? [];
                    return (
                      <div
                        key={o.id}
                        className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="font-medium">
                              {o.order_number || "未命名訂單"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              日期：{o.order_date ? String(o.order_date).slice(0, 10) : "—"} · 金額：
                              {o.total_amount.toLocaleString()} · 狀態：{o.status || "—"} · 付款：
                              {o.payment_status || "—"}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => toggleOrder(o.id)}
                          >
                            {isExpanded ? "收合明細" : "查看明細"}
                          </Button>
                        </div>
                        {isExpanded && (
                          <div className="mt-2 border-t border-border pt-2 space-y-1.5">
                            {items.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                尚無明細資料。
                              </p>
                            ) : (
                              items.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex flex-col text-xs text-muted-foreground"
                                >
                                  <span>
                                    數量：{it.quantity} · 單價：
                                    {it.unit_price.toLocaleString()}
                                  </span>
                                  {it.kind === "custom" && (
                                    <span>
                                      客製：{it.custom_category || ""}{" "}
                                      {it.custom_name || ""}
                                    </span>
                                  )}
                                  {it.custom_description?.trim() && (
                                    <span className="whitespace-pre-wrap">
                                      備註：{it.custom_description.trim()}
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
