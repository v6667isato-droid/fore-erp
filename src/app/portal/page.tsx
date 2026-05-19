"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_WORK_ORDER_STAGE,
  plannedEndDateFromOrderDelivery,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ShoppingCart,
  Plus,
  Trash2,
  LogOut,
  ClipboardList,
  Pencil,
  Eye,
  X,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  Download,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { VariantSeriesThumb } from "@/components/variant-series-thumb";
import { OrderOverviewDialog } from "@/components/order-overview-dialog";
import {
  DEFAULT_SEAT_HEIGHT_CM,
  SEAT_HEIGHT_UPCHARGE_NTD,
} from "@/lib/product-seat-height";
import { formatDateYyMmDd } from "@/lib/utils";
import { normalizeChannelPartnerPaymentStatus } from "@/lib/channel-partner-payment-status";

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

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

type PortalDateBasis = "order_date" | "expected_delivery";

/** 結算管理：訂單狀態篩選（通路端常用） */
type PortalOrderStatusFilter = "全部" | "生產中" | "已出貨";

/** 「我的訂單」列表：進行中（非結案）／已結案 */
type MyOrdersScopeTab = "ongoing" | "closed";

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
  /** 登入時由伺服器簽發，用於 API 代查 work_orders（預計完成日） */
  portal_token?: string;
}

interface VariantOption {
  id: string;
  /** product_variants.series_id，供通路折扣計算（與訂單新增一致） */
  series_id: string | null;
  label: string;
  base_price: number | null;
  spec1?: string | null;
  series_category?: string | null;
  seat_height_cm?: number | null;
  /** 示意圖：product_variants.image_url 優先，否則 product_series.image_url */
  series_image_url?: string | null;
}

/** 與訂單新增 resolveChannelUnitPrice：系列通路折扣 %＞0 時之成交單價 */
function portalChannelUnitPrice(
  v: VariantOption | undefined,
  discountPctBySeriesId: Map<string, number>
): number | null {
  if (!v?.series_id || v.base_price == null || !Number.isFinite(Number(v.base_price))) return null;
  const pct = discountPctBySeriesId.get(v.series_id) ?? 0;
  if (!(pct > 0)) return null;
  return Math.round(Number(v.base_price) * (1 - pct / 100));
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
  /** 同訂單多張工單時取 planned_end_date 最晚者 */
  planned_end_max: string | null;
  status: string;
  /** 訂單內工序最早的一筆 */
  earliest_stage: string | null;
  /** 通路端僅 已結清／未結清 */
  payment_status: "已結清" | "未結清";
  /** 明細原價加總 + 運費（無 base_price 之明細以成交單價替代） */
  list_grand: number;
  /** 訂單應收總額（通路成交後之總額，含運） */
  total_amount: number;
}

function portalOrderDateForBasis(o: MyOrderRow, basis: PortalDateBasis): string | null {
  if (basis === "order_date") {
    return o.order_date ? String(o.order_date).slice(0, 10) : null;
  }
  return o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null;
}

/** 排序「預計完成」：有工單完成日則用之，否則以預計交貨備援 */
function plannedColumnSortDate(o: MyOrderRow): string | null {
  if (o.planned_end_max) return o.planned_end_max;
  const d = o.expected_delivery_date;
  return d ? String(d).slice(0, 10) : null;
}

type MyOrderSortKey =
  | "order_number"
  | "order_date"
  | "contact_name"
  | "expected_delivery_date"
  | "planned_end_max"
  | "status"
  | "payment_status"
  | "list_grand"
  | "total_amount";

function compareNullableDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
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

/**
 * 訂單狀態為「生產中」之後（含）即鎖定，與內部訂單流程一致。
 * 此前：報價中、繪圖中、排程中、繪製製作圖 — 通路可編輯／刪除。
 */
const PORTAL_NO_EDIT_DELETE_STATUSES = new Set([
  "生產中",
  "暫停",
  "已完工",
  "已出貨",
  "結案",
]);

function canEditOrDelete(status: string) {
  return !PORTAL_NO_EDIT_DELETE_STATUSES.has(String(status ?? "").trim());
}

