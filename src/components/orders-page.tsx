"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  isOrderStatusLockedForManualEdit,
  normalizeWorkOrderStage,
  syncWorkOrdersToOrderStatus,
} from "@/lib/work-order-stages";
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
import {
  OrderOverviewCard,
  fetchOrderOverviewById,
  type OverviewOrder,
} from "@/components/orders-overview-page";
import { ViewCustomerDialog } from "@/components/crm/view-customer-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CustomerRow } from "@/types/crm";
import { Search, Plus, Printer, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Download, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { OrderFormDialog } from "@/components/orders/order-form-dialog";
import type {
  OrderRow,
  CustomerOption,
  VariantOption,
  OrderItemInput,
  OrdersPageMode,
  OrderStatus,
  PaymentStatus,
} from "@/components/orders/types";
import {
  mapCustomerViewRow,
  CUSTOMER_VIEW_SELECT,
  isOrderAdminReadOnly,
  orderStatusSortIndex,
  paymentStatusSortIndex,
  statusStyles,
  paymentStatusStyles,
  manualOrderStatusOptions,
  PAYMENT_STATUS_OPTIONS,
} from "@/components/orders/order-helpers";

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={statusStyles[status] ?? ""}>
      {status}
    </Badge>
  );
}

type StatusFilterValue = OrderStatus | "全部" | "非報價中" | "已結案";

const STATUS_FILTER_OPTIONS: StatusFilterValue[] = [
  "全部",
  "報價中",
  "非報價中",
  "已結案",
];

