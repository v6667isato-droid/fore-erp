"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
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
import { AddCustomerDialog } from "@/components/crm/add-customer-dialog";
import { Search, Plus, X, Image as ImageIcon, Loader2, UserPlus, Printer, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Download } from "lucide-react";
import { toast } from "sonner";

type OrderStatus = "報價中" | "繪圖中" | "排程中" | "生產中" | "已出貨";
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
  customer_alias?: string | null;
  deposit_amount: number;
  shipping_fee?: number;
  shipping_address?: string | null;
  shipping_contact_name?: string | null;
  shipping_contact_phone?: string | null;
  shipping_has_elevator?: boolean | null;
  internal_notes?: string | null;
  explanation_image_url?: string | null;
}

/** DB total_amount 為應收總額（折扣後小計+運費）→ 表單「折扣後總金額」欄位 */
function orderDiscountSubtotalField(order: OrderRow): string {
  if (order.total_amount == null || !Number.isFinite(Number(order.total_amount))) {
    return "";
  }
  const grand = Number(order.total_amount);
  const ship = Math.max(0, Number(order.shipping_fee) || 0);
  return String(Math.max(0, grand - ship));
}

interface CustomerOption {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  delivery_address: string | null;
  has_elevator: boolean | null;
  channel_id?: string | null;
}

interface VariantOption {
  id: string;
  series_id: string;
  series_name: string;
  series_category?: string | null;
  label: string;
  base_price: number | null;
  spec1?: string | null;
  wood_type?: string | null;
  dimension_w?: number | null;
  dimension_d?: number | null;
  dimension_h?: number | null;
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
  image_url?: string | null;
  wood_type?: string | null;
}

type OrdersPageMode = "all" | "quotation" | "order";

const IMAGE_BUCKET = "product-images";
const ORDER_EXPLANATION_BUCKET = "order-explanations";
const IMAGE_COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
} as const;

/** 訂單說明／尺寸圖需保留線條與文字可讀性，比品項縮圖寬鬆 */
const ORDER_EXPLANATION_COMPRESSION_OPTIONS = {
  maxSizeMB: 3,
  maxWidthOrHeight: 2880,
  initialQuality: 0.95,
  useWebWorker: true,
} as const;

const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "報價中",
  "繪圖中",
  "排程中",
  "生產中",
  "已出貨",
];

const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  "未付款",
  "已付訂金",
  "已結清",
];

// 與「使用回饋」頁面狀態欄使用相同色系（較鮮明的色階）
const statusStyles: Record<OrderStatus, string> = {
  報價中: "bg-amber-100 text-amber-800 border-amber-200",
  繪圖中: "bg-violet-100 text-violet-800 border-violet-200",
  排程中: "bg-amber-100 text-amber-800 border-amber-200",
  生產中: "bg-blue-100 text-blue-800 border-blue-200",
  已出貨: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const paymentStatusStyles: Record<PaymentStatus, string> = {
  未付款: "bg-amber-100 text-amber-800 border-amber-200",
  部分付款: "bg-blue-100 text-blue-800 border-blue-200",
  已付訂金: "bg-blue-100 text-blue-800 border-blue-200",
  已結清: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const WOOD_TYPE_OPTIONS = ["白橡木", "胡桃木", "柚木", "雞翅木"] as const;
const WOOD_TYPE_DATALIST_ID = "order-form-wood-type-list";

function WoodTypeComboboxInput({
  id,
  value,
  onChange,
  placeholder = "選擇或輸入木種",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      list={WOOD_TYPE_DATALIST_ID}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      autoComplete="off"
    />
  );
}

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

type ExplanationImage = { url: string; title?: string | null };

/** 將 DB 的 explanation_image_url 解析為圖片資料（相容舊版 URL 字串/字串陣列，以及新版 {url,title} 陣列） */
function parseExplanationImages(raw: string | null | undefined): ExplanationImage[] {
  if (raw == null || raw === "") return [];
  const normalizeUrl = (u: unknown): string | null => {
    if (typeof u !== "string") return null;
    const s = u.trim();
    return s ? s : null;
  };
  const normalizeTitle = (t: unknown): string | null => {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s ? s : null;
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 1) ["url", ...]
      if (parsed.every((x) => typeof x === "string")) {
        return (parsed as string[])
          .map((u) => normalizeUrl(u))
          .filter((u): u is string => Boolean(u))
          .map((url) => ({ url }));
      }
      // 2) [{url,title}, ...]
      return (parsed as any[])
        .map((x): ExplanationImage | null => {
          const url = normalizeUrl((x as any)?.url);
          if (!url) return null;
          const title = normalizeTitle((x as any)?.title);
          return { url, title };
        })
        .filter((x): x is ExplanationImage => x != null);
    }
    if (typeof parsed === "string") {
      const url = normalizeUrl(parsed);
      return url ? [{ url }] : [];
    }
    return [];
  } catch {
    const url = normalizeUrl(raw);
    return url ? [{ url }] : [];
  }
}

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerOption[];
  variants: VariantOption[];
  initialOrder?: OrderRow | null;
  initialItems?: OrderItemInput[];
  onSaved: () => void;
  onRefreshCustomers: () => Promise<void>;
}

