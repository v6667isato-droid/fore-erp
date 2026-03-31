"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_WORK_ORDER_STAGE,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShoppingCart, Plus, Trash2, LogOut, ClipboardList, Pencil, X, ArrowUp, ArrowDown } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DEFAULT_SEAT_HEIGHT_CM,
  SEAT_HEIGHT_UPCHARGE_NTD,
} from "@/lib/product-seat-height";

function resolvePortalSeatHeight(v: {
  seat_height_cm?: number | null;
  series_category?: string | null;
}): number | null {
  if (v.seat_height_cm != null && Number.isFinite(Number(v.seat_height_cm))) {
    return Number(v.seat_height_cm);
  }
  const cat = v.series_category ?? "";
  if (cat === "椅" || cat === "凳") return DEFAULT_SEAT_HEIGHT_CM;
  return null;
}

const PORTAL_SESSION_KEY = "fore_portal_session";

function PortalSeatHeightNotice() {
  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm dark:border-amber-800/80 dark:bg-amber-950/30">
      <p className="font-medium text-amber-950 dark:text-amber-100">座高說明</p>
      <p className="mt-1 leading-relaxed text-muted-foreground">
        椅、凳類標準座高為 {DEFAULT_SEAT_HEIGHT_CM} 公分；若需加高座高，增高費用為{" "}
        {SEAT_HEIGHT_UPCHARGE_NTD.toLocaleString()} 元，請於品項備註或訂單備註說明需求。
      </p>
    </div>
  );
}

interface PortalSession {
  customer_id: string;
  customer_name: string;
  delivery_address: string | null;
  channel_id: string | null;
}

interface VariantOption {
  id: string;
  label: string;
  base_price: number | null;
  spec1?: string | null;
  series_category?: string | null;
  seat_height_cm?: number | null;
}

interface PortalItem {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  notes: string;
  /** 訂單明細約定座高（cm），存入 order_items.seat_height_cm */
  seat_height_cm?: number | null;
}

interface MyOrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  shipping_contact_name: string | null;
  expected_delivery_date: string | null;
  status: string;
  total_amount: number;
}

function getSession(): PortalSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PORTAL_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    return s?.customer_id && s?.customer_name ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: PortalSession | null) {
  if (typeof window === "undefined") return;
  if (s) localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(PORTAL_SESSION_KEY);
}

function generateOrderNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(now.getTime()).slice(-4);
  return `ORD-${ymd}-${suffix}`;
}

/** 僅「結案」時不可修改或刪除 */
const LOCKED_STATUSES = ["結案"];
function canEditOrDelete(status: string) {
  return !LOCKED_STATUSES.includes(status);
}