function portalStatusColor(status: string): string {
  switch (status) {
    case "報價中":    return "text-amber-700";
    case "繪圖中":    return "text-violet-700";
    case "排程中":    return "text-amber-600";
    case "繪製製作圖": return "text-violet-700";
    case "生產中":    return "text-amber-800";
    case "暫停":      return "text-orange-700";
    case "已完工":    return "text-teal-700";
    case "已出貨":    return "text-emerald-700";
    case "結案":      return "text-slate-500";
    default:          return "text-muted-foreground";
  }
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
  const [myOrdersScopeTab, setMyOrdersScopeTab] = useState<MyOrdersScopeTab>("ongoing");
  /** 目前登入通路之「系列 → 折扣 %」與訂單新增相同資料來源 */
  const [portalSeriesDiscountPct, setPortalSeriesDiscountPct] = useState<Map<string, number>>(
    () => new Map()
  );

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
  const [orderOverviewId, setOrderOverviewId] = useState<string | null>(null);
  const [myOrderSearch, setMyOrderSearch] = useState("");
  const [myOrderSortBy, setMyOrderSortBy] = useState<MyOrderSortKey>("order_date");
  const [myOrderSortAsc, setMyOrderSortAsc] = useState(false);

  const [settleDateBasis, setSettleDateBasis] = useState<PortalDateBasis>("order_date");
  const [settleDateFrom, setSettleDateFrom] = useState("");
  const [settleDateTo, setSettleDateTo] = useState("");
  const [settlePayFilter, setSettlePayFilter] = useState<string>("全部");
  const [settleStatusFilter, setSettleStatusFilter] =
    useState<PortalOrderStatusFilter>("全部");

  const loadVariants = useCallback(async (channelId: string | null) => {
    if (!channelId) {
      setVariants([]);
      setPortalSeriesDiscountPct(new Map());
      return;
    }

    // 只載入「有為此通路設定折扣」的系列之規格
    const { data: discountRows, error: discountError } = await supabase
      .from("product_series_channel_discounts")
      .select("series_id, discount_percent")
      .eq("channel_id", channelId);

    if (discountError) {
      setVariants([]);
      setPortalSeriesDiscountPct(new Map());
      return;
    }

    const pctBySeries = new Map<string, number>();
    for (const r of (discountRows ?? []) as { series_id?: string; discount_percent?: number }[]) {
      if (r.series_id != null) {
        pctBySeries.set(String(r.series_id), Number(r.discount_percent ?? 0));
      }
    }
    setPortalSeriesDiscountPct(pctBySeries);

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
        "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, base_price, spec1, image_url"
      )
      .in("series_id", seriesIds)
      .order("product_code", { ascending: true });

    const sidList = Array.from(
      new Set((variantRows ?? []).map((r: { series_id?: string }) => String(r.series_id ?? "")).filter(Boolean))
    );
    let categoryBySeriesId = new Map<string, string>();
    const imageBySeriesId = new Map<string, string | null>();
    if (sidList.length > 0) {
      const { data: seriesRows } = await supabase
        .from("product_series")
        .select("id, category, image_url")
        .in("id", sidList);
      for (const s of (seriesRows ?? []) as {
        id: string;
        category?: string;
        image_url?: string | null;
      }[]) {
        const sid = String(s.id);
        categoryBySeriesId.set(sid, s.category != null ? String(s.category) : "");
        const img =
          s.image_url != null && String(s.image_url).trim()
            ? String(s.image_url).trim()
            : null;
        imageBySeriesId.set(sid, img);
      }
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
        const variantImg =
          v.image_url != null && String(v.image_url).trim()
            ? String(v.image_url).trim()
            : null;
        const seriesImg = imageBySeriesId.get(String(v.series_id ?? "")) ?? null;
        return {
          id: String(v.id),
          series_id: v.series_id != null ? String(v.series_id) : null,
          label: labelParts.join(" / "),
          base_price: v.base_price != null ? Number(v.base_price) : null,
          spec1: v.spec1 ?? null,
          series_category,
          series_image_url: variantImg ?? seriesImg,
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
      let rawList: any[] = [];
      const orderSelect =
        "id, order_number, order_date, shipping_contact_name, expected_delivery_date, status, payment_status, total_amount, shipping_fee";

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select(orderSelect)
        .eq("customer_id", session.customer_id)
        .order("order_date", { ascending: false })
        .limit(100);

      if (orderError) {
        console.error("[portal] orders:", orderError);
        toast.error("無法載入訂單，請稍後再試");
        setMyOrders([]);
        return;
      }
      rawList = (orderData ?? []) as any[];
      const orderIds = rawList.map((r) => String(r.id));

      const listGrandByOrderId = new Map<string, number>();
      if (orderIds.length > 0) {
        const { data: itemRows } = await supabase
          .from("order_items")
          .select("order_id, quantity, unit_price, product_variants ( base_price )")
          .in("order_id", orderIds);

        const lineSumByOrder = new Map<string, number>();
        for (const row of (itemRows ?? []) as any[]) {
          const oid = String(row.order_id);
          const q = Math.max(0, Number(row.quantity) || 0);
          const pv = row.product_variants;
          const one = Array.isArray(pv) ? pv[0] : pv;
          const base =
            one && typeof one === "object" && one.base_price != null
              ? Number(one.base_price)
              : null;
          const unitFallback = Number(row.unit_price ?? 0);
          const unitList =
            base != null && Number.isFinite(base) ? base : unitFallback;
          const line = Math.round(unitList * q);
          lineSumByOrder.set(oid, (lineSumByOrder.get(oid) ?? 0) + line);
        }

        for (const r of rawList) {
          const oid = String(r.id);
          const ship = Number(r.shipping_fee ?? 0);
          const lines = lineSumByOrder.get(oid);
          const total = Number(r.total_amount ?? 0);
          const listGrand =
            lines !== undefined ? lines + ship : total;
          listGrandByOrderId.set(oid, listGrand);
        }
      }

      let plannedMap = new Map<string, string | null>();
      let stageMap = new Map<string, string | null>();
      if (orderIds.length > 0 && session.portal_token) {
        try {
          const res = await fetch("/api/portal/planned-end-dates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: session.portal_token, order_ids: orderIds }),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              planned_by_order?: Record<string, string | null>;
              earliest_stage_by_order?: Record<string, string | null>;
            };
            for (const [k, v] of Object.entries(json.planned_by_order ?? {})) {
              const d = v != null && String(v).trim() ? String(v).slice(0, 10) : null;
              plannedMap.set(k, d);
            }
            for (const [k, v] of Object.entries(json.earliest_stage_by_order ?? {})) {
              stageMap.set(k, v ?? null);
            }
          }
        } catch {
          /* 略過 */
        }
      }

      setMyOrders(
        rawList.map((r) => {
          const oid = String(r.id);
          const total = Number(r.total_amount ?? 0);
          return {
            id: oid,
            order_number: String(r.order_number ?? ""),
            order_date: r.order_date ?? null,
            shipping_contact_name:
              r.shipping_contact_name != null ? String(r.shipping_contact_name) : null,
            expected_delivery_date: r.expected_delivery_date ?? null,
            planned_end_max: plannedMap.get(oid) ?? null,
            status: r.status ?? "—",
            earliest_stage: stageMap.get(oid) ?? null,
            payment_status: normalizeChannelPartnerPaymentStatus(r.payment_status),
            list_grand: listGrandByOrderId.get(oid) ?? total,
            total_amount: total,
          };
        })
      );
    } finally {
      setMyOrdersLoading(false);
    }
  }, [session?.customer_id, session?.portal_token]);

  useEffect(() => {
    fetchMyOrders();
  }, [fetchMyOrders, submittedOrderNumber]);

  const settlePaymentOptions = useMemo(
    () => [
      { value: "全部", label: "全部" },
      { value: "未結清", label: "未結清" },
      { value: "已結清", label: "已結清" },
    ],
    []
  );

  const settleStatusOptions = useMemo(
    () =>
      [
        { value: "全部" as const, label: "全部" },
        { value: "生產中" as const, label: "生產中" },
        { value: "已出貨" as const, label: "已出貨" },
      ] satisfies { value: PortalOrderStatusFilter; label: string }[],
    []
  );

  const myOrdersScopeCounts = useMemo(() => {
    let ongoing = 0;
    let closed = 0;
    for (const o of myOrders) {
      if (o.status === "結案") closed += 1;
      else ongoing += 1;
    }
    return { ongoing, closed };
  }, [myOrders]);

  const myOrdersFilteredSorted = useMemo(() => {
    const q = myOrderSearch.trim().toLowerCase();
    let list = myOrders.filter((o) => {
      if (myOrdersScopeTab === "closed") {
        if (o.status !== "結案") return false;
      } else if (o.status === "結案") {
        return false;
      }

      if (settlePayFilter !== "全部" && o.payment_status !== settlePayFilter) {
        return false;
      }

      if (settleStatusFilter !== "全部" && o.status !== settleStatusFilter) {
        return false;
      }

      if (settleDateFrom || settleDateTo) {
        const d = portalOrderDateForBasis(o, settleDateBasis);
        if (!d) return false;
        if (settleDateFrom && d < settleDateFrom) return false;
        if (settleDateTo && d > settleDateTo) return false;
      }

      if (!q) return true;
      const hay = [
        o.order_number,
        o.shipping_contact_name ?? "",
        o.payment_status ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    const dir = myOrderSortAsc ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (myOrderSortBy) {
        case "order_number":
          cmp = a.order_number.localeCompare(b.order_number, "zh-Hant", { numeric: true });
          break;
        case "order_date":
          cmp = compareNullableDate(
            a.order_date ? String(a.order_date).slice(0, 10) : null,
            b.order_date ? String(b.order_date).slice(0, 10) : null
          );
          break;
        case "contact_name": {
          const an = a.shipping_contact_name ?? "";
          const bn = b.shipping_contact_name ?? "";
          cmp = an.localeCompare(bn, "zh-Hant", { numeric: true });
          break;
        }
        case "expected_delivery_date":
          cmp = compareNullableDate(
            a.expected_delivery_date ? String(a.expected_delivery_date).slice(0, 10) : null,
            b.expected_delivery_date ? String(b.expected_delivery_date).slice(0, 10) : null
          );
          break;
        case "planned_end_max":
          cmp = compareNullableDate(plannedColumnSortDate(a), plannedColumnSortDate(b));
          break;
        case "status":
          cmp = a.status.localeCompare(b.status, "zh-Hant");
          break;
        case "payment_status":
          cmp = a.payment_status.localeCompare(b.payment_status, "zh-Hant");
          break;
        case "list_grand":
          cmp = a.list_grand - b.list_grand;
          break;
        case "total_amount":
          cmp = a.total_amount - b.total_amount;
          break;
        default:
          cmp = 0;
      }
      if (cmp !== 0) return cmp * dir;
      return a.order_number.localeCompare(b.order_number, "zh-Hant", { numeric: true });
    });
    return list;
  }, [
    myOrders,
    myOrdersScopeTab,
    myOrderSearch,
    myOrderSortBy,
    myOrderSortAsc,
    settlePayFilter,
    settleStatusFilter,
    settleDateBasis,
    settleDateFrom,
    settleDateTo,
  ]);

  const portalSettlementTotals = useMemo(() => {
    const list = myOrdersFilteredSorted;
    const count = list.length;
    const sum = list.reduce((s, o) => s + o.total_amount, 0);
    const listSum = list.reduce((s, o) => s + o.list_grand, 0);
    const profitSum = listSum - sum;
    const settledRows = list.filter((o) => o.payment_status === "已結清");
    const pendingRows = list.filter((o) => o.payment_status !== "已結清");
    return {
      count,
      sum,
      listSum,
      profitSum,
      settledCount: settledRows.length,
      settledSum: settledRows.reduce((s, o) => s + o.total_amount, 0),
      pendingCount: pendingRows.length,
      pendingSum: pendingRows.reduce((s, o) => s + o.total_amount, 0),
    };
  }, [myOrdersFilteredSorted]);

  function toggleMyOrderSort(key: MyOrderSortKey) {
    if (myOrderSortBy === key) {
      setMyOrderSortAsc((v) => !v);
    } else {
      setMyOrderSortBy(key);
      setMyOrderSortAsc(
        key === "order_date" || key === "planned_end_max" || key === "contact_name"
          ? false
          : true
      );
    }
  }

  function MyOrderSortHeader({
    label,
    sortKey,
    align = "left",
  }: {
    label: string;
    sortKey: MyOrderSortKey;
    align?: "left" | "right";
  }) {
    const active = myOrderSortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleMyOrderSort(sortKey)}
        className={
          align === "right"
            ? "inline-flex w-full max-w-full flex-nowrap items-center justify-end gap-0.5 whitespace-nowrap text-right text-sm font-medium leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded-sm"
            : "inline-flex max-w-full flex-nowrap items-center gap-0.5 whitespace-nowrap text-left text-sm font-medium leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded-sm"
        }
        aria-label={`依${label}排序${active ? (myOrderSortAsc ? "升冪" : "降冪") : ""}`}
      >
        <span className="shrink-0 whitespace-nowrap">{label}</span>
        {active ? (
          myOrderSortAsc ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        )}
      </button>
    );
  }

  function applyPortalSettleThisMonth() {
    const now = new Date();
    setSettleDateBasis("order_date");
    setSettleDateFrom(localYmd(startOfMonth(now)));
    setSettleDateTo(localYmd(endOfMonth(now)));
  }

  function clearPortalSettleDates() {
    setSettleDateFrom("");
    setSettleDateTo("");
  }

  function exportPortalSettlementCsv() {
    if (!myOrdersFilteredSorted.length) return;
    const basisLabel = settleDateBasis === "order_date" ? "下單日" : "預計交貨";
    const rangeLabel =
      settleDateFrom || settleDateTo
        ? `${basisLabel} ${settleDateFrom || "…"}～${settleDateTo || "…"}`
        : "未限定日期";
    const payLabel = settlePayFilter === "全部" ? "全部" : settlePayFilter;
    const statusLabel = settleStatusFilter === "全部" ? "全部" : settleStatusFilter;
    const t = portalSettlementTotals;
    const scopeLabel = myOrdersScopeTab === "closed" ? "已結案" : "進行中";
    const meta = [
      `# 通路結算匯出（我的訂單）`,
      `# 客戶:${session?.customer_name ?? ""};列表:${scopeLabel};${rangeLabel};付款:${payLabel};狀態:${statusLabel}`,
      `# 筆數:${t.count};牌價合計(含運):${t.listSum};通路價合計(含運):${t.sum};利潤(牌價-通路價):${t.profitSum}`,
      `# 已結清:${t.settledSum}(${t.settledCount}筆);未結清:${t.pendingSum}(${t.pendingCount}筆)`,
    ].join("\n");

    const header = [
      "訂單編號",
      "聯絡人",
      "下單日",
      "預計交貨",
      "預計完成",
      "狀態",
      "付款狀態",
      "牌價(含運)",
      "通路價(含運)",
      "利潤(牌價-通路價)",
    ];
    const rows = myOrdersFilteredSorted.map((o) => [
      o.order_number,
      o.shipping_contact_name ?? "",
      o.order_date ? String(o.order_date).slice(0, 10) : "",
      o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : "",
      o.planned_end_max ?? "",
      o.status,
      o.payment_status,
      String(o.list_grand),
      String(o.total_amount),
      String(o.list_grand - o.total_amount),
    ]);
    const csv = [meta, "", header, ...rows]
      .map((line) =>
        Array.isArray(line)
          ? line
              .map((v) => {
                const s = String(v ?? "");
                if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
                return s;
              })
              .join(",")
          : line
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `我的訂單_結算_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
        portal_token: typeof json.portal_token === "string" ? json.portal_token : undefined,
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
      toast.error("訂單已進入生產或後續階段，無法刪除");
      return;
    }
    setDeleteConfirmOrder(order);
  }

  function openOrderOverview(orderId: string) {
    if (!orderId) return;
    setOrderOverviewId(orderId);
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
      if (o.status && PORTAL_NO_EDIT_DELETE_STATUSES.has(String(o.status).trim())) {
        toast.error("此訂單已進入生產或後續階段，無法修改");
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
    const channelPx = portalChannelUnitPrice(v, portalSeriesDiscountPct);
    const unit = channelPx ?? v?.base_price ?? 0;
    updateEditItem(itemId, {
      variant_id: variantId,
      unit_price: unit,
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
    const { data: statusCheck, error: statusCheckErr } = await supabase
      .from("orders")
      .select("status")
      .eq("id", editingOrderId)
      .eq("customer_id", session.customer_id)
      .single();
    if (statusCheckErr || !statusCheck) {
      toast.error(statusCheckErr?.message || "無法確認訂單狀態，請稍後再試");
      return;
    }
    const liveStatus = String((statusCheck as { status?: string }).status ?? "");
    if (!canEditOrDelete(liveStatus)) {
      toast.error("此訂單已進入生產或後續階段，無法修改");
      setEditingOrderId(null);
      setEditForm(null);
      fetchMyOrders();
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
      const plannedFromDelivery = plannedEndDateFromOrderDelivery(
        editForm.expected_delivery_date
      );
      const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
        order_item_id: row.id,
        stage: DEFAULT_WORK_ORDER_STAGE,
        status: "未開始",
        planned_end_date: plannedFromDelivery,
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
    const channelPx = portalChannelUnitPrice(v, portalSeriesDiscountPct);
    const unit = channelPx ?? v?.base_price ?? 0;
    updateItem(itemId, {
      variant_id: variantId,
      unit_price: unit,
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

      const plannedFromDelivery = plannedEndDateFromOrderDelivery(expectedDate);
      const workOrderPayload = (insertedItems ?? []).map((row: { id: string }) => ({
        order_item_id: row.id,
        stage: DEFAULT_WORK_ORDER_STAGE,
        status: "未開始",
        planned_end_date: plannedFromDelivery,
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
                      <div className="flex flex-col gap-1.5 sm:col-span-1 min-w-0">
                        <label className="text-xs text-muted-foreground">品項 *</label>
                        <div className="flex w-full min-w-0 flex-col gap-1.5">
                          <select
                            value={it.variant_id}
                            onChange={(e) => onVariantChange(it.id, e.target.value)}
                            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                          <div className="flex shrink-0 items-start">
                            <VariantSeriesThumb
                              imageUrl={
                                variants.find((v) => v.id === it.variant_id)?.series_image_url
                              }
                              compactPlaceholder
                              sizeClassName="h-10 w-10 sm:h-11 sm:w-11"
                            />
                          </div>
                        </div>
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
                      {it.variant_id ? (
                        <div className="grid grid-cols-1 gap-3 sm:col-span-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">牌價</span>
                            <div className="flex h-9 items-center justify-end rounded-md border border-input bg-muted/30 px-3 text-sm tabular-nums text-muted-foreground">
                              {(() => {
                                const sel = variants.find((vv) => vv.id === it.variant_id);
                                return sel?.base_price != null && Number.isFinite(Number(sel.base_price))
                                  ? `$${Number(sel.base_price).toLocaleString()}`
                                  : "—";
                              })()}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">通路價格</span>
                            <div className="flex h-9 items-center justify-end rounded-lg border border-dashed border-border bg-muted/40 px-3 text-sm tabular-nums text-muted-foreground">
                              {(() => {
                                const sel = variants.find((vv) => vv.id === it.variant_id);
                                const cp = portalChannelUnitPrice(sel, portalSeriesDiscountPct);
                                return cp != null ? `$${cp.toLocaleString()}` : "—";
                              })()}
                            </div>
                          </div>
                        </div>
                      ) : null}
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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ClipboardList className="h-4 w-4" />
              我的訂單
            </div>
            {!myOrdersLoading && myOrders.length > 0 ? (
              <div
                role="tablist"
                aria-label="訂單列表分類"
                className="flex w-full shrink-0 gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-auto"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={myOrdersScopeTab === "ongoing"}
                  id="portal-my-orders-tab-ongoing"
                  aria-controls="portal-my-orders-panel"
                  onClick={() => setMyOrdersScopeTab("ongoing")}
                  className={
                    myOrdersScopeTab === "ongoing"
                      ? "flex-1 rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm sm:flex-none"
                      : "flex-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:flex-none"
                  }
                >
                  進行中
                  <span className="ml-1 tabular-nums text-muted-foreground">({myOrdersScopeCounts.ongoing})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={myOrdersScopeTab === "closed"}
                  id="portal-my-orders-tab-closed"
                  aria-controls="portal-my-orders-panel"
                  onClick={() => setMyOrdersScopeTab("closed")}
                  className={
                    myOrdersScopeTab === "closed"
                      ? "flex-1 rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm sm:flex-none"
                      : "flex-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:flex-none"
                  }
                >
                  已結案
                  <span className="ml-1 tabular-nums text-muted-foreground">({myOrdersScopeCounts.closed})</span>
                </button>
              </div>
            ) : null}
          </div>
          {myOrdersLoading ? (
            <p className="text-sm text-muted-foreground">載入中…</p>
          ) : myOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無訂單紀錄</p>
          ) : (
            <div id="portal-my-orders-panel" role="tabpanel" className="space-y-3" aria-labelledby={myOrdersScopeTab === "closed" ? "portal-my-orders-tab-closed" : "portal-my-orders-tab-ongoing"}>
              <div className="rounded-lg border border-border bg-muted/15 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  結算管理
                </p>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-settle-basis">
                      期間依據
                    </label>
                    <select
                      id="portal-settle-basis"
                      value={settleDateBasis}
                      onChange={(e) => setSettleDateBasis(e.target.value as PortalDateBasis)}
                      className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="order_date">下單日</option>
                      <option value="expected_delivery">預計交貨日</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-settle-from">
                        起
                      </label>
                      <input
                        id="portal-settle-from"
                        type="date"
                        value={settleDateFrom}
                        onChange={(e) => setSettleDateFrom(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-settle-to">
                        迄
                      </label>
                      <input
                        id="portal-settle-to"
                        type="date"
                        value={settleDateTo}
                        onChange={(e) => setSettleDateTo(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <Button type="button" variant="outline" className="h-9 text-xs" onClick={applyPortalSettleThisMonth}>
                      本月（下單）
                    </Button>
                    <Button type="button" variant="ghost" className="h-9 text-xs" onClick={clearPortalSettleDates}>
                      清除日期
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-settle-pay">
                      付款狀態
                    </label>
                    <select
                      id="portal-settle-pay"
                      value={settlePayFilter}
                      onChange={(e) => setSettlePayFilter(e.target.value)}
                      className="h-9 min-w-[11rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {settlePaymentOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-settle-status">
                      狀態
                    </label>
                    <select
                      id="portal-settle-status"
                      value={settleStatusFilter}
                      onChange={(e) =>
                        setSettleStatusFilter(e.target.value as PortalOrderStatusFilter)
                      }
                      className="h-9 min-w-[11rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {settleStatusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                  與貴司對帳時可依下單日或交貨日篩選本期單據。牌價為明細原價加總並含運費；通路價為訂單應收總額（含運）。
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="text-sm text-foreground space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span>
                      <span className="font-medium tabular-nums">{portalSettlementTotals.count}</span>
                      <span className="text-muted-foreground"> 筆</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">牌價（含運）</span>{" "}
                      <span className="font-semibold tabular-nums">
                        ${portalSettlementTotals.listSum.toLocaleString()}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">通路價（含運）</span>{" "}
                      <span className="font-semibold tabular-nums">
                        ${portalSettlementTotals.sum.toLocaleString()}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">利潤（牌價−通路價）</span>{" "}
                      <span className="font-semibold tabular-nums">
                        ${portalSettlementTotals.profitSum.toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs shrink-0"
                  disabled={!myOrdersFilteredSorted.length}
                  onClick={exportPortalSettlementCsv}
                >
                  <Download className="h-3.5 w-3.5" />
                  匯出結算 CSV
                </Button>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5 max-w-md">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="portal-my-orders-search">
                  搜尋（聯絡人／訂單編號／付款狀態）
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="portal-my-orders-search"
                    value={myOrderSearch}
                    onChange={(e) => setMyOrderSearch(e.target.value)}
                    placeholder="輸入關鍵字…"
                    className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="rounded-md border border-border/80 overflow-hidden">
                <table className="w-full table-fixed border-collapse text-sm leading-snug">
                  <colgroup>
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col className="w-[16%]" />
                    <col className="w-[56px]" />
                    <col />
                    <col />
                    <col className="w-[84px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left">
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="訂單號" sortKey="order_number" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="下單日" sortKey="order_date" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom min-w-0">
                        <MyOrderSortHeader label="聯絡人" sortKey="contact_name" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="需求日" sortKey="expected_delivery_date" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="製作完成日" sortKey="planned_end_max" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="狀態" sortKey="status" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 align-bottom">
                        <MyOrderSortHeader label="付款" sortKey="payment_status" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 text-right align-bottom">
                        <MyOrderSortHeader label="牌價" sortKey="list_grand" align="right" />
                      </th>
                      <th className="whitespace-nowrap px-1 py-1.5 text-right align-bottom">
                        <MyOrderSortHeader label="通路價" sortKey="total_amount" align="right" />
                      </th>
                      <th className="w-[84px] whitespace-nowrap px-0.5 py-1.5 text-center align-bottom text-sm font-medium text-muted-foreground">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrdersFilteredSorted.map((o) => (
                      <tr key={o.id} className="border-b border-border/60">
                        <td className="min-w-0 px-1 py-1 align-middle font-mono text-sm text-foreground">
                          <span className="block truncate" title={o.order_number}>
                            {o.order_number}
                          </span>
                        </td>
                        <td className="px-1 py-1 align-middle tabular-nums text-muted-foreground whitespace-nowrap">
                          {o.order_date ? formatDateYyMmDd(o.order_date) : "—"}
                        </td>
                        <td
                          className="min-w-0 max-w-0 px-1 py-1 align-middle text-sm text-foreground"
                          title={o.shipping_contact_name ?? undefined}
                        >
                          <span className="block truncate">{o.shipping_contact_name?.trim() || "—"}</span>
                        </td>
                        <td className="px-1 py-1 align-middle tabular-nums text-muted-foreground whitespace-nowrap">
                          {o.expected_delivery_date ? formatDateYyMmDd(o.expected_delivery_date) : "—"}
                        </td>
                        <td className="min-w-0 px-1 py-1 align-middle tabular-nums text-muted-foreground whitespace-nowrap">
                          {o.planned_end_max ? (
                            formatDateYyMmDd(o.planned_end_max)
                          ) : o.expected_delivery_date ? (
                            <span className="block truncate" title={`${formatDateYyMmDd(o.expected_delivery_date)}（預計交貨備援）`}>
                              {formatDateYyMmDd(o.expected_delivery_date)}
                              <span className="text-muted-foreground"> ※</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="min-w-0 px-1 py-1 align-middle whitespace-nowrap">
                          <span className={portalStatusColor(o.status)} title={o.status}>
                            {o.status}
                          </span>
                          {o.earliest_stage ? (
                            <span className="ml-1 text-xs text-muted-foreground/60" title={`工序：${o.earliest_stage}`}>
                              ({o.earliest_stage})
                            </span>
                          ) : null}
                        </td>
                        <td className="min-w-0 px-1 py-1 align-middle text-muted-foreground whitespace-nowrap">
                          <span className="block truncate" title={o.payment_status ?? undefined}>
                            {o.payment_status || "—"}
                          </span>
                        </td>
                        <td className="px-1 py-1 align-middle text-right tabular-nums text-muted-foreground whitespace-nowrap">
                          ${o.list_grand.toLocaleString()}
                        </td>
                        <td className="px-1 py-1 align-middle text-right tabular-nums text-muted-foreground whitespace-nowrap">
                          ${o.total_amount.toLocaleString()}
                        </td>
                        <td className="w-[84px] px-0 py-1 align-middle">
                          <div className="flex flex-nowrap items-center justify-center gap-0">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                              aria-label="檢視訂單"
                              title="檢視"
                              onClick={() => openOrderOverview(o.id)}
                            >
                              <Eye className="h-3.5 w-3.5 opacity-90" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={!canEditOrDelete(o.status)}
                              aria-label="編輯訂單"
                              title={
                                canEditOrDelete(o.status)
                                  ? "編輯"
                                  : "已進入生產或後續階段，無法編輯"
                              }
                              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
                              onClick={() => setEditingOrderId(o.id)}
                            >
                              <Pencil className="h-3.5 w-3.5 opacity-90" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={!canEditOrDelete(o.status)}
                              aria-label="刪除訂單"
                              title={
                                canEditOrDelete(o.status)
                                  ? "刪除"
                                  : "已進入生產或後續階段，無法刪除"
                              }
                              className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive disabled:opacity-40"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                requestDeleteOrder(o);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 opacity-90" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {myOrdersFilteredSorted.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {myOrdersScopeTab === "closed"
                      ? myOrdersScopeCounts.closed === 0
                        ? "尚無已結案訂單"
                        : "沒有符合條件的已結案訂單"
                      : myOrdersScopeCounts.ongoing === 0
                        ? "尚無進行中訂單"
                        : "沒有符合條件的訂單"}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                「預計完成」為同訂單各工單預計完成日之最晚者；無則以預計交貨備援標示。匯出需登入憑證並請後端設定 SUPABASE_SERVICE_ROLE_KEY。
              </p>
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
                            <div className="min-w-0">
                              <label className="text-[11px] text-muted-foreground">品項 *</label>
                              <div className="mt-0.5 flex w-full min-w-0 flex-col gap-1.5">
                                <select
                                  value={it.variant_id}
                                  onChange={(e) => onEditVariantChange(it.id, e.target.value)}
                                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                >
                                  <option value="">請選擇</option>
                                  {variants.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.label}
                                      {v.base_price != null ? ` · $${v.base_price}` : ""}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex shrink-0 items-start">
                                  <VariantSeriesThumb
                                    imageUrl={
                                      variants.find((v) => v.id === it.variant_id)?.series_image_url
                                    }
                                    compactPlaceholder
                                    sizeClassName="h-8 w-8 sm:h-9 sm:w-9"
                                  />
                                </div>
                              </div>
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
                            {it.variant_id ? (
                              <div className="grid grid-cols-1 gap-2 sm:col-span-3 sm:grid-cols-2">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[11px] text-muted-foreground">牌價</span>
                                  <div className="flex h-8 items-center justify-end rounded-md border border-input bg-muted/30 px-2 text-sm tabular-nums text-muted-foreground">
                                    {(() => {
                                      const sel = variants.find((vv) => vv.id === it.variant_id);
                                      return sel?.base_price != null && Number.isFinite(Number(sel.base_price))
                                        ? `$${Number(sel.base_price).toLocaleString()}`
                                        : "—";
                                    })()}
                                  </div>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[11px] text-muted-foreground">通路價格</span>
                                  <div className="flex h-8 items-center justify-end rounded-lg border border-dashed border-border bg-muted/40 px-2 text-sm tabular-nums text-muted-foreground">
                                    {(() => {
                                      const sel = variants.find((vv) => vv.id === it.variant_id);
                                      const cp = portalChannelUnitPrice(sel, portalSeriesDiscountPct);
                                      return cp != null ? `$${cp.toLocaleString()}` : "—";
                                    })()}
                                  </div>
                                </div>
                              </div>
                            ) : null}
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

        <OrderOverviewDialog
          open={orderOverviewId != null}
          onOpenChange={(open) => {
            if (!open) setOrderOverviewId(null);
          }}
          orderId={orderOverviewId}
          visualTone="warm"
          showEditButton={false}
        />
      </div>
    </div>
  );
}