function OrderFormDialog({
  open,
  onOpenChange,
  customers,
  variants,
  initialOrder,
  initialItems,
  onSaved,
  onRefreshCustomers,
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
  // 折扣後總價（可手動輸入）；編輯模式一進來就要 locked=true，否則第一輪 effect 仍讀到 false 而覆寫掉 DB 帶入的值
  const [discountTotal, setDiscountTotal] = useState<string>(() =>
    initialOrder ? orderDiscountSubtotalField(initialOrder) : ""
  );
  const [discountLocked, setDiscountLocked] = useState(() => Boolean(initialOrder));
  const [deposit, setDeposit] = useState<string>(() => {
    if (initialOrder?.deposit_amount != null) {
      return String(initialOrder.deposit_amount);
    }
    if (initialOrder?.total_amount != null) {
      // 若舊訂單沒有訂金紀錄，預設用折扣後總價的 50% 當作初始顯示值
      return String(Math.round(Number(initialOrder.total_amount) * 0.5));
    }
    return "0";
  });
  const [depositPercent, setDepositPercent] = useState<string>("50");
  const [shippingFee, setShippingFee] = useState<string>(() => {
    if (initialOrder?.shipping_fee != null) {
      return String(initialOrder.shipping_fee);
    }
    return "0";
  });
  const prevCustomerIdRef = useRef<string>("");
  const [draftOrderNumber, setDraftOrderNumber] = useState<string>(() => {
    return initialOrder?.order_number ?? generateOrderNumber();
  });
  const [shippingAddress, setShippingAddress] = useState<string>("");
  const [shippingContactName, setShippingContactName] = useState<string>("");
  const [shippingContactPhone, setShippingContactPhone] = useState<string>("");
  /** null = 未填；true/false = 有／無電梯 */
  const [shippingHasElevator, setShippingHasElevator] = useState<boolean | null>(null);
  const [internalNotes, setInternalNotes] = useState<string>(
    ""
  );
  const [orderExplanationImages, setOrderExplanationImages] = useState<ExplanationImage[]>(() =>
    parseExplanationImages(initialOrder?.explanation_image_url)
  );
  const [uploadingImageItemId, setUploadingImageItemId] = useState<string | null>(null);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [seriesDiscounts, setSeriesDiscounts] = useState<
    Record<string, { channel_id: string; discount_percent: number }[]>
  >({});
  /** 用於品項總額變動時同步「折扣後總金額」；從 props 載入表單時須重設，否則會沿用上一筆對話的總計造成 delta 錯誤 */
  const prevTotalAmountRef = useRef<number | null>(null);
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
            wood_type: null,
          },
        ]
  );

  // 讀取系列 x 通路折扣（表單掛載時載入一次即可）
  useEffect(() => {
    let cancelled = false;
    async function loadDiscounts() {
      const { data, error } = await supabase
        .from("product_series_channel_discounts")
        .select("series_id, channel_id, discount_percent");
      if (error || !data || cancelled) return;
      const map: Record<string, { channel_id: string; discount_percent: number }[]> = {};
      (data as any[]).forEach((row) => {
        const sid = String(row.series_id);
        if (!map[sid]) map[sid] = [];
        map[sid].push({
          channel_id: String(row.channel_id),
          discount_percent: Number(row.discount_percent ?? 0),
        });
      });
      if (!cancelled) {
        setSeriesDiscounts(map);
      }
    }
    loadDiscounts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialOrder) {
      setCustomerId(initialOrder.customer_id ?? "");
      setOrderDate(initialOrder.order_date ?? "");
      setExpectedDate(initialOrder.expected_delivery_date ?? "");
      setStatus(initialOrder.status);
      setPaymentStatus(initialOrder.payment_status);
      setOrderExplanationImages(parseExplanationImages(initialOrder.explanation_image_url));
      setInternalNotes(initialOrder.internal_notes ?? "");
      setDraftOrderNumber(initialOrder.order_number);
      setDiscountTotal(orderDiscountSubtotalField(initialOrder));
      setDiscountLocked(true);
      setDeposit(
        initialOrder.deposit_amount != null
          ? String(initialOrder.deposit_amount)
          : initialOrder.total_amount != null
          ? String(Math.round(Number(initialOrder.total_amount) * 0.5))
          : "0"
      );
      setShippingFee(
        initialOrder.shipping_fee != null ? String(initialOrder.shipping_fee) : "0"
      );
    }
    if (initialItems && initialItems.length) {
      setItems(initialItems);
    }
    if (initialOrder || (initialItems != null && initialItems.length > 0)) {
      prevTotalAmountRef.current = null;
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
    setDepositPercent("50");
    setShippingFee("0");
    prevCustomerIdRef.current = "";
    setDraftOrderNumber(generateOrderNumber());
    setDiscountLocked(false);
    setDiscountTotal("");
    setShippingAddress("");
    setShippingContactName("");
    setShippingContactPhone("");
    setShippingHasElevator(null);
    setInternalNotes("");
    setOrderExplanationImages([]);
    setItems([
      {
        id: "item-0",
        variant_id: "",
        quantity: 1,
        unit_price: 0,
        custom_notes: "",
        kind: "variant",
        wood_type: null,
      },
    ]);
    prevTotalAmountRef.current = null;
  }, [open, initialOrder]);

  // 新增模式：選到特定通路時，將訂金%預設改為 0%
  useEffect(() => {
    if (isEdit) return;

    const selected = customers.find((c) => c.id === customerId);
    const isXiemumu = Boolean(selected?.name?.includes("謝木木工作室"));

    const prevId = prevCustomerIdRef.current;
    const prevSelected = customers.find((c) => c.id === prevId);
    const wasXiemumu = Boolean(prevSelected?.name?.includes("謝木木工作室"));

    prevCustomerIdRef.current = customerId;

    // 只在「仍是預設狀態」時自動切換，避免覆蓋使用者手動輸入
    if (isXiemumu) {
      if (depositPercent === "50" && (deposit === "" || deposit === "0")) {
        setDepositPercent("0");
        setDeposit("0");
      }
      return;
    }

    if (wasXiemumu) {
      if (depositPercent === "0" && (deposit === "" || deposit === "0")) {
        setDepositPercent("50");
      }
    }
  }, [customerId, customers, isEdit, deposit, depositPercent]);

  // 若是編輯模式，初始化寄送資訊
  useEffect(() => {
    if (!initialOrder) return;
    setShippingAddress(initialOrder.shipping_address ?? "");
    setShippingContactName(initialOrder.shipping_contact_name ?? "");
    setShippingContactPhone(initialOrder.shipping_contact_phone ?? "");
    setShippingHasElevator(
      initialOrder.shipping_has_elevator === true ||
        initialOrder.shipping_has_elevator === false
        ? initialOrder.shipping_has_elevator
        : null
    );
  }, [initialOrder]);

  function applyShippingFromCustomer() {
    if (!customerId) {
      toast.error("請先選擇客戶");
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) {
      toast.error("找不到客戶資料");
      return;
    }
    setShippingContactName(customer.contact_person?.trim() ?? "");
    setShippingContactPhone(customer.phone?.trim() ?? "");
    setShippingAddress(customer.delivery_address?.trim() ?? "");
    setShippingHasElevator(
      customer.has_elevator === true || customer.has_elevator === false
        ? customer.has_elevator
        : null
    );
    toast.success("已帶入客戶寄送資料");
  }

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
  const shippingFeeAmount = Math.max(0, Number(shippingFee) || 0);

  const discountBase = (() => {
    const raw = discountTotal.trim();
    if (raw === "") return totalAmount;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return totalAmount;
    return n;
  })();
  const grandTotal = discountBase + shippingFeeAmount;

  // 品項總額變動 → 同步「折扣後總金額」（單一 effect，避免與載入 effect 競態）
  // - 未鎖定（新增或尚未手改折扣）：直接等於品項總計
  // - 已鎖定（編輯載入／手改過）：依品項總額差值調整，保留整單手動折扣差
  useEffect(() => {
    if (!discountLocked) {
      setDiscountTotal(totalAmount > 0 ? String(totalAmount) : "");
      prevTotalAmountRef.current = totalAmount;
      return;
    }

    const prev = prevTotalAmountRef.current;
    if (prev === null) {
      prevTotalAmountRef.current = totalAmount;
      return;
    }
    if (prev === totalAmount) return;

    const delta = totalAmount - prev;
    prevTotalAmountRef.current = totalAmount;

    setDiscountTotal((prevDiscountTotal) => {
      const current = Number(prevDiscountTotal);
      const nextBase = Math.max(
        0,
        (Number.isFinite(current) ? current : totalAmount) + delta
      );
      const p = Number(depositPercent);
      if (p > 0) {
        const amt = Math.round((nextBase * p) / 100);
        setDeposit(String(amt));
      }
      return String(nextBase);
    });
  }, [totalAmount, discountLocked, depositPercent]);

  async function handleItemImageUpload(id: string, file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案");
      return;
    }
    setUploadingImageItemId(id);
    try {
      const compressed = await imageCompression(file, IMAGE_COMPRESSION_OPTIONS);
      const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
      const filename = `${crypto.randomUUID()}.${safeExt}`;
      const { data, error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(filename, compressed, {
          cacheControl: "3600",
          upsert: false,
        });
      if (error) {
        throw error;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(data.path);
      updateItem(id, { image_url: publicUrl });
      toast.success("圖片上傳成功");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "圖片上傳失敗");
    } finally {
      setUploadingImageItemId(null);
    }
  }

  function clearItemImage(id: string) {
    updateItem(id, { image_url: null });
  }

  async function handleOrderImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案");
      return;
    }
    setUploadingImageItemId("order");
    try {
      const compressed = await imageCompression(file, ORDER_EXPLANATION_COMPRESSION_OPTIONS);
      const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
      const filename = `${crypto.randomUUID()}.${safeExt}`;
      const { data, error } = await supabase.storage
        .from(ORDER_EXPLANATION_BUCKET)
        .upload(filename, compressed, {
          cacheControl: "3600",
          upsert: false,
        });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from(ORDER_EXPLANATION_BUCKET).getPublicUrl(data.path);
      setOrderExplanationImages((prev) => [...prev, { url: publicUrl, title: null }]);
      toast.success("訂單說明圖已上傳");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "訂單說明圖上傳失敗");
    } finally {
      setUploadingImageItemId(null);
    }
  }

  function clearOrderImageAtIndex(index: number) {
    setOrderExplanationImages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOrderImageTitle(index: number, title: string) {
    setOrderExplanationImages((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, title: title.trim() || null } : it
      )
    );
  }

  function updateItem(id: string, patch: Partial<OrderItemInput>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function addItem() {
    setItems((prev) => [
      {
        id: `item-${Date.now()}`,
        variant_id: "",
        quantity: 1,
        unit_price: 0,
        custom_notes: "",
        kind: "variant",
        wood_type: null,
      },
      ...prev,
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
        order_number: initialOrder?.order_number ?? draftOrderNumber,
        customer_id: customerId,
        order_date: orderDate || null,
        expected_delivery_date: expectedDate || null,
        status,
        payment_status: paymentStatus,
        // 總金額以折扣後總價為主，若未輸入則回退為品項總金額
        total_amount: grandTotal,
        deposit_amount: Number(deposit) || 0,
        shipping_fee: shippingFeeAmount,
        shipping_address: shippingAddress || null,
        shipping_contact_name: shippingContactName.trim() || null,
        shipping_contact_phone: shippingContactPhone.trim() || null,
        shipping_has_elevator: shippingHasElevator,
        internal_notes: internalNotes || null,
        explanation_image_url:
          orderExplanationImages.length > 0
            ? JSON.stringify(
                orderExplanationImages.map((img) => ({
                  url: img.url,
                  title: img.title ?? null,
                }))
              )
            : null,
      };

      const hasOrderId =
        initialOrder?.id != null && String(initialOrder.id).trim() !== "";
      let orderId = hasOrderId ? initialOrder!.id : null;

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

      const itemsPayload = validItems.map((it) => {
        // 若為規格品且尚未指定 custom_category，依 series 對應的 product_series.category 自動帶入
        let resolvedCategory = it.custom_category ?? null;
        if (it.kind === "variant" && !resolvedCategory && it.series_id) {
          const vo = variants.find((v) => v.id === it.variant_id);
          if (vo?.series_category) {
            resolvedCategory = vo.series_category;
          }
        }

        return {
          order_id: orderId,
          variant_id: it.kind === "variant" ? it.variant_id || null : null,
          quantity: it.quantity,
          unit_price: it.unit_price,
          custom_notes: it.custom_notes || null,
          custom_category:
            it.kind === "custom" ? it.custom_category || null : resolvedCategory,
          custom_name: it.kind === "custom" ? it.custom_name || null : null,
          custom_description:
            it.kind === "custom" ? it.custom_description || null : null,
          custom_dimension_w:
            it.custom_dimension_w != null ? it.custom_dimension_w : null,
          custom_dimension_d:
            it.custom_dimension_d != null ? it.custom_dimension_d : null,
          custom_dimension_h:
            it.custom_dimension_h != null ? it.custom_dimension_h : null,
          image_url: it.image_url ?? null,
          wood_type: it.wood_type ?? null,
        };
      });

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
      // 使用者希望修改訂單後整個畫面重新整理，確保列表與相關檢視都反映最新資料
      if (typeof window !== "undefined") {
        window.location.reload();
      }
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
              <datalist id={WOOD_TYPE_DATALIST_ID}>
                {WOOD_TYPE_OPTIONS.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    訂單主檔
                  </h3>
                  {draftOrderNumber && (
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      訂單編號：{" "}
                      <span className="font-mono text-foreground">
                        {draftOrderNumber}
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="order-customer"
                      className="text-xs text-muted-foreground"
                    >
                      客戶 *
                    </label>
                    <div className="flex items-center gap-2">
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
                        className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        required
                      >
                        <option value="">請選擇客戶</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0 px-2 text-xs"
                        onClick={() => setAddCustomerOpen(true)}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        新增客戶
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0 px-2 text-xs"
                        onClick={() => {
                          if (!customerId) return;
                          setEditCustomerOpen(true);
                        }}
                        disabled={!customerId}
                      >
                        編輯客戶
                      </Button>
                    </div>
                    <AddCustomerDialog
                      channels={[]}
                      open={addCustomerOpen}
                      onOpenChange={setAddCustomerOpen}
                      onSuccess={async () => {
                        await onRefreshCustomers();
                      }}
                    />
                    <AddCustomerDialog
                      channels={[]}
                      open={editCustomerOpen}
                      onOpenChange={setEditCustomerOpen}
                      customerId={customerId || null}
                      onSuccess={async () => {
                        await onRefreshCustomers();
                      }}
                    />
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
                  <div className="flex flex-col gap-3 h-full sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        寄送資訊
                      </h4>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={applyShippingFromCustomer}
                        disabled={!customerId}
                      >
                        帶入客戶資料
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="order-ship-contact"
                          className="text-xs text-muted-foreground"
                        >
                          聯絡人
                        </label>
                        <input
                          id="order-ship-contact"
                          type="text"
                          value={shippingContactName}
                          onChange={(e) => setShippingContactName(e.target.value)}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="收貨聯絡人"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="order-ship-phone"
                          className="text-xs text-muted-foreground"
                        >
                          聯絡電話
                        </label>
                        <input
                          id="order-ship-phone"
                          type="text"
                          value={shippingContactPhone}
                          onChange={(e) => setShippingContactPhone(e.target.value)}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="手機或市話"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="order-ship-elevator"
                          className="text-xs text-muted-foreground"
                        >
                          有無電梯
                        </label>
                        <select
                          id="order-ship-elevator"
                          value={
                            shippingHasElevator === null
                              ? ""
                              : shippingHasElevator
                              ? "yes"
                              : "no"
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") setShippingHasElevator(null);
                            else if (v === "yes") setShippingHasElevator(true);
                            else setShippingHasElevator(false);
                          }}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">未填</option>
                          <option value="yes">有電梯</option>
                          <option value="no">無電梯</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="order-shipping"
                          className="text-xs text-muted-foreground"
                        >
                          送貨地址
                        </label>
                      </div>
                      <textarea
                        id="order-shipping"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                        className="min-h-[72px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="送貨地址；選客戶時可自動帶入預設地址，亦可按「帶入客戶資料」一次帶入聯絡人／電話／地址／電梯。"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 h-full sm:col-span-2">
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
                      className="min-h-[60px] h-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      訂單說明圖（用於列印，建議放訂製品尺寸／圖樣示意，可多張）
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3 sm:flex-wrap">
                      {orderExplanationImages.length > 0 ? (
                        orderExplanationImages.map((img, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <img
                              src={img.url}
                              alt={`訂單說明圖 ${idx + 1}`}
                              className="h-32 w-32 rounded-md border border-border object-cover"
                            />
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => clearOrderImageAtIndex(idx)}
                                  disabled={uploadingImageItemId === "order"}
                                >
                                  移除
                                </Button>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label
                                  className="text-[11px] text-muted-foreground"
                                  htmlFor={`order-explain-title-${idx}`}
                                >
                                  圖片標題（選填）
                                </label>
                                <input
                                  id={`order-explain-title-${idx}`}
                                  type="text"
                                  value={img.title ?? ""}
                                  onChange={(e) => updateOrderImageTitle(idx, e.target.value)}
                                  placeholder={`訂單說明圖 ${idx + 1}`}
                                  className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          尚未上傳訂單說明圖。
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-xs">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                void handleOrderImageUpload(file);
                              }
                              e.target.value = "";
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            disabled={uploadingImageItemId === "order"}
                            onClick={(e) => {
                              const input = (e.currentTarget
                                .previousSibling as HTMLInputElement | null);
                              if (input) {
                                input.click();
                              }
                            }}
                          >
                            {uploadingImageItemId === "order" ? (
                              <>
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                上傳中…
                              </>
                            ) : (
                              <>
                                <ImageIcon className="mr-1 h-3 w-3" />
                                上傳訂單說明圖
                              </>
                            )}
                          </Button>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    品項明細
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
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
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
                            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
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
                                  const wt = selected?.wood_type?.trim();
                                  const dimW = selected?.dimension_w ?? null;
                                  const dimD = selected?.dimension_d ?? null;
                                  const dimH = selected?.dimension_h ?? null;
                                  updateItem(it.id, {
                                    variant_id: value,
                                    series_id: selected?.series_id ?? it.series_id ?? null,
                                    unit_price:
                                      selected?.base_price ??
                                      it.unit_price ??
                                      0,
                                    wood_type: wt ? wt : null,
                                    custom_dimension_w: dimW,
                                    custom_dimension_d: dimD,
                                    custom_dimension_h: dimH,
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
                              {variants.find((v) => v.id === it.variant_id) && (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {(() => {
                                    const v = variants.find((vv) => vv.id === it.variant_id)!;
                                    return v.series_name
                                      ? `${v.series_name} / ${v.label}`
                                      : v.label;
                                  })()}
                                </p>
                              )}
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
                            <div className="flex flex-col gap-1.5 sm:col-span-1">
                              <span className="text-xs text-muted-foreground">
                                通路價格
                              </span>
                              {(() => {
                                const customer = customers.find((c) => c.id === customerId);
                                const channelId = customer?.channel_id ?? null;
                                const seriesId = it.series_id ?? null;
                                let channelPrice: number | null = null;
                                if (channelId && seriesId) {
                                  const discounts = seriesDiscounts[seriesId] ?? [];
                                  const row = discounts.find((d) => d.channel_id === channelId);
                                  const pct = row?.discount_percent ?? 0;
                                  const variant = variants.find((v) => v.id === it.variant_id);
                                  const base = variant?.base_price ?? null;
                                  if (base != null && Number.isFinite(base) && pct > 0) {
                                    channelPrice = Math.round(base * (1 - pct / 100));
                                  }
                                }
                                return (
                                  <div className="h-9 flex items-center justify-end rounded-lg border border-dashed border-border bg-muted/40 px-3 text-xs tabular-nums text-muted-foreground">
                                    {channelPrice != null ? channelPrice.toLocaleString() : "—"}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-wood-variant-${it.id}`}
                              >
                                木種
                              </label>
                              <WoodTypeComboboxInput
                                id={`item-wood-variant-${it.id}`}
                                value={it.wood_type ?? ""}
                                onChange={(v) =>
                                  updateItem(it.id, {
                                    wood_type: v.trim() || null,
                                  })
                                }
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                長
                              </label>
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
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                寬
                              </label>
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
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                高
                              </label>
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
                              placeholder={'客製品名稱：\n尺寸：\n材料：\n客製化說明：'}
                              className="min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              圖片（用於列印）
                            </span>
                            <div className="flex items-center gap-3">
                              {it.image_url ? (
                                <div className="flex items-center gap-2">
                                  <img
                                    src={it.image_url}
                                    alt="品項圖片預覽"
                                    className="h-12 w-12 rounded-md border border-border object-cover"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => clearItemImage(it.id)}
                                  >
                                    移除圖片
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  尚未上傳圖片
                                </span>
                              )}
                              <label className="inline-flex items-center gap-1.5">
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      void handleItemImageUpload(it.id, file);
                                    }
                                    e.target.value = "";
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  disabled={uploadingImageItemId === it.id}
                                  onClick={(e) => {
                                    const input = (e.currentTarget
                                      .previousSibling as HTMLInputElement | null);
                                    if (input) {
                                      input.click();
                                    }
                                  }}
                                >
                                  {uploadingImageItemId === it.id ? (
                                    <>
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      上傳中…
                                    </>
                                  ) : (
                                    <>
                                      <ImageIcon className="mr-1 h-3 w-3" />
                                      上傳圖片
                                    </>
                                  )}
                                </Button>
                              </label>
                            </div>
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
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mt-1.5">
                            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-wood-custom-${it.id}`}
                              >
                                木種
                              </label>
                              <WoodTypeComboboxInput
                                id={`item-wood-custom-${it.id}`}
                                value={it.wood_type ?? ""}
                                onChange={(v) =>
                                  updateItem(it.id, {
                                    wood_type: v.trim() || null,
                                  })
                                }
                              />
                            </div>
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
                              placeholder={'客製品名稱：\n尺寸：\n材料：\n客製化說明：'}
                              className="min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              圖片（用於列印）
                            </span>
                            <div className="flex items-center gap-3">
                              {it.image_url ? (
                                <div className="flex items-center gap-2">
                                  <img
                                    src={it.image_url}
                                    alt="品項圖片預覽"
                                    className="h-12 w-12 rounded-md border border-border object-cover"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => clearItemImage(it.id)}
                                  >
                                    移除圖片
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  尚未上傳圖片
                                </span>
                              )}
                              <label className="inline-flex items-center gap-1.5">
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      void handleItemImageUpload(it.id, file);
                                    }
                                    e.target.value = "";
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  disabled={uploadingImageItemId === it.id}
                                  onClick={(e) => {
                                    const input = (e.currentTarget
                                      .previousSibling as HTMLInputElement | null);
                                    if (input) {
                                      input.click();
                                    }
                                  }}
                                >
                                  {uploadingImageItemId === it.id ? (
                                    <>
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      上傳中…
                                    </>
                                  ) : (
                                    <>
                                      <ImageIcon className="mr-1 h-3 w-3" />
                                      上傳圖片
                                    </>
                                  )}
                                </Button>
                              </label>
                            </div>
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
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    金額摘要
                  </p>
                  <p className="text-[11px] text-muted-foreground">單位：NTD</p>
                </div>

                <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/40 bg-background px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">品項總計</p>
                    <p className="mt-1 text-right text-lg font-semibold tabular-nums text-foreground">
                      {totalAmount.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">應收總額（含運費總額）</p>
                    <p className="mt-1 text-right text-lg font-semibold tabular-nums text-foreground">
                      {grandTotal.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                    <p className="text-[11px] text-emerald-700">尾款金額</p>
                    <p className="mt-1 text-right text-lg font-semibold tabular-nums text-emerald-700">
                      {Math.max(
                        grandTotal - (Number(deposit) || 0),
                        0
                      ).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">折扣後總金額</span>
                    <input
                      type="number"
                      min={0}
                      value={discountTotal}
                      onChange={(e) => {
                        setDiscountLocked(true);
                        setDiscountTotal(e.target.value);
                        const v = Number(e.target.value);
                        const p = Number(depositPercent);
                        if (p > 0 && Number.isFinite(v) && v > 0) {
                          const amt = Math.round((v * p) / 100);
                          setDeposit(String(amt));
                        }
                      }}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={totalAmount > 0 ? String(totalAmount) : "0"}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">運費</span>
                    <input
                      id="order-shipping-fee"
                      type="number"
                      min={0}
                      value={shippingFee}
                      onChange={(e) => setShippingFee(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">訂金比例</span>
                    <select
                      value={depositPercent}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDepositPercent(v);
                        const p = Number(v);
                        if (p > 0 && discountBase > 0) {
                          const amt = Math.round((discountBase * p) / 100);
                          setDeposit(String(amt));
                        }
                      }}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">自訂</option>
                      <option value="30">30%</option>
                      <option value="40">40%</option>
                      <option value="50">50%</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">預收訂金（計算訂金不含運費）</span>
                    <input
                      id="order-deposit"
                      type="number"
                      min={0}
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
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

type StatusFilterValue = OrderStatus | "全部" | "非報價中";

const STATUS_FILTER_OPTIONS: StatusFilterValue[] = [
  "全部",
  "報價中",
  "非報價中",
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
  const hasAppliedInitialOpenRef = useRef(false);

  async function fetchCustomers() {
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name, contact_person, phone, delivery_address, has_elevator, channel_id")
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
        .select("id, series_name, category")
        .order("id", { ascending: true });
      const seriesNameMap = new Map<string, string>();
      const seriesCategoryMap = new Map<string, string | null>();
      (seriesData ?? []).forEach((s: any) => {
        const name = s.series_name ?? "";
        const cat =
          typeof s.category === "string" && s.category.trim()
            ? String(s.category)
            : null;
        const id = String(s.id);
        seriesNameMap.set(id, String(name));
        seriesCategoryMap.set(id, cat);
      });

      // 產品規格選單（含 series_id）
      const { data: variantData } = await supabase
        .from("product_variants")
        .select(
          "id, series_id, product_code, wood_type, dimension_w, dimension_d, dimension_h, base_price, spec1"
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
          const seriesName = seriesNameMap.get(seriesId) ?? "";
          const labelParts = [
            v.product_code ?? "",
            v.wood_type ?? "",
            v.spec1 ?? "",
            dim,
          ].filter((s: string) => s && s.trim());
          return {
            id: String(v.id),
            series_id: seriesId,
            series_name: seriesName,
            series_category: seriesCategoryMap.get(seriesId) ?? null,
            label: labelParts.join(" / "),
            base_price:
              v.base_price !== undefined && v.base_price !== null
                ? Number(v.base_price)
                : null,
            spec1: v.spec1 ?? null,
            wood_type: v.wood_type ?? null,
            dimension_w: v.dimension_w != null ? Number(v.dimension_w) : null,
            dimension_d: v.dimension_d != null ? Number(v.dimension_d) : null,
            dimension_h: v.dimension_h != null ? Number(v.dimension_h) : null,
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

  // 若外部有指定要打開的訂單（例如從生產看板點過來），在首次載入完訂單列表後自動開啟編輯窗格
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

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "全部"
          ? true
          : statusFilter === "非報價中"
          ? o.status !== "報價中"
          : o.status === statusFilter;
      const matchMonth =
        !monthFilter || !o.order_date
          ? !monthFilter
          : o.order_date.slice(0, 7) === monthFilter;
      return matchSearch && matchStatus && matchMonth;
    });
  }, [orders, search, statusFilter, monthFilter]);

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
      // 預設排序：已結清放底部，其餘依下單日新到舊
      if (sortKey === "order_date" && sortDir === "desc") {
        const aSettled = a.payment_status === "已結清";
        const bSettled = b.payment_status === "已結清";
        if (aSettled !== bSettled) return aSettled ? 1 : -1;
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

  async function handleEdit(order: OrderRow) {
    // 讀取該訂單的明細
    const { data, error } = await supabase
      .from("order_items")
      .select(
        `
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
        product_variants (
          series_id,
          dimension_w,
          dimension_d,
          dimension_h
        )
      `
      )
      .eq("order_id", order.id);
    if (error) {
      toast.error(error.message || "讀取訂單明細失敗");
      return;
    }
    const items: OrderItemInput[] = ((data ?? []) as any[]).map((d, idx) => {
      const isCustom = !d.variant_id;
      const pv = d.product_variants as
        | { series_id?: string | null; dimension_w?: number | null; dimension_d?: number | null; dimension_h?: number | null }
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

      return {
        id: d.id ? String(d.id) : `item-${idx}`,
        variant_id: d.variant_id ? String(d.variant_id) : "",
        // 從關聯的 product_variants 帶回系列，讓「系列」下拉在編輯時能維持原本選擇
        series_id:
          pv && pv.series_id != null
            ? String(pv.series_id)
            : undefined,
        quantity: Number(d.quantity ?? 1),
        unit_price: Number(d.unit_price ?? 0),
        custom_notes: d.custom_notes ?? "",
        kind: isCustom ? "custom" : "variant",
        custom_category: d.custom_category ?? null,
        custom_name: d.custom_name ?? null,
        custom_description: d.custom_description ?? null,
        custom_dimension_w: dimW,
        custom_dimension_d: dimD,
        custom_dimension_h: dimH,
        image_url: d.image_url ?? null,
        wood_type: d.wood_type != null && String(d.wood_type).trim() !== "" ? String(d.wood_type) : null,
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
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
            {statusFilter === "全部"
              ? "狀態：全部"
              : statusFilter === "非報價中"
              ? "狀態：非報價中"
              : `狀態：${statusFilter}`}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-foreground">
              篩選結果總金額：
              <span className="font-semibold ml-1">
                {filteredTotalAmount.toLocaleString()}
              </span>
            </span>
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

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors">
                <OrderSortHeader label="訂單編號" sortKey="order_number" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("order_date")}
                title="點擊排序"
              >
                <OrderSortHeader label="下單日" sortKey="order_date" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("customer_name")}
                title="點擊排序"
              >
                <OrderSortHeader label="客戶姓名" sortKey="customer_name" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("shipping_contact_name")}
                title="點擊排序"
              >
                <OrderSortHeader label="聯絡人" sortKey="shipping_contact_name" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell whitespace-nowrap cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("expected_delivery_date")}
                title="點擊排序"
              >
                <OrderSortHeader label="交期" sortKey="expected_delivery_date" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("status")}
                title="點擊排序"
              >
                <OrderSortHeader label="訂單狀態" sortKey="status" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("payment_status")}
                title="點擊排序"
              >
                <OrderSortHeader label="付款狀態" sortKey="payment_status" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell text-right cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("deposit_amount")}
                title="點擊排序"
              >
                <OrderSortHeader label="訂金" sortKey="deposit_amount" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold text-right cursor-pointer select-none hover:bg-muted/50 transition-colors"
                onClick={() => toggleOrderSort("total_amount")}
                title="點擊排序"
              >
                <OrderSortHeader label="總金額" sortKey="total_amount" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold text-right w-[1%] whitespace-nowrap"
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
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  查無符合條件的訂單
                </TableCell>
              </TableRow>
            ) : (
              sortedOrders.map((order) => (
                <TableRow
                  key={order.id}
                  className="group cursor-pointer"
                  onClick={() => handleEdit(order)}
                >
                  <TableCell className="text-sm font-mono text-primary">
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded px-1 py-0.5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleEdit(order);
                      }}
                    >
                      {order.order_number}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {order.order_date ? order.order_date.replace(/-/g, "/") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(order);
                      }}
                      className="text-left font-medium text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                    >
                      {order.customer_name || "—"}
                      {order.customer_alias && order.customer_alias.trim() && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({order.customer_alias})
                        </span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    {order.shipping_contact_name?.trim() || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    {order.expected_delivery_date
                      ? order.expected_delivery_date.replace(/-/g, "/")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <div
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs ${statusStyles[order.status] ?? ""}`}
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
                        {ORDER_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <div
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs ${paymentStatusStyles[order.payment_status] ?? ""}`}
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
                  </TableCell>
                  <TableCell className="text-right text-sm hidden sm:table-cell">
                    {order.deposit_amount
                      ? order.deposit_amount.toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {order.total_amount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right p-1">
                    <div className="flex justify-end gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="編輯"
                        onClick={() => handleEdit(order)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="刪除"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(order); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
        key={editingOrder?.id ?? "new-order"}
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