export function OrdersPage({
  mode = "order",
  isAdmin = false,
  initialOpenOrderId,
}: {
  mode?: OrdersPageMode;
  isAdmin?: boolean;
  /** 若提供，會在載入後自動開啟該筆訂單的編輯窗格 */
  initialOpenOrderId?: string;
} = {}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(
    mode === "quotation" ? "報價中" : "非報價中"
  );
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [editingItems, setEditingItems] = useState<OrderItemInput[] | undefined>(
    undefined
  );
  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<OrderRow | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [overviewById, setOverviewById] = useState<
    Record<string, OverviewOrder | null | "loading">
  >({});
  const [viewCustomer, setViewCustomer] = useState<CustomerRow | null>(null);
  const hasAppliedInitialOpenRef = useRef(false);
  const lastInitialOpenOrderIdRef = useRef<string | undefined>(undefined);

  function toggleOrderExpand(orderId: string) {
    const willExpand = !expandedIds.has(orderId);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
    if (willExpand && overviewById[orderId] === undefined) {
      setOverviewById((prev) => ({ ...prev, [orderId]: "loading" }));
      void fetchOrderOverviewById(orderId).then((row) => {
        setOverviewById((prev) => ({ ...prev, [orderId]: row }));
      });
    }
  }

  async function fetchCustomers() {
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name, contact_person, phone, delivery_address, has_elevator, channel_id")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (!customerError && customerData) {
      setCustomers(
        (customerData as any[]).map((c) => ({
          id: String(c.id),
          name: String(c.name ?? ""),
          contact_person: c.contact_person != null ? String(c.contact_person) : null,
          phone: c.phone != null ? String(c.phone) : null,
          delivery_address: c.delivery_address
            ? String(c.delivery_address)
            : null,
          has_elevator:
            c.has_elevator === true || c.has_elevator === false
              ? Boolean(c.has_elevator)
              : null,
          channel_id: c.channel_id != null ? String(c.channel_id) : null,
        }))
      );
    } else {
      setCustomers([]);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      await fetchCustomers();

      // 產品系列名稱／類別（用於規格庫先選系列 & 自動帶入 custom_category）
      const { data: seriesData } = await supabase
        .from("product_series")
        .select("id, series_name, category, image_url")
        .order("id", { ascending: true });
      const seriesNameMap = new Map<string, string>();
      const seriesCategoryMap = new Map<string, string | null>();
      const seriesImageMap = new Map<string, string | null>();
      (seriesData ?? []).forEach((s: any) => {
        const name = s.series_name ?? "";
        const cat =
          typeof s.category === "string" && s.category.trim()
            ? String(s.category)
            : null;
        const id = String(s.id);
        seriesNameMap.set(id, String(name));
        seriesCategoryMap.set(id, cat);
        const img = s.image_url != null && String(s.image_url).trim() ? String(s.image_url).trim() : null;
        seriesImageMap.set(id, img);
      });

      // 產品規格選單（含 series_id）
      const { data: variantData } = await supabase
        .from("product_variants")
        .select(
          "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, base_price, spec1, image_url, is_custom_order"
        )
        .order("product_code", { ascending: true });
      setVariants(
        ((variantData ?? []) as any[]).map((v) => {
          const w = v.dimension_w ?? "";
          const d = v.dimension_d ?? "";
          const h = v.dimension_h ?? "";
          const parts = [w, d, h].filter((x: unknown) => x !== "");
          let dim =
            parts.length === 0
              ? ""
              : `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
          const seatH =
            v.seat_height_cm != null ? Number(v.seat_height_cm) : NaN;
          if (Number.isFinite(seatH)) {
            dim =
              dim === ""
                ? `座高 ${seatH} cm`
                : `${dim} · 座高 ${seatH} cm`;
          }
          const seriesId = String(v.series_id ?? "");
          const seriesName = seriesNameMap.get(seriesId) ?? "";
          const labelParts = [
            v.product_code ?? "",
            v.wood_type ?? "",
            v.spec1 ?? "",
            dim,
          ].filter((s: string) => s && s.trim());
          const variantImg =
            v.image_url != null && String(v.image_url).trim()
              ? String(v.image_url).trim()
              : null;
          return {
            id: String(v.id),
            series_id: seriesId,
            series_name: seriesName,
            series_category: seriesCategoryMap.get(seriesId) ?? null,
            series_image_url: variantImg ?? seriesImageMap.get(seriesId) ?? null,
            label: labelParts.join(" / "),
            base_price:
              v.base_price !== undefined && v.base_price !== null
                ? Number(v.base_price)
                : null,
            is_custom_order: v.is_custom_order === true,
            spec1: v.spec1 ?? null,
            wood_type: v.wood_type ?? null,
            dimension_w: v.dimension_w != null ? Number(v.dimension_w) : null,
            dimension_d: v.dimension_d != null ? Number(v.dimension_d) : null,
            dimension_h: v.dimension_h != null ? Number(v.dimension_h) : null,
            seat_height_cm:
              v.seat_height_cm != null ? Number(v.seat_height_cm) : null,
          };
        })
      );

      await fetchOrders();
      setLoading(false);
    }

    async function fetchOrders() {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, deposit_amount, shipping_fee, shipping_address, shipping_contact_name, shipping_contact_phone, shipping_has_elevator, internal_notes, explanation_image_url, customer_id, customers(name, alias)"
        )
        .is("deleted_at", null)
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
          shipping_fee: Number(row.shipping_fee ?? 0),
          customer_id: row.customer_id ? String(row.customer_id) : null,
          customer_name:
            (row.customers && row.customers.name) ||
            (Array.isArray(row.customers) && row.customers[0]?.name) ||
            "",
          customer_alias:
            (row.customers && row.customers.alias) ||
            (Array.isArray(row.customers) && row.customers[0]?.alias) ||
            null,
          shipping_address: row.shipping_address ?? null,
          shipping_contact_name: row.shipping_contact_name ?? null,
          shipping_contact_phone: row.shipping_contact_phone ?? null,
          shipping_has_elevator:
            row.shipping_has_elevator === true || row.shipping_has_elevator === false
              ? Boolean(row.shipping_has_elevator)
              : null,
          internal_notes: row.internal_notes ?? null,
          explanation_image_url: row.explanation_image_url ?? null,
        }))
      );
    }

    bootstrap();
  }, []);

  // 深連結訂單 id 變更時允許再次自動開啟編輯窗
  useEffect(() => {
    if (initialOpenOrderId !== lastInitialOpenOrderIdRef.current) {
      hasAppliedInitialOpenRef.current = false;
      lastInitialOpenOrderIdRef.current = initialOpenOrderId;
    }
  }, [initialOpenOrderId]);

  // 若外部有指定要打開的訂單（例如從生產管理點過來），在首次載入完訂單列表後自動開啟編輯窗格
  useEffect(() => {
    if (!initialOpenOrderId) return;
    if (hasAppliedInitialOpenRef.current) return;
    if (!orders.length) return;
    const target = orders.find((o) => o.id === initialOpenOrderId);
    if (!target) return;
    hasAppliedInitialOpenRef.current = true;
    handleEdit(target);
  }, [initialOpenOrderId, orders]);

  async function reloadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_date, expected_delivery_date, status, payment_status, total_amount, deposit_amount, shipping_fee, shipping_address, shipping_contact_name, shipping_contact_phone, shipping_has_elevator, internal_notes, explanation_image_url, customer_id, customers(name, alias)"
      )
      .is("deleted_at", null)
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
        shipping_fee: Number(row.shipping_fee ?? 0),
        customer_id: row.customer_id ? String(row.customer_id) : null,
        customer_name:
          (row.customers && row.customers.name) ||
          (Array.isArray(row.customers) && row.customers[0]?.name) ||
          "",
          customer_alias:
            (row.customers && row.customers.alias) ||
            (Array.isArray(row.customers) && row.customers[0]?.alias) ||
            null,
        shipping_address: row.shipping_address ?? null,
        shipping_contact_name: row.shipping_contact_name ?? null,
        shipping_contact_phone: row.shipping_contact_phone ?? null,
        shipping_has_elevator:
          row.shipping_has_elevator === true || row.shipping_has_elevator === false
            ? Boolean(row.shipping_has_elevator)
            : null,
        internal_notes: row.internal_notes ?? null,
        explanation_image_url: row.explanation_image_url ?? null,
      }))
    );
  }

  const [monthFilter, setMonthFilter] = useState<string>("");

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      if (!o.order_date) return;
      const ym = o.order_date.slice(0, 7);
      if (ym) set.add(ym);
    });
    return Array.from(set).sort().reverse();
  }, [orders]);

  /** 下拉選單：主檔客戶 + 訂單曾出現但主檔可能缺漏的 customer_id；通路客戶置頂並標示 [通路] */
  const customerFilterOptions = useMemo(() => {
    const byId = new Map<string, { name: string; channelId: string | null }>();
    customers.forEach((c) => {
      const ch = c.channel_id != null && String(c.channel_id).trim() ? String(c.channel_id) : null;
      byId.set(c.id, { name: c.name, channelId: ch });
    });
    orders.forEach((o) => {
      if (o.customer_id && !byId.has(o.customer_id)) {
        byId.set(o.customer_id, {
          name: o.customer_name?.trim() || "—",
          channelId: null,
        });
      }
    });
    return Array.from(byId.entries())
      .map(([id, { name, channelId }]) => {
        const isChannel = channelId != null;
        return {
          id,
          name,
          isChannel,
          label: isChannel ? `[通路] ${name}` : name,
        };
      })
      .sort((a, b) => {
        if (a.isChannel !== b.isChannel) return a.isChannel ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
      });
  }, [customers, orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.shipping_contact_name ?? "").toLowerCase().includes(q);
      const matchCustomer =
        !customerFilter || o.customer_id === customerFilter;
      const matchStatus =
        statusFilter === "全部"
          ? true
          : statusFilter === "非報價中"
          ? o.status !== "報價中" && o.status !== "結案"
          : statusFilter === "已結案"
          ? o.status === "結案"
          : o.status === statusFilter;
      const matchMonth =
        !monthFilter || !o.order_date
          ? !monthFilter
          : o.order_date.slice(0, 7) === monthFilter;
      return matchSearch && matchCustomer && matchStatus && matchMonth;
    });
  }, [orders, search, customerFilter, statusFilter, monthFilter]);

  const filteredTotalAmount = useMemo(
    () => filtered.reduce((sum, o) => sum + (o.total_amount || 0), 0),
    [filtered]
  );

  type OrderSortKey =
    | "order_number"
    | "customer_name"
    | "shipping_contact_name"
    | "order_date"
    | "expected_delivery_date"
    | "status"
    | "payment_status"
    | "deposit_amount"
    | "total_amount";
  const [orderSort, setOrderSort] = useState<{ key: OrderSortKey; dir: "asc" | "desc" }>({
    key: "order_date",
    dir: "desc",
  });
  const sortKey = orderSort.key;
  const sortDir = orderSort.dir;

  const sortedOrders = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sortKey === "status") {
        const ar = orderStatusSortIndex(a.status);
        const br = orderStatusSortIndex(b.status);
        if (ar !== br) return sortDir === "asc" ? ar - br : br - ar;
        const ap = paymentStatusSortIndex(a.payment_status);
        const bp = paymentStatusSortIndex(b.payment_status);
        if (ap !== bp) return sortDir === "asc" ? ap - bp : bp - ap;
        const ad = a.order_date ?? "";
        const bd = b.order_date ?? "";
        return bd.localeCompare(ad);
      }
      if (sortKey === "payment_status") {
        const ap = paymentStatusSortIndex(a.payment_status);
        const bp = paymentStatusSortIndex(b.payment_status);
        if (ap !== bp) return sortDir === "asc" ? ap - bp : bp - ap;
        const ar = orderStatusSortIndex(a.status);
        const br = orderStatusSortIndex(b.status);
        if (ar !== br) return sortDir === "asc" ? ar - br : br - ar;
        const ad = a.order_date ?? "";
        const bd = b.order_date ?? "";
        return bd.localeCompare(ad);
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? -1 : 1;
      if (bv == null) return sortDir === "asc" ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      const cmp = as.localeCompare(bs, "zh-Hant");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function toggleOrderSort(key: OrderSortKey) {
    setOrderSort((prev) =>
      prev.key === key
        ? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  function OrderSortHeader({ label, sortKey: colKey }: { label: string; sortKey: OrderSortKey }) {
    const active = sortKey === colKey;
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </span>
    );
  }

  function exportFilteredCsv() {
    if (!filtered.length) {
      toast.info("目前沒有可匯出的訂單資料");
      return;
    }
    const header = [
      "訂單編號",
      "客戶姓名",
      "聯絡人",
      "下單日",
      "預計交貨日",
      "訂單狀態",
      "付款狀態",
      "訂金",
      "總金額",
    ];
    const rows = filtered.map((o) => [
      o.order_number,
      o.customer_name,
      o.shipping_contact_name ?? "",
      o.order_date ?? "",
      o.expected_delivery_date ?? "",
      o.status,
      o.payment_status,
      String(o.deposit_amount ?? 0),
      String(o.total_amount ?? 0),
    ]);
    const csv = [header, ...rows]
      .map((cols) =>
        cols
          .map((v) => {
            const s = String(v ?? "");
            if (/[",\n]/.test(s)) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fileLabel =
      monthFilter || statusFilter !== "全部"
        ? `orders_${monthFilter || "all"}_${statusFilter}`
        : "orders_all";
    a.href = url;
    a.download = `${fileLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已匯出訂單 CSV");
  }

  async function openCustomerOverview(order: OrderRow) {
    const customerId = order.customer_id?.trim();
    if (!customerId) {
      toast.error("此訂單無綁定客戶");
      return;
    }
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_VIEW_SELECT)
      .eq("id", customerId)
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message || "找不到客戶資料");
      return;
    }
    setViewCustomer(mapCustomerViewRow(data as Record<string, unknown>));
  }

  async function handleEdit(order: OrderRow) {
    const itemSelectBase = `
        id,
        variant_id,
        quantity,
        unit_price,
        custom_notes,
        custom_category,
        custom_name,
        custom_description,
        custom_dimension_w,
        custom_dimension_d,
        custom_dimension_h,
        image_url,
        wood_type,
        seat_height_cm,
        work_orders (
          stage,
          assignee_id,
          planned_end_date
        ),
        product_variants (
          series_id,
          base_price,
          dimension_w,
          dimension_d,
          dimension_h,
          seat_height_cm
        )
      `;
    const itemSelectWithChannel = itemSelectBase.replace(
      "unit_price,",
      "unit_price, channel_unit_price,",
    );
    let data: unknown[] | null = null;
    let error: { message?: string } | null = null;
    const withChannel = await supabase
      .from("order_items")
      .select(itemSelectWithChannel)
      .eq("order_id", order.id)
      .order("line_order", { ascending: true })
      .order("id", { ascending: true });
    data = withChannel.data;
    error = withChannel.error;
    if (error && /column .* does not exist/i.test(error.message ?? "")) {
      const retry = await supabase
        .from("order_items")
        .select(itemSelectBase)
        .eq("order_id", order.id)
        .order("line_order", { ascending: true })
        .order("id", { ascending: true });
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      toast.error(error.message || "讀取訂單明細失敗");
      return;
    }
    const items: OrderItemInput[] = ((data ?? []) as any[]).map((d, idx) => {
      const isCustom = !d.variant_id;
      const pv = d.product_variants as
        | {
            series_id?: string | null;
            base_price?: number | null;
            dimension_w?: number | null;
            dimension_d?: number | null;
            dimension_h?: number | null;
            seat_height_cm?: number | null;
          }
        | null
        | undefined;

      // 若為規格品，且 custom_dimension_* 尚未有值，從 product_variants 尺寸回填一次，讓舊訂單也能顯示尺寸
      const dimW =
        d.custom_dimension_w !== undefined && d.custom_dimension_w !== null
          ? Number(d.custom_dimension_w)
          : pv?.dimension_w !== undefined && pv.dimension_w !== null
          ? Number(pv.dimension_w)
          : null;
      const dimD =
        d.custom_dimension_d !== undefined && d.custom_dimension_d !== null
          ? Number(d.custom_dimension_d)
          : pv?.dimension_d !== undefined && pv.dimension_d !== null
          ? Number(pv.dimension_d)
          : null;
      const dimH =
        d.custom_dimension_h !== undefined && d.custom_dimension_h !== null
          ? Number(d.custom_dimension_h)
          : pv?.dimension_h !== undefined && pv.dimension_h !== null
          ? Number(pv.dimension_h)
          : null;

      const seatH =
        d.seat_height_cm !== undefined && d.seat_height_cm !== null
          ? Number(d.seat_height_cm)
          : pv?.seat_height_cm !== undefined && pv.seat_height_cm !== null
          ? Number(pv.seat_height_cm)
          : null;

      const woRaw = d.work_orders as
        | { stage?: string; assignee_id?: string | null; planned_end_date?: string | null }
        | { stage?: string; assignee_id?: string | null; planned_end_date?: string | null }[]
        | null
        | undefined;
      const wo = Array.isArray(woRaw) ? woRaw[0] : woRaw;

      return {
        id: d.id ? String(d.id) : `item-${idx}`,
        variant_id: d.variant_id ? String(d.variant_id) : "",
        // 從關聯的 product_variants 帶回系列，讓「系列」下拉在編輯時能維持原本選擇
        series_id:
          pv && pv.series_id != null
            ? String(pv.series_id)
            : undefined,
        quantity: Number(d.quantity ?? 1),
        unit_price:
          d.variant_id && pv?.base_price != null && Number.isFinite(Number(pv.base_price))
            ? Number(pv.base_price)
            : Number(d.unit_price ?? 0),
        channel_unit_price:
          isCustom && d.channel_unit_price != null && Number.isFinite(Number(d.channel_unit_price))
            ? Number(d.channel_unit_price)
            : null,
        isNewLine: false,
        custom_notes: d.custom_notes ?? "",
        kind: isCustom ? "custom" : "variant",
        custom_category: d.custom_category ?? null,
        custom_name: d.custom_name ?? null,
        custom_description: d.custom_description ?? null,
        custom_dimension_w: dimW,
        custom_dimension_d: dimD,
        custom_dimension_h: dimH,
        seat_height_cm: seatH,
        image_url: d.image_url ?? null,
        wood_type: d.wood_type != null && String(d.wood_type).trim() !== "" ? String(d.wood_type) : null,
        work_order_stage: normalizeWorkOrderStage(wo?.stage),
        work_order_assignee_id:
          wo?.assignee_id != null && String(wo.assignee_id).trim()
            ? String(wo.assignee_id)
            : null,
        work_order_planned_end_date:
          wo?.planned_end_date != null && String(wo.planned_end_date).trim()
            ? String(wo.planned_end_date).slice(0, 10)
            : null,
      };
    });
    setEditingOrder(order);
    setEditingItems(items);
    setFormOpen(true);
  }

  function requestDelete(order: OrderRow) {
    if (isOrderAdminReadOnly(order)) {
      toast.error("已結案之訂單無法刪除");
      return;
    }
    setDeleteConfirmOrder(order);
  }

  async function performDeleteOrder() {
    if (!deleteConfirmOrder) return;
    const order = deleteConfirmOrder;
    setDeleteConfirmOrder(null);
    if (isOrderAdminReadOnly(order)) {
      toast.error("已結案之訂單無法刪除");
      return;
    }
    const { error } = await supabase
      .from("orders")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", order.id);
    if (error) {
      toast.error(error.message || "刪除訂單失敗");
      return;
    }
    toast.success("已刪除訂單");
    reloadOrders();
  }

  async function updateOrderInline(
    id: string,
    patch: Partial<Pick<OrderRow, "status" | "payment_status" | "deposit_amount" | "expected_delivery_date">>
  ) {
    const row = orders.find((o) => o.id === id);
    if (row && isOrderAdminReadOnly(row)) {
      toast.error("已結案之訂單無法變更");
      return;
    }
    if (
      patch.status != null &&
      row &&
      isOrderStatusLockedForManualEdit(row.status)
    ) {
      toast.error("請至生產管理調整工單工序；訂單為生產中／暫停時無法手動改訂單狀態");
      return;
    }
    const payload: any = {};
    if (patch.status) payload.status = patch.status;
    if (patch.payment_status) payload.payment_status = patch.payment_status;
    if (patch.deposit_amount !== undefined) {
      payload.deposit_amount = patch.deposit_amount;
    }
    if (patch.expected_delivery_date !== undefined) {
      payload.expected_delivery_date = patch.expected_delivery_date;
    }
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase.from("orders").update(payload).eq("id", id);
    if (error) {
      toast.error(error.message || "更新訂單狀態失敗");
      return;
    }
    if (patch.status) {
      const sync = await syncWorkOrdersToOrderStatus(supabase, id, patch.status);
      if (!sync.ok) {
        toast.error(sync.error || "訂單已更新，但工單工序同步失敗");
      }
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜尋訂單編號、客戶或聯絡人..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-72"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">客戶</span>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="h-9 min-w-[10rem] max-w-[min(100vw-2rem,18rem)] rounded-lg border border-input bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="依客戶篩選"
            >
              <option value="">全部客戶</option>
              {customerFilterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">月份</span>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">全部月份</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
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
            {mode === "quotation" ? "新增報價" : "新增訂單"}
          </Button>
        </div>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2 text-xs">
          <div className="text-muted-foreground">
            {monthFilter ? `目前篩選月份：${monthFilter}` : "目前顯示：全部月份"}
            {" · "}
            {customerFilter
              ? `客戶：${customerFilterOptions.find((c) => c.id === customerFilter)?.label ?? "—"}`
              : "客戶：全部"}
            {" · "}
            {statusFilter === "全部"
              ? "狀態：全部"
              : statusFilter === "非報價中"
              ? "狀態：非報價中"
              : statusFilter === "已結案"
              ? "狀態：已結案"
              : `狀態：${statusFilter}`}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-foreground">
              篩選結果總金額：
              <span className="font-semibold ml-1">
                {filteredTotalAmount.toLocaleString()}
              </span>
            </span>
            <Link
              href="/print/shipping-marks"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 h-8 px-3 text-xs font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground whitespace-nowrap"
              aria-label="開啟物流警示標列印（新分頁）"
            >
              <Printer className="h-3.5 w-3.5 shrink-0" />
              物流警示標
            </Link>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={exportFilteredCsv}
              disabled={!filtered.length}
              aria-label="匯出篩選後訂單為 CSV"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              匯出 CSV
            </Button>
          </div>
        </div>
      )
      }

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors">
                <OrderSortHeader label="編號" sortKey="order_number" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("order_date")}
                title="點擊排序"
              >
                <OrderSortHeader label="下單日" sortKey="order_date" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("customer_name")}
                title="點擊排序"
              >
                <OrderSortHeader label="客戶" sortKey="customer_name" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("expected_delivery_date")}
                title="點擊排序"
              >
                <OrderSortHeader label="交期" sortKey="expected_delivery_date" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("status")}
                title="點擊排序"
              >
                <OrderSortHeader label="狀態" sortKey="status" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("payment_status")}
                title="點擊排序"
              >
                <OrderSortHeader label="付款" sortKey="payment_status" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold text-right cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("deposit_amount")}
                title="點擊排序"
              >
                <OrderSortHeader label="訂金" sortKey="deposit_amount" />
              </TableHead>
              <TableHead
                className="px-1.5 text-xs font-semibold text-right cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("total_amount")}
                title="點擊排序"
              >
                <OrderSortHeader label="金額" sortKey="total_amount" />
              </TableHead>
              <TableHead
                className="px-1 text-xs font-semibold text-right whitespace-nowrap"
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
              sortedOrders.map((order) => {
                const rowReadOnly = isOrderAdminReadOnly(order);
                const isExpanded = expandedIds.has(order.id);
                const overview = overviewById[order.id];
                return (
                <Fragment key={order.id}>
                <TableRow
                  className={rowReadOnly ? "group" : "group cursor-pointer"}
                  onClick={rowReadOnly ? undefined : () => handleEdit(order)}
                >
                  <TableCell className="px-1.5 text-sm font-mono text-primary truncate">
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded px-0.5 py-0.5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleEdit(order);
                      }}
                    >
                      {order.order_number ? order.order_number.replace(/^ORD-/i, "") : "—"}
                    </button>
                  </TableCell>
                  <TableCell className="px-1.5 text-sm text-muted-foreground tabular-nums">
                    {order.order_date ? order.order_date.replace(/-/g, "/") : "—"}
                  </TableCell>
                  <TableCell className="px-1.5 text-sm whitespace-normal">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openCustomerOverview(order);
                        }}
                        className="text-left font-medium text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                        title="客戶總覽"
                      >
                        {order.customer_name || "—"}
                        {order.customer_alias && order.customer_alias.trim() && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({order.customer_alias})
                          </span>
                        )}
                      </button>
                      {order.shipping_contact_name?.trim() ? (
                        <span className="text-xs text-muted-foreground">
                          ／{order.shipping_contact_name.trim()}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-1.5 text-sm">
                    {rowReadOnly ? (
                      <span className="text-muted-foreground tabular-nums">
                        {order.expected_delivery_date
                          ? order.expected_delivery_date.replace(/-/g, "/")
                          : "—"}
                      </span>
                    ) : (
                      <input
                        type="date"
                        value={order.expected_delivery_date ?? ""}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateOrderInline(order.id, {
                            expected_delivery_date: e.target.value || null,
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="預計交貨日"
                      />
                    )}
                  </TableCell>
                  <TableCell className="px-1.5 text-sm">
                    {rowReadOnly ||
                    isOrderStatusLockedForManualEdit(order.status) ? (
                      <StatusBadge status={order.status} />
                    ) : (
                      <div
                        className={`inline-flex items-center rounded-md border px-1 py-0.5 text-xs ${statusStyles[order.status] ?? ""}`}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <select
                          value={order.status}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateOrderInline(order.id, {
                              status: e.target.value as OrderStatus,
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="bg-transparent border-none focus:outline-none focus:ring-0 text-inherit"
                        >
                          {manualOrderStatusOptions(order.status).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-1.5 text-sm">
                    {rowReadOnly ? (
                      <Badge
                        variant="outline"
                        className={paymentStatusStyles[order.payment_status] ?? ""}
                      >
                        {order.payment_status}
                      </Badge>
                    ) : (
                      <div
                        className={`inline-flex items-center rounded-md border px-1 py-0.5 text-xs ${paymentStatusStyles[order.payment_status] ?? ""}`}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <select
                          value={order.payment_status}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateOrderInline(order.id, {
                              payment_status: e.target.value as PaymentStatus,
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="bg-transparent border-none focus:outline-none focus:ring-0 text-inherit"
                        >
                          {PAYMENT_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-1.5 text-right text-sm tabular-nums">
                    {order.deposit_amount
                      ? order.deposit_amount.toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell className="px-1.5 text-right text-sm font-medium tabular-nums">
                    {order.total_amount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right px-1 py-0.5">
                    <div className="flex justify-end gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title={isExpanded ? "收合訂單內容" : "展開訂單內容（品項／明細）"}
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleOrderExpand(order.id);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title={order.status === "報價中" ? "報價列印" : "訂單列印"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const id = encodeURIComponent(order.id);
                          const path =
                            order.status === "報價中"
                              ? `/print/quotation/${id}`
                              : `/print/order/${id}`;
                          const url = `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <Printer className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title="地址條"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const id = encodeURIComponent(order.id);
                          const path = `/print/address-label/${id}`;
                          const url = `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <span className="text-[10px] leading-none">標</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title={rowReadOnly ? "檢視" : "編輯"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleEdit(order);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive disabled:opacity-40"
                        title={rowReadOnly ? "已結案無法刪除" : "刪除"}
                        disabled={rowReadOnly}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(order); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="p-0">
                      <div className="border-t border-border bg-muted/20 p-3 sm:p-4">
                        {overview === undefined || overview === "loading" ? (
                          <p className="py-6 text-center text-sm text-muted-foreground">
                            載入訂單內容中…
                          </p>
                        ) : overview ? (
                          <OrderOverviewCard
                            order={overview}
                            variant="dialog"
                            detailLevel="full"
                            showEditButton={false}
                          />
                        ) : (
                          <p className="py-6 text-center text-sm text-muted-foreground">
                            無法載入訂單內容
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                </Fragment>
              );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {orders.length} 筆訂單
      </p>

      <ViewCustomerDialog
        open={viewCustomer != null}
        onOpenChange={(open) => {
          if (!open) setViewCustomer(null);
        }}
        row={viewCustomer}
      />

      <OrderFormDialog
        key={editingOrder?.id ?? "new-order"}
        readOnly={Boolean(editingOrder && isOrderAdminReadOnly(editingOrder))}
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
        onRefreshCustomers={fetchCustomers}
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