export default function PortalPage() {
  const [session, setSessionState] = useState<PortalSession | null>(null);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);

  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [items, setItems] = useState<PortalItem[]>([
    { id: "item-0", variant_id: "", quantity: 1, unit_price: 0, notes: "", seat_height_cm: null },
  ]);

  const [myOrders, setMyOrders] = useState<MyOrderRow[]>([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    order_date: string;
    expected_delivery_date: string;
    shipping_address: string;
    order_notes: string;
    items: PortalItem[];
  } | null>(null);
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<MyOrderRow | null>(null);

  const loadVariants = useCallback(async (channelId: string | null) => {
    if (!channelId) {
      setVariants([]);
      return;
    }

    // 只載入「有為此通路設定折扣」的系列之規格
    const { data: discountRows, error: discountError } = await supabase
      .from("product_series_channel_discounts")
      .select("series_id")
      .eq("channel_id", channelId);

    if (discountError) {
      setVariants([]);
      return;
    }

    const seriesIds = Array.from(
      new Set(
        (discountRows ?? []).map((r: any) => String(r.series_id))
      )
    );
    if (!seriesIds.length) {
      setVariants([]);
      return;
    }

    const { data: variantRows } = await supabase
      .from("product_variants")
      .select(
        "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, base_price, spec1"
      )
      .in("series_id", seriesIds)
      .order("product_code", { ascending: true });

    const sidList = Array.from(
      new Set((variantRows ?? []).map((r: { series_id?: string }) => String(r.series_id ?? "")).filter(Boolean))
    );
    let categoryBySeriesId = new Map<string, string>();
    if (sidList.length > 0) {
      const { data: seriesRows } = await supabase
        .from("product_series")
        .select("id, category")
        .in("id", sidList);
      categoryBySeriesId = new Map(
        ((seriesRows ?? []) as { id: string; category?: string }[]).map((s) => [
          String(s.id),
          s.category != null ? String(s.category) : "",
        ])
      );
    }

    setVariants(
      ((variantRows ?? []) as any[]).map((v) => {
        const series_category = categoryBySeriesId.get(String(v.series_id ?? "")) || null;
        const w = v.dimension_w ?? "";
        const d = v.dimension_d ?? "";
        const h = v.dimension_h ?? "";
        const parts = [w, d, h].filter((x: unknown) => x !== "");
        let dim =
          parts.length === 0 ? "" : `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
        const seatH = v.seat_height_cm != null ? Number(v.seat_height_cm) : NaN;
        if (Number.isFinite(seatH)) {
          dim = dim === "" ? `座高 ${seatH} cm` : `${dim} · 座高 ${seatH} cm`;
        }
        const labelParts = [v.product_code ?? "", v.wood_type ?? "", v.spec1 ?? "", dim].filter(
          (s: string) => s && s.trim()
        );
        return {
          id: String(v.id),
          label: labelParts.join(" / "),
          base_price: v.base_price != null ? Number(v.base_price) : null,
          spec1: v.spec1 ?? null,
          series_category,
          seat_height_cm:
            v.seat_height_cm != null ? Number(v.seat_height_cm) : null,
        };
      })
    );
  }, []);

  useEffect(() => {
    const s = getSession();
    setSessionState(s);
    const today = new Date().toISOString().slice(0, 10);
    setOrderDate(today);
    loadVariants(s?.channel_id ?? null).then(() => setLoading(false));
  }, [loadVariants]);

  useEffect(() => {
    if (session?.delivery_address != null) setShippingAddress(session.delivery_address);
  }, [session?.customer_id, session?.delivery_address]);

  const fetchMyOrders = useCallback(async () => {
    if (!session?.customer_id) return;
    setMyOrdersLoading(true);
    try {
      const { data } = await supabase
        .from("orders")
        .select(
          "id, order_number, order_date, shipping_contact_name, expected_delivery_date, status, total_amount"
        )
        .eq("customer_id", session.customer_id)
        .order("order_date", { ascending: false })
        .limit(50);
      setMyOrders(
        ((data ?? []) as any[]).map((r) => ({
          id: String(r.id),
          order_number: String(r.order_number ?? ""),
          order_date: r.order_date ?? null,
          shipping_contact_name:
            r.shipping_contact_name != null ? String(r.shipping_contact_name) : null,
          expected_delivery_date: r.expected_delivery_date ?? null,
          status: r.status ?? "—",
          total_amount: Number(r.total_amount ?? 0),
        }))
      );
    } finally {
      setMyOrdersLoading(false);
    }
  }, [session?.customer_id]);

  useEffect(() => {
    fetchMyOrders();
  }, [fetchMyOrders, submittedOrderNumber]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginCode.trim() || !loginPassword) {
      toast.error("請輸入通路代碼與密碼");
      return;
    }
    setLoginSubmitting(true);
    try {
      const res = await fetch("/api/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: loginCode.trim(), password: loginPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error || "登入失敗");
        return;
      }
      const newSession: PortalSession = {
        customer_id: json.customer_id,
        customer_name: json.customer_name ?? "",
        delivery_address: json.delivery_address ?? null,
        channel_id: json.channel_id ?? null,
      };
      setSession(newSession);
      setSessionState(newSession);
      setShippingAddress(newSession.delivery_address ?? "");
      // 依通路重新載入可選規格
      await loadVariants(newSession.channel_id ?? null);
      toast.success("登入成功");
    } finally {
      setLoginSubmitting(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setSessionState(null);
    setSubmittedOrderNumber(null);
    setMyOrders([]);
  }

  function requestDeleteOrder(order: MyOrderRow) {
    if (!canEditOrDelete(order.status)) {
      toast.error("訂單已結案，無法刪除");
      return;
    }
    setDeleteConfirmOrder(order);
  }

  function viewOrder(orderId: string) {
    if (!orderId) return;
    window.open(`/print/order/${orderId}`, "_blank", "noopener,noreferrer");
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
    fetchMyOrders();
  }

  useEffect(() => {
    if (!editingOrderId || !session?.customer_id) {
      setEditForm(null);
      return;
    }
    setEditFormLoading(true);
    Promise.all([
      supabase.from("orders").select("id, order_date, expected_delivery_date, shipping_address, internal_notes, status").eq("id", editingOrderId).eq("customer_id", session.customer_id).single(),
      supabase
        .from("order_items")
        .select("id, variant_id, quantity, unit_price, custom_notes, seat_height_cm")
        .eq("order_id", editingOrderId)
        .order("line_order", { ascending: true })
        .order("id", { ascending: true }),
    ]).then(([orderRes, itemsRes]) => {
      if (orderRes.error || !orderRes.data) {
        toast.error(orderRes.error?.message || "讀取訂單失敗");
        setEditingOrderId(null);
        setEditFormLoading(false);
        return;
      }
      const o = orderRes.data as any;
      if (o.status && LOCKED_STATUSES.includes(o.status)) {
        toast.error("此訂單已結案，無法修改");
        setEditingOrderId(null);
        setEditFormLoading(false);
        return;
      }
      const itemRows = ((itemsRes.data ?? []) as any[]).map((d, idx) => ({
        id: `edit-item-${idx}-${d.id}`,
        variant_id: d.variant_id ? String(d.variant_id) : "",
        quantity: Number(d.quantity ?? 1),
        unit_price: Number(d.unit_price ?? 0),
        notes: d.custom_notes ?? "",
        seat_height_cm:
          d.seat_height_cm != null && Number.isFinite(Number(d.seat_height_cm))
            ? Number(d.seat_height_cm)
            : null,
      }));
      setEditForm({
        order_date: o.order_date ? String(o.order_date).slice(0, 10) : "",
        expected_delivery_date: o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : "",
        shipping_address: o.shipping_address ?? "",
        order_notes: o.internal_notes ?? "",
        items: itemRows.length
          ? itemRows
          : [
              {
                id: "edit-item-0",
                variant_id: "",
                quantity: 1,
                unit_price: 0,
                notes: "",
                seat_height_cm: null,
              },
            ],
      });
    }).finally(() => setEditFormLoading(false));
  }, [editingOrderId, session?.customer_id]);

  function updateEditItem(id: string, patch: Partial<PortalItem>) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      items: editForm.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  }
  function addEditItem() {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      items: [
        ...editForm.items,
        {
          id: `edit-item-${Date.now()}`,
          variant_id: "",
          quantity: 1,
          unit_price: 0,
          notes: "",
          seat_height_cm: null,
        },
      ],
    });
  }
  function removeEditItem(id: string) {
    if (!editForm || editForm.items.length <= 1) return;
    const confirmed = window.confirm("是否確定移除此筆明細？");
    if (!confirmed) return;
    setEditForm({ ...editForm, items: editForm.items.filter((it) => it.id !== id) });
  }
  function moveEditItem(id: string, direction: -1 | 1) {
    if (!editForm) return;
    const idx = editForm.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const next = idx + direction;
    if (next < 0 || next >= editForm.items.length) return;
    const copy = [...editForm.items];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    setEditForm({ ...editForm, items: copy });
  }
  function onEditVariantChange(itemId: string, variantId: string) {
    const v = variants.find((x) => x.id === variantId);
    updateEditItem(itemId, {
      variant_id: variantId,
      unit_price: v?.base_price ?? 0,
      seat_height_cm: v ? resolvePortalSeatHeight(v) : null,
    });
  }

  async function handleSaveEdit() {
    if (!editingOrderId || !editForm || !session) return;
    const validItems = editForm.items.filter((it) => it.variant_id && it.quantity > 0);
    if (!editForm.expected_delivery_date) {
      toast.error("請填寫預計交貨日");
      return;
    }
    if (validItems.length === 0) {
      toast.error("請至少保留一筆有效品項");
      return;
    }
    const totalAmount = validItems.reduce((s, it) => s + it.quantity * (it.unit_price || 0), 0);
    setEditSaving(true);
    try {
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          order_date: editForm.order_date || null,
          expected_delivery_date: editForm.expected_delivery_date || null,
          shipping_address: editForm.shipping_address || null,
          internal_notes: editForm.order_notes || null,
          total_amount: totalAmount,
        })
        .eq("id", editingOrderId)
        .eq("customer_id", session.customer_id);
      if (updateErr) {
        toast.error(updateErr.message || "更新訂單失敗");
        return;
      }
      const { data: existingItems } = await supabase.from("order_items").select("id").eq("order_id", editingOrderId);
      const ids = (existingItems ?? []).map((x: { id: string }) => x.id);
      if (ids.length > 0) {
        await supabase.from("work_orders").delete().in("order_item_id", ids);
      }
      await supabase.from("order_items").delete().eq("order_id", editingOrderId);
      const itemsPayload = validItems.map((it, lineIndex) => ({
        order_id: editingOrderId,
        line_order: lineIndex,
        variant_id: it.variant_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        custom_notes: it.notes || null,
        custom_category: null,
        custom_name: null,
        custom_description: null,
        custom_dimension_w: null,
        custom_dimension_d: null,
        custom_dimension_h: null,
        seat_height_cm:
          it.seat_height_cm != null && Number.isFinite(Number(it.seat_height_cm))
            ? Number(it.seat_height_cm)
            : null,
      }));
      const { data: insertedItems, error: itemsErr } = await supabase.from("order_items").insert(itemsPayload).select("id");
      if (itemsErr) {
        toast.error(itemsErr.message || "更新明細失敗");
        return;
      }
      const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
        order_item_id: row.id,
        stage: DEFAULT_WORK_ORDER_STAGE,
        status: "未開始",
      }));
      if (workOrderPayload.length > 0) {
        const { error: woInsErr } = await supabase.from("work_orders").insert(workOrderPayload);
        if (woInsErr) {
          console.error(woInsErr);
        } else {
          const { data: ordRow } = await supabase
            .from("orders")
            .select("status")
            .eq("id", editingOrderId)
            .single();
          const st = (ordRow as { status?: string } | null)?.status;
          if (st) {
            await syncWorkOrdersToOrderStatus(supabase, editingOrderId, st);
          }
        }
      }
      toast.success("訂單已更新");
      setEditingOrderId(null);
      setEditForm(null);
      fetchMyOrders();
    } finally {
      setEditSaving(false);
    }
  }

  function updateItem(id: string, patch: Partial<PortalItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}`,
        variant_id: "",
        quantity: 1,
        unit_price: 0,
        notes: "",
        seat_height_cm: null,
      },
    ]);
  }

  function removeItem(id: string) {
    if (items.length <= 1) return;
    const confirmed = window.confirm("是否確定移除此筆明細？");
    if (!confirmed) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function onVariantChange(itemId: string, variantId: string) {
    const v = variants.find((x) => x.id === variantId);
    updateItem(itemId, {
      variant_id: variantId,
      unit_price: v?.base_price ?? 0,
      seat_height_cm: v ? resolvePortalSeatHeight(v) : null,
    });
  }

  const validItems = items.filter((it) => it.variant_id && it.quantity > 0);
  const totalAmount = validItems.reduce(
    (sum, it) => sum + it.quantity * (it.unit_price || 0),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!expectedDate) {
      toast.error("請填寫預計交貨日");
      return;
    }
    if (validItems.length === 0) {
      toast.error("請至少新增一筆有效品項（選擇品項且數量大於 0）");
      return;
    }

    setSubmitting(true);
    setSubmittedOrderNumber(null);
    try {
      const orderNumber = generateOrderNumber();
      const orderPayloadWithSource = {
        order_number: orderNumber,
        customer_id: session.customer_id,
        order_date: orderDate || null,
        expected_delivery_date: expectedDate || null,
        status: "排程中",
        payment_status: "未付款",
        total_amount: totalAmount,
        deposit_amount: 0,
        shipping_contact_name: contactName.trim() || null,
        shipping_contact_phone: contactPhone.trim() || null,
        shipping_address:
          (contactAddress.trim() || shippingAddress.trim() || "") || null,
        internal_notes: orderNotes || null,
        source: "portal",
      };
      let orderId: string;
      const { data: orderRow, error: orderError } = await supabase
        .from("orders")
        .insert(orderPayloadWithSource)
        .select("id")
        .single();

      if (orderError) {
        const isColumnError = /column .* does not exist/i.test(orderError.message ?? "") || /could not find.*column/i.test(orderError.message ?? "");
        if (isColumnError) {
          const { data: fallbackRow, error: fallbackError } = await supabase
            .from("orders")
            .insert({
              ...orderPayloadWithSource,
              source: undefined,
            } as Record<string, unknown>)
            .select("id")
            .single();
          if (fallbackError || !fallbackRow) {
            toast.error(fallbackError?.message || "建立訂單失敗");
            return;
          }
          orderId = fallbackRow.id as string;
        } else {
          toast.error(orderError.message || "建立訂單失敗");
          return;
        }
      } else if (orderRow) {
        orderId = orderRow.id as string;
      } else {
        toast.error("建立訂單失敗");
        return;
      }

      const itemsPayload = validItems.map((it, lineIndex) => ({
        order_id: orderId,
        line_order: lineIndex,
        variant_id: it.variant_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        custom_notes: it.notes || null,
        custom_category: null,
        custom_name: null,
        custom_description: null,
        custom_dimension_w: null,
        custom_dimension_d: null,
        custom_dimension_h: null,
        seat_height_cm:
          it.seat_height_cm != null && Number.isFinite(Number(it.seat_height_cm))
            ? Number(it.seat_height_cm)
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

      const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
        order_item_id: row.id,
        stage: DEFAULT_WORK_ORDER_STAGE,
        status: "未開始",
      }));
      if (workOrderPayload.length > 0) {
        const { error: woError } = await supabase
          .from("work_orders")
          .insert(workOrderPayload);
        if (woError) {
          console.error("建立工單失敗:", woError);
          toast.error("訂單已建立，但工單建立失敗，請聯絡客服。");
        } else {
          await syncWorkOrdersToOrderStatus(supabase, orderId, "排程中");
        }
      }

      toast.success("訂單已建立，已進入生產排程");
      setSubmittedOrderNumber(orderNumber);
      setExpectedDate("");
      setShippingAddress(session.delivery_address ?? "");
      setOrderNotes("");
      setItems([
        { id: `item-${Date.now()}`, variant_id: "", quantity: 1, unit_price: 0, notes: "" },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">載入中…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center py-8 px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-sm p-6">
          <div className="flex items-center gap-2 text-lg font-semibold text-foreground mb-1">
            <ShoppingCart className="h-5 w-5" />
            通路商下單
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            請使用您的通路代碼與密碼登入後下單。
          </p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="portal-code" className="block text-sm font-medium text-foreground mb-1.5">
                通路代碼
              </label>
              <input
                id="portal-code"
                type="text"
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="請輸入代碼"
                required
              />
            </div>
            <div>
              <label htmlFor="portal-password" className="block text-sm font-medium text-foreground mb-1.5">
                密碼
              </label>
              <input
                id="portal-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="請輸入密碼"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loginSubmitting}>
              {loginSubmitting ? "登入中…" : "登入"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ShoppingCart className="h-5 w-5" />
              通路商下單
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {session.customer_name} 您好，以下單據將歸入您的帳戶。
            </p>
          </div>
          <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-1" />
            登出
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-6 sm:p-8">
          {submittedOrderNumber && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40 p-4 text-sm text-green-800 dark:text-green-200">
              <p className="font-medium">訂單已送出</p>
              <p className="mt-1">
                訂單編號：<span className="font-mono">{submittedOrderNumber}</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                您可在下方「我的訂單」查看，或於內部 ERP 訂單管理與工單列表查詢。
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                訂單主檔
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-sm font-medium text-foreground">通路／客戶</label>
                  <p className="text-sm text-muted-foreground py-1">{session.customer_name}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">
                    客戶名稱
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="客戶姓名"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">
                    聯絡電話
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="例如 09xx-xxx-xxx"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-sm font-medium text-foreground">
                    聯絡地址
                  </label>
                  <input
                    type="text"
                    value={contactAddress}
                    onChange={(e) => setContactAddress(e.target.value)}
                    placeholder="送貨地址"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="portal-order-date" className="text-sm font-medium text-foreground">
                    下單日期
                  </label>
                  <input
                    id="portal-order-date"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="portal-expected" className="text-sm font-medium text-foreground">
                    預計交貨日 *
                  </label>
                  <input
                    id="portal-expected"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="portal-notes" className="text-sm font-medium text-foreground">
                    備註（坐墊／布墊；加高座高請一併註明）
                  </label>
                  <input
                    id="portal-notes"
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="一句話備註即可"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <PortalSeatHeightNotice />
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  明細品項
                </h3>
                <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  新增品項
                </Button>
              </div>
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div
                    key={it.id}
                    className="rounded-lg border border-border bg-muted/30 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        品項 {idx + 1}
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          className="text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring rounded p-1"
                          aria-label="移除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5 sm:col-span-1">
                        <label className="text-xs text-muted-foreground">品項 *</label>
                        <select
                          value={it.variant_id}
                          onChange={(e) => onVariantChange(it.id, e.target.value)}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          required={idx === 0}
                        >
                          <option value="">請選擇</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                              {v.base_price != null ? ` · $${v.base_price}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-muted-foreground">數量 *</label>
                        <input
                          type="number"
                          min={1}
                          value={it.quantity || ""}
                          onChange={(e) =>
                            updateItem(it.id, { quantity: parseInt(e.target.value, 10) || 0 })
                          }
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-muted-foreground">座高（cm）</label>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={it.seat_height_cm ?? ""}
                          onChange={(e) =>
                            updateItem(it.id, {
                              seat_height_cm:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                          placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}`}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-3">
                        <label className="text-xs text-muted-foreground">備註</label>
                        <input
                          type="text"
                          value={it.notes}
                          onChange={(e) => updateItem(it.id, { notes: e.target.value })}
                          placeholder={`標準座高 ${DEFAULT_SEAT_HEIGHT_CM}cm；加高請註明（另計增高費）、布墊等`}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {validItems.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  小計：<span className="font-medium text-foreground">${totalAmount}</span>
                </p>
              )}
            </section>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "送出中…" : "送出訂單"}
              </Button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
            <ClipboardList className="h-4 w-4" />
            我的訂單
          </div>
          {myOrdersLoading ? (
            <p className="text-sm text-muted-foreground">載入中…</p>
          ) : myOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無訂單紀錄</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">訂單編號</th>
                    <th className="pb-2 pr-4 font-medium">下單日</th>
                    <th className="pb-2 pr-4 font-medium">客戶</th>
                    <th className="pb-2 pr-4 font-medium">預計交貨</th>
                    <th className="pb-2 pr-4 font-medium">狀態</th>
                    <th className="pb-2 text-right font-medium">金額</th>
                    <th className="pb-2 pl-4 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {myOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 font-mono text-foreground">{o.order_number}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {o.order_date ? o.order_date.slice(0, 10) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground max-w-[12rem] truncate" title={o.shipping_contact_name ?? undefined}>
                        {o.shipping_contact_name?.trim() || "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {o.expected_delivery_date
                          ? o.expected_delivery_date.slice(0, 10)
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{o.status}</td>
                      <td className="py-2.5 text-right font-medium text-foreground">
                        ${o.total_amount.toLocaleString()}
                      </td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => viewOrder(o.id)}
                          >
                            檢視訂單
                          </Button>
                          {canEditOrDelete(o.status) ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2 text-xs"
                                onClick={() => setEditingOrderId(o.id)}
                              >
                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                編輯
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDeleteOrder(o); }}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                刪除
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">已進入生產，無法修改/刪除</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Dialog.Root open={!!editingOrderId} onOpenChange={(open) => { if (!open) { setEditingOrderId(null); setEditForm(null); } }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg focus:outline-none">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-base font-semibold text-foreground">編輯訂單</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="rounded-md p-2 hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </Dialog.Close>
              </div>
              {editFormLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">載入中…</p>
              ) : editForm ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">下單日期</label>
                      <input
                        type="date"
                        value={editForm.order_date}
                        onChange={(e) => setEditForm({ ...editForm, order_date: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">預計交貨日 *</label>
                      <input
                        type="date"
                        value={editForm.expected_delivery_date}
                        onChange={(e) => setEditForm({ ...editForm, expected_delivery_date: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">送貨地址</label>
                    <input
                      type="text"
                      value={editForm.shipping_address}
                      onChange={(e) => setEditForm({ ...editForm, shipping_address: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">備註</label>
                    <input
                      type="text"
                      value={editForm.order_notes}
                      onChange={(e) => setEditForm({ ...editForm, order_notes: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="一句話備註即可"
                    />
                  </div>
                  <div>
                    <PortalSeatHeightNotice />
                    <div className="flex items-center justify-between mb-2 mt-1">
                      <span className="text-xs font-medium text-muted-foreground">明細品項</span>
                      <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={addEditItem}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> 新增品項
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {editForm.items.map((it, idx) => (
                        <div key={it.id} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-xs text-muted-foreground">品項 {idx + 1}</span>
                            {editForm.items.length > 1 && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  title="上移"
                                  disabled={idx === 0}
                                  onClick={() => moveEditItem(it.id, -1)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                                  aria-label="上移"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title="下移"
                                  disabled={idx === editForm.items.length - 1}
                                  onClick={() => moveEditItem(it.id, 1)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                                  aria-label="下移"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => removeEditItem(it.id)} className="text-xs text-muted-foreground hover:text-destructive px-1">移除</button>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div>
                              <label className="text-[11px] text-muted-foreground">品項 *</label>
                              <select
                                value={it.variant_id}
                                onChange={(e) => onEditVariantChange(it.id, e.target.value)}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">請選擇</option>
                                {variants.map((v) => (
                                  <option key={v.id} value={v.id}>{v.label}{v.base_price != null ? ` · $${v.base_price}` : ""}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground">數量 *</label>
                              <input
                                type="number"
                                min={1}
                                value={it.quantity || ""}
                                onChange={(e) => updateEditItem(it.id, { quantity: parseInt(e.target.value, 10) || 0 })}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground">座高（cm）</label>
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                value={it.seat_height_cm ?? ""}
                                onChange={(e) =>
                                  updateEditItem(it.id, {
                                    seat_height_cm:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                                placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}`}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[11px] text-muted-foreground">備註</label>
                              <input
                                type="text"
                                value={it.notes}
                                onChange={(e) => updateEditItem(it.id, { notes: e.target.value })}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                placeholder={`標準座高 ${DEFAULT_SEAT_HEIGHT_CM}cm；加高請註明`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Dialog.Close asChild>
                      <Button type="button" variant="outline" disabled={editSaving}>取消</Button>
                    </Dialog.Close>
                    <Button type="button" onClick={handleSaveEdit} disabled={editSaving}>
                      {editSaving ? "儲存中…" : "儲存"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

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
    </div>
  );
}
