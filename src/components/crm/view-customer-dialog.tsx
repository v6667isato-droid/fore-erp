"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { CustomerRow } from "@/types/crm";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { paymentStatusStyles, statusStyles } from "@/components/orders/order-helpers";
import type { OrderStatus, PaymentStatus } from "@/components/orders/types";

interface CustomerOrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
  /** 訂單的送貨聯絡人 */
  shipping_contact_name: string | null;
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

function contactMethodLabel(method: string | null | undefined): string | null {
  const v = (method ?? "").toLowerCase();
  if (!v) return null;
  switch (v) {
    case "line":
      return "LINE";
    case "ig":
      return "IG";
    case "fb":
      return "FB";
    case "email":
      return "Email";
    case "bingxueline":
      return "秉學Line";
    case "others":
      return "Others";
    default:
      return method ?? null;
  }
}

function shippingCity(address: string | null | undefined): string | null {
  const raw = (address ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(.{1,4}?[市縣])/);
  if (match && match[1]) return match[1];
  return null;
}

/** 單一欄位：未填寫顯示「—」，讓每個欄位都看得到 */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value?.trim();
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{v || "—"}</dd>
    </div>
  );
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
  /** 所屬通路名稱（依 channel_id 查 channels；記下查詢的 id，切換客戶時不顯示上一位的通路） */
  const [channel, setChannel] = useState<{ id: string; name: string | null } | null>(null);

  const channelId = row?.channel_id?.trim() || null;
  const channelName = channel && channel.id === channelId ? channel.name : null;
  useEffect(() => {
    if (!open || !channelId) return;
    let cancelled = false;
    void supabase
      .from("channels")
      .select("name")
      .eq("id", channelId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setChannel({ id: channelId, name: data?.name != null ? String(data.name) : null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, channelId]);

  useEffect(() => {
    if (!open || !row) return;
    setLoadingOrders(true);
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, order_date, total_amount, status, payment_status, shipping_contact_name")
        .eq("customer_id", row.id)
        .is("deleted_at", null)
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
        shipping_contact_name: o.shipping_contact_name ?? null,
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
      .eq("order_id", orderId)
      .order("line_order", { ascending: true })
      .order("id", { ascending: true });
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

          <div className="mt-4 space-y-6">
            <div className="grid gap-5 md:grid-cols-3">
              <Section title="基本資料">
                <div>
                  <dt className="text-muted-foreground">客戶姓名</dt>
                  <dd className="font-medium">
                    {row.name || "—"}
                    {row.alias?.trim() && (
                      <span className="ml-2 text-xs text-muted-foreground">（{row.alias.trim()}）</span>
                    )}
                  </dd>
                </div>
                <Field label="聯絡人" value={row.contact_person} />
                <Field label="品牌名稱" value={row.brand_name} />
                <Field label="公司抬頭" value={row.company} />
                <Field label="統一編號" value={row.tax_id} />
                <Field label="所屬通路" value={channelName} />
                <Field label="客戶來源" value={row.source} />
                <Field label="客戶種類" value={row.customer_type} />
                <Field
                  label="建立日期"
                  value={row.created_at ? String(row.created_at).slice(0, 10) : null}
                />
              </Section>

              <Section title="聯絡方式">
                <div>
                  <dt className="text-muted-foreground">主要聯絡方式</dt>
                  <dd>
                    {contactMethodLabel(row.contact_method) ? contactMethodLabel(row.contact_method) : "—"}
                  </dd>
                </div>
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
                  <dd>
                    {row.ig_account?.trim() ? (
                      row.ig_account.trim().startsWith("http") ? (
                        <a
                          href={row.ig_account.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline break-all"
                          title="在 Instagram 開啟"
                        >
                          {row.ig_account.trim()}
                        </a>
                      ) : (
                        <a
                          href={`https://www.instagram.com/${encodeURIComponent(row.ig_account.trim())}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline break-all"
                          title="在 Instagram 開啟"
                        >
                          {row.ig_account.trim()}
                        </a>
                      )
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </Section>

              <Section title="送貨資訊">
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
                <div>
                  <dt className="text-muted-foreground">電梯</dt>
                  <dd>
                    {row.has_elevator === true
                      ? "有電梯"
                      : row.has_elevator === false
                        ? "無電梯"
                        : "—"}
                  </dd>
                </div>
              </Section>
            </div>

            {row.notes?.trim() && (
              <Section title="客情備註">
                <div>
                  <dd className="whitespace-pre-wrap text-muted-foreground">
                    {row.notes.trim()}
                  </dd>
                </div>
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="font-medium">
                              {o.order_number || "未命名訂單"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              日期：{o.order_date ? String(o.order_date).slice(0, 10) : "—"} · 金額：
                              {o.total_amount.toLocaleString()} · 聯絡人：
                              {o.shipping_contact_name?.trim() || "—"}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="text-muted-foreground">狀態</span>
                              <Badge
                                variant="outline"
                                className={statusStyles[o.status as OrderStatus] ?? ""}
                              >
                                {o.status || "—"}
                              </Badge>
                              <span className="ml-1 text-muted-foreground">付款</span>
                              <Badge
                                variant="outline"
                                className={paymentStatusStyles[o.payment_status as PaymentStatus] ?? ""}
                              >
                                {o.payment_status || "—"}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 shrink-0 px-2 text-xs"
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
