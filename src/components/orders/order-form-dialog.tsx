"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_WORK_ORDER_STAGE,
  isOrderStatusLockedForManualEdit,
  normalizeWorkOrderStage,
  plannedEndDateFromOrderDelivery,
  syncWorkOrdersToOrderStatus,
  WORK_ORDER_STAGES,
  type WorkOrderStage,
} from "@/lib/work-order-stages";
import { DEFAULT_SEAT_HEIGHT_CM } from "@/lib/product-seat-height";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { AddCustomerDialog } from "@/components/crm/add-customer-dialog";
import Link from "next/link";
import {
  Plus,
  Image as ImageIcon,
  Loader2,
  UserPlus,
  Printer,
  Pencil,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import type {
  OrderFormProps,
  OrderStatus,
  PaymentStatus,
  OrderItemInput,
  EmployeeOption,
  ExplanationImage,
} from "./types";
import {
  orderDiscountSubtotalField,
  generateOrderNumber,
  parseExplanationImages,
  manualOrderStatusOptions,
  PAYMENT_STATUS_OPTIONS,
} from "./order-helpers";

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

const WOOD_TYPE_OPTIONS = ["白橡木", "胡桃木", "柚木", "雞翅木"] as const;
const WOOD_TYPE_DATALIST_ID = "order-form-wood-type-list";

function WoodTypeComboboxInput({
  id,
  value,
  onChange,
  readOnly = false,
  placeholder = "選擇或輸入木種",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      list={readOnly ? undefined : WOOD_TYPE_DATALIST_ID}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      placeholder={placeholder}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
      autoComplete="off"
    />
  );
}

function OrderFormDialog({
  open,
  onOpenChange,
  customers,
  variants,
  initialOrder,
  initialItems,
  readOnly = false,
  onSaved,
  onRefreshCustomers,
}: OrderFormProps) {
  const isEdit = Boolean(initialOrder);
  /** 依「已儲存」訂單狀態鎖定；未儲存前可從繪圖改回，避免誤選生產中後無法復原 */
  const savedOrderStatusLocked =
    isEdit &&
    initialOrder != null &&
    isOrderStatusLockedForManualEdit(initialOrder.status);
  /** 結案檢視：勿用 fieldset disabled（會讓 select 無法展開閱讀），改以唯讀欄位呈現 */
  const viewFieldClass =
    "flex min-h-10 w-full items-center rounded-lg border border-[#625E55]/25 bg-[#FAF9F6] px-3 py-2 text-sm text-[#625E55] [overflow-wrap:anywhere]";
  /** Warm Ivory Ledger：表單輸入共用樣式 */
  const ledgerIn =
    "h-10 w-full max-w-full rounded-lg border border-[#625E55]/28 bg-white px-3 text-sm text-[#625E55] outline-none transition placeholder:text-[#7D7767]/55 focus:border-[#625E55] focus:ring-2 focus:ring-[#625E55]/30 read-only:bg-[#FAF9F6] read-only:cursor-default";
  const ledgerSelect =
    "h-10 w-full max-w-full rounded-lg border border-[#625E55]/28 bg-white px-3 text-sm text-[#625E55] outline-none focus:border-[#625E55] focus:ring-2 focus:ring-[#625E55]/30";
  const ledgerTa =
    "min-h-[72px] w-full rounded-lg border border-[#625E55]/28 bg-white px-3 py-2 text-sm text-[#625E55] outline-none transition placeholder:text-[#7D7767]/55 focus:border-[#625E55] focus:ring-2 focus:ring-[#625E55]/30 read-only:bg-[#FAF9F6] read-only:cursor-default";
  const ledgerCard =
    "rounded-lg border border-[#625E55]/22 bg-white p-4 shadow-[0_2px_10px_rgba(98,94,85,0.07)]";
  const ledgerLabel =
    "text-[11px] font-medium uppercase tracking-[0.06em] text-[#7D7767]";
  const ledgerLabelZh = "text-xs text-[#7D7767]";
  const [saving, setSaving] = useState(false);
  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const [customerId, setCustomerId] = useState<string>(
    initialOrder?.customer_id ?? ""
  );
  const [orderDate, setOrderDate] = useState<string>(
    initialOrder?.order_date ?? todayLocal
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
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
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
            channel_unit_price: null,
            custom_notes: "",
            kind: "variant",
            wood_type: null,
            seat_height_cm: null,
            work_order_stage: DEFAULT_WORK_ORDER_STAGE,
            work_order_assignee_id: null,
            work_order_planned_end_date: null,
          },
        ]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadEmployees() {
      const { data } = await supabase
        .from("employees")
        .select("id, name")
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (!cancelled) {
        setEmployees(
          ((data ?? []) as { id: string; name?: string }[]).map((e) => ({
            id: String(e.id),
            name: String(e.name ?? ""),
          }))
        );
      }
    }
    void loadEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setOrderDate(initialOrder.order_date ?? todayLocal);
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
  }, [initialOrder, initialItems, todayLocal]);

  // 每次以「新增模式」打開時，重置表單為空白狀態
  useEffect(() => {
    if (!open || initialOrder) return;
    setCustomerId("");
    setOrderDate(todayLocal);
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
        channel_unit_price: null,
        custom_notes: "",
        kind: "variant",
        wood_type: null,
        seat_height_cm: null,
        work_order_stage: DEFAULT_WORK_ORDER_STAGE,
        work_order_assignee_id: null,
        work_order_planned_end_date: null,
      },
    ]);
    prevTotalAmountRef.current = null;
  }, [open, initialOrder, todayLocal]);

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

  /**
   * 計算指定品項在目前客戶下的「通路成交價」。
   * 客戶有所屬通路且該系列設定折扣 % 時，回傳 base_price * (1 - pct/100)，否則回傳 null。
   */
  const resolveChannelUnitPrice = useCallback(
    (variantId: string | null | undefined, seriesId: string | null | undefined): number | null => {
      if (!variantId) return null;
      const variant = variants.find((v) => v.id === variantId);
      const base = variant?.base_price ?? null;
      if (base == null || !Number.isFinite(Number(base))) return null;

      const customer = customers.find((c) => c.id === customerId);
      const channelId = customer?.channel_id ?? null;
      const sid = seriesId ?? variant?.series_id ?? null;
      if (!channelId || !sid) return null;

      const discounts = seriesDiscounts[sid] ?? [];
      const row = discounts.find((d) => d.channel_id === channelId);
      const pct = row?.discount_percent ?? 0;
      if (!(pct > 0)) return null;

      return Math.round(Number(base) * (1 - pct / 100));
    },
    [variants, customers, customerId, seriesDiscounts]
  );

  /** 產品規格牌價（base_price）；明細 unit_price 一律以此為準 */
  const resolveListUnitPrice = useCallback(
    (variantId: string | null | undefined): number => {
      if (!variantId) return 0;
      const variant = variants.find((v) => v.id === variantId);
      const base = variant?.base_price;
      return base != null && Number.isFinite(Number(base)) ? Number(base) : 0;
    },
    [variants]
  );

  function handleVariantSelect(it: OrderItemInput, variantId: string) {
    if (variantId === it.variant_id) return;
    const selected = variants.find((v) => v.id === variantId);
    const wt = selected?.wood_type?.trim();
    const dimW = selected?.dimension_w ?? null;
    const dimD = selected?.dimension_d ?? null;
    const dimH = selected?.dimension_h ?? null;
    const seatResolved =
      selected?.seat_height_cm != null
        ? Number(selected.seat_height_cm)
        : selected?.series_category === "椅" || selected?.series_category === "凳"
          ? DEFAULT_SEAT_HEIGHT_CM
          : null;
    const nextUnitPrice = resolveListUnitPrice(variantId);
    updateItem(it.id, {
      variant_id: variantId,
      series_id: selected?.series_id ?? it.series_id ?? null,
      unit_price: nextUnitPrice,
      wood_type: wt ? wt : null,
      custom_dimension_w: dimW,
      custom_dimension_d: dimD,
      custom_dimension_h: dimH,
      seat_height_cm: seatResolved,
    });
  }

  /** 規格品項牌價由產品主檔帶入，不可手動改價 */
  function isVariantUnitPriceLocked(it: OrderItemInput): boolean {
    return it.kind === "variant" && Boolean(it.variant_id);
  }

  /**
   * 結算單價：有通路價格優先採用通路價格，否則採用牌價（unit_price）。
   * 用於品項小計、訂單合計等結算用途；與明細欄位「牌價」分開。
   */
  const resolveItemSettlementPrice = useCallback(
    (it: OrderItemInput): number => {
      if (it.kind === "custom") {
        const manualChannel = it.channel_unit_price;
        if (
          manualChannel != null &&
          Number.isFinite(Number(manualChannel)) &&
          Number(manualChannel) > 0
        ) {
          return Number(manualChannel);
        }
        return Number(it.unit_price) || 0;
      }
      const channelPrice = resolveChannelUnitPrice(it.variant_id, it.series_id ?? null);
      if (channelPrice != null) return channelPrice;
      if (it.variant_id) {
        return resolveListUnitPrice(it.variant_id) || Number(it.unit_price) || 0;
      }
      return Number(it.unit_price) || 0;
    },
    [resolveChannelUnitPrice, resolveListUnitPrice]
  );


  function itemLedgerSummary(it: OrderItemInput): {
    code: string;
    title: string;
    thumb: string | null;
  } {
    if (it.kind === "variant" && it.variant_id) {
      const v = variants.find((x) => x.id === it.variant_id);
      const code = v?.label?.split(/\s+/)[0]?.slice(0, 24) ?? "—";
      const title = v
        ? v.series_name
          ? `${v.series_name} · ${v.label}`
          : v.label
        : "—";
      return { code, title, thumb: it.image_url ?? null };
    }
    return {
      code: it.custom_category?.trim() || "客製",
      title:
        it.custom_name?.trim() ||
        it.custom_description?.trim() ||
        "客製品項",
      thumb: it.image_url ?? null,
    };
  }

  // 每項小計：通路價格優先（有設定折扣 % 時）、其次採用牌價
  const itemSubtotals = itemRows.map(
    (it) => (Number(it.quantity) || 0) * resolveItemSettlementPrice(it)
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

  /** 依訂金比例與折扣後底額計算訂金試算；不會自動寫入預收訂金，須按「帶入訂金」 */
  const trialDepositAmount = useMemo(() => {
    const p = Number(depositPercent);
    if (depositPercent === "" || !Number.isFinite(p) || p <= 0) return null;
    if (discountBase <= 0) return null;
    return Math.round((discountBase * p) / 100);
  }, [depositPercent, discountBase]);

  // 品項總額變動 → 同步「折扣後總金額」（單一 effect，避免與載入 effect 競態）
  // - 未鎖定（新增或尚未手改折扣）：直接等於品項總計
  // - 已鎖定：初次僅記錄品項總計；之後品項有增刪變動則本欄回歸品項總計（不再保留手動折讓差）
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

    prevTotalAmountRef.current = totalAmount;
    const nextBase = Math.max(0, totalAmount);
    setDiscountTotal(nextBase > 0 ? String(nextBase) : "");
  }, [totalAmount, discountLocked]);

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
        channel_unit_price: null,
        custom_notes: "",
        kind: "variant",
        wood_type: null,
        seat_height_cm: null,
        isNewLine: isEdit,
        work_order_stage: DEFAULT_WORK_ORDER_STAGE,
        work_order_assignee_id: null,
        work_order_planned_end_date: null,
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

  function moveItem(id: string, direction: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const next = idx + direction;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
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
        // 先清空舊明細（連帶刪除工單，再以表單內容重建並保留工序／負責人）
        const { data: existingItems } = await supabase
          .from("order_items")
          .select("id")
          .eq("order_id", orderId);
        const existingIds = (existingItems ?? []).map((x: { id: string }) => x.id);
        if (existingIds.length > 0) {
          await supabase.from("work_orders").delete().in("order_item_id", existingIds);
        }
        await supabase.from("order_items").delete().eq("order_id", orderId);
      }

      const itemsPayload = validItems.map((it, lineIndex) => {
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
          line_order: lineIndex,
          variant_id: it.kind === "variant" ? it.variant_id || null : null,
          quantity: it.quantity,
          unit_price:
            it.kind === "variant" && it.variant_id
              ? resolveListUnitPrice(it.variant_id)
              : it.unit_price,
          channel_unit_price:
            it.kind === "custom" &&
            it.channel_unit_price != null &&
            Number.isFinite(Number(it.channel_unit_price)) &&
            Number(it.channel_unit_price) > 0
              ? Number(it.channel_unit_price)
              : null,
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
          seat_height_cm:
            it.seat_height_cm != null && Number.isFinite(Number(it.seat_height_cm))
              ? Number(it.seat_height_cm)
              : null,
          image_url: it.image_url ?? null,
          wood_type: it.wood_type ?? null,
        };
      });

      let { data: insertedItems, error: itemsError } = await supabase
        .from("order_items")
        .insert(itemsPayload)
        .select("id");
      if (itemsError && /column .* does not exist/i.test(itemsError.message)) {
        const reduced = itemsPayload.map((p) => {
          const row: Record<string, unknown> = { ...p };
          delete row.channel_unit_price;
          return row;
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 漸進刪除欄位以相容舊 schema
        const retry = await supabase.from("order_items").insert(reduced as any).select("id");
        insertedItems = retry.data;
        itemsError = retry.error;
      }
      if (itemsError) {
        toast.error(itemsError.message || "寫入訂單明細失敗");
        return;
      }

      // 依照 order_items 自動建立工單（work_orders）
      const plannedFromDelivery = plannedEndDateFromOrderDelivery(expectedDate);
      const workOrderPayload =
        (insertedItems ?? []).map((row: { id: string }, index: number) => {
          const it = validItems[index];
          const stage = it?.work_order_stage
            ? normalizeWorkOrderStage(it.work_order_stage)
            : DEFAULT_WORK_ORDER_STAGE;
          const plannedEnd =
            it?.work_order_planned_end_date?.trim() || plannedFromDelivery;
          return {
            order_item_id: row.id,
            stage,
            status: "未開始",
            planned_end_date: plannedEnd,
            assignee_id: it?.work_order_assignee_id?.trim() || null,
          };
        }) ?? [];
      if (workOrderPayload.length > 0) {
        const { error: woError } = await supabase
          .from("work_orders")
          .insert(workOrderPayload);
        if (woError) {
          // 不阻擋訂單建立，只提示
          console.error("建立工單失敗:", woError);
          toast.error("訂單已建立，但工單建立失敗，請稍後到生產管理檢查。");
        } else {
          const sync = await syncWorkOrdersToOrderStatus(
            supabase,
            orderId!,
            status,
          );
          if (!sync.ok) {
            console.warn("[orders] 工單與訂單狀態同步失敗:", sync.error);
          }
        }
      }

      toast.success(isEdit ? "已更新訂單" : "已建立訂單");
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const orderPrintHref = useMemo(() => {
    if (!initialOrder?.id) return null;
    return initialOrder.status === "報價中"
      ? `/print/quotation/${initialOrder.id}`
      : `/print/order/${initialOrder.id}`;
  }, [initialOrder]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-0 z-50 flex max-h-[100dvh] flex-col overflow-hidden bg-[#FAF9F6] shadow-xl focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:border-[#625E55]/12"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 border-b border-[#625E55]/12 bg-[#FAF9F6]/95 px-3 py-3 backdrop-blur-sm sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#625E55] hover:bg-[#625E55]/10 focus:outline-none focus:ring-2 focus:ring-[#625E55]/30"
                  aria-label="返回"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              </Dialog.Close>
              <Dialog.Title className="min-w-0 truncate font-[family-name:var(--font-manrope)] text-base font-semibold tracking-tight text-[#625E55]">
                {isEdit ? (readOnly ? "檢視訂單" : "編輯訂單") : "新增訂單"}
              </Dialog.Title>
            </div>
            <details className="relative shrink-0">
              <summary className="flex cursor-pointer list-none items-center justify-center rounded-lg p-2 text-[#625E55] hover:bg-[#625E55]/10 focus:outline-none focus:ring-2 focus:ring-[#625E55]/30 [&::-webkit-details-marker]:hidden">
                <MoreVertical className="h-5 w-5" aria-hidden />
                <span className="sr-only">更多</span>
              </summary>
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-lg border border-[#625E55]/15 bg-white py-1 text-sm shadow-lg">
                {orderPrintHref ? (
                  <Link
                    href={orderPrintHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-[#625E55] hover:bg-[#FAF9F6]"
                    onClick={() => {
                      const el = document.activeElement as HTMLElement | null;
                      el?.blur?.();
                    }}
                  >
                    <Printer className="h-4 w-4 shrink-0" />
                    列印訂單
                  </Link>
                ) : (
                  <p className="px-3 py-2 text-xs text-[#7D7767]">儲存後可列印</p>
                )}
              </div>
            </details>
          </div>
          <Dialog.Description className="sr-only">
            {isEdit
              ? readOnly
                ? "檢視訂單內容與明細"
                : "編輯訂單內容、寄送資訊與品項明細"
              : "建立新訂單"}
          </Dialog.Description>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            {readOnly ? (
              <div className="mx-4 mb-2 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 sm:mx-5">
                已結案之訂單無法修改；請關閉視窗離開。
              </div>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-2 sm:px-5 sm:pb-6">
              <div className="px-0.5">
                <p className={ledgerLabel}>Order reference</p>
                <p className="mt-1 font-[family-name:var(--font-manrope)] text-xl font-semibold tracking-tight text-[#625E55] sm:text-2xl">
                  {draftOrderNumber || "—"}
                </p>
              </div>
              <datalist id={WOOD_TYPE_DATALIST_ID}>
                {WOOD_TYPE_OPTIONS.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
              <section className={`${ledgerCard} space-y-3`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[#625E55]">
                    客戶選擇
                  </h3>
                  {!readOnly ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-lg border-[#625E55]/20 text-[#625E55] hover:bg-[#625E55]/10"
                        onClick={() => {
                          if (!customerId) return;
                          setEditCustomerOpen(true);
                        }}
                        disabled={!customerId}
                        title="編輯客戶"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-lg border-[#625E55]/20 text-[#625E55] hover:bg-[#625E55]/10"
                        onClick={() => setAddCustomerOpen(true)}
                        title="新增客戶"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 flex flex-col gap-1.5">
                  <label htmlFor="order-customer" className={ledgerLabelZh}>
                    客戶 *
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {readOnly ? (
                      <div className={`${viewFieldClass} flex-1`}>
                        {customers.find((c) => c.id === customerId)?.name ?? "—"}
                      </div>
                    ) : (
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
                        className={`${ledgerSelect} min-w-0 flex-1`}
                        required
                      >
                        <option value="">請選擇客戶</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
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
              </section>

              <section className={`${ledgerCard} space-y-3`}>
                <h3 className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[#625E55]">
                  訂單資訊
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="order-date" className={ledgerLabelZh}>
                      下單日期
                    </label>
                    <input
                      id="order-date"
                      type="date"
                      value={orderDate ?? ""}
                      onChange={(e) => setOrderDate(e.target.value)}
                      readOnly={readOnly}
                      className={ledgerIn}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="order-expected" className={ledgerLabelZh}>
                      預計交貨日
                    </label>
                    <input
                      id="order-expected"
                      type="date"
                      value={expectedDate ?? ""}
                      onChange={(e) => setExpectedDate(e.target.value)}
                      readOnly={readOnly}
                      className={ledgerIn}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="order-payment" className={ledgerLabelZh}>
                      付款狀態
                    </label>
                    {readOnly ? (
                      <div id="order-payment" className={viewFieldClass}>
                        {paymentStatus}
                      </div>
                    ) : (
                      <select
                        id="order-payment"
                        value={paymentStatus}
                        onChange={(e) =>
                          setPaymentStatus(e.target.value as PaymentStatus)
                        }
                        className={ledgerSelect}
                      >
                        {PAYMENT_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="order-status" className={ledgerLabelZh}>
                      訂單狀態
                    </label>
                    {readOnly || savedOrderStatusLocked ? (
                      <div className="space-y-1">
                        <div id="order-status" className={viewFieldClass}>
                          {status}
                        </div>
                        {savedOrderStatusLocked && !readOnly ? (
                          <p className="text-[11px] text-[#7D7767] leading-snug">
                            生產中／暫停時請至「生產管理」調整工單工序；全部為「包裝管理」或「待出貨」時將自動改為已完工，全部為「已出貨」時將自動改為已出貨。
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <select
                        id="order-status"
                        value={status}
                        onChange={(e) =>
                          setStatus(e.target.value as OrderStatus)
                        }
                        className={ledgerSelect}
                      >
                        {manualOrderStatusOptions(status).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </section>

                <section className={`${ledgerCard} space-y-3`}>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[#625E55]">
                        寄送資訊
                      </h4>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 rounded-lg border-[#625E55]/25 px-2.5 text-[11px] font-medium uppercase tracking-wide text-[#625E55] hover:bg-[#625E55]/10"
                        onClick={applyShippingFromCustomer}
                        disabled={readOnly || !customerId}
                      >
                        帶入客戶資料
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="order-ship-contact"
                        className={ledgerLabelZh}
                      >
                        聯絡人
                      </label>
                      <input
                        id="order-ship-contact"
                        type="text"
                        value={shippingContactName}
                        onChange={(e) => setShippingContactName(e.target.value)}
                        readOnly={readOnly}
                        className={ledgerIn}
                        placeholder="收貨聯絡人"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="order-ship-phone"
                        className={ledgerLabelZh}
                      >
                        聯絡電話
                      </label>
                      <input
                        id="order-ship-phone"
                        type="text"
                        value={shippingContactPhone}
                        onChange={(e) => setShippingContactPhone(e.target.value)}
                        readOnly={readOnly}
                        className={ledgerIn}
                        placeholder="手機或市話"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="order-shipping"
                        className={ledgerLabelZh}
                      >
                        送貨地址
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                        <textarea
                          id="order-shipping"
                          value={shippingAddress}
                          onChange={(e) => setShippingAddress(e.target.value)}
                          readOnly={readOnly}
                          className={`${ledgerTa} min-h-[80px] min-w-0 flex-1`}
                          placeholder="送貨地址；選客戶時可自動帶入預設地址，亦可按「帶入客戶資料」一次帶入聯絡人／電話／地址／電梯。"
                        />
                        <div className="flex shrink-0 items-start sm:min-w-[5.5rem] sm:pt-1">
                          {readOnly ? (
                            <div
                              id="order-ship-elevator"
                              className={`${viewFieldClass} text-sm`}
                            >
                              {shippingHasElevator === true
                                ? "有電梯"
                                : shippingHasElevator === false
                                  ? "無電梯"
                                  : "未填"}
                            </div>
                          ) : (
                            <label
                              htmlFor="order-ship-elevator"
                              className="flex cursor-pointer items-center gap-2 text-sm text-[#625E55]"
                            >
                              <input
                                id="order-ship-elevator"
                                type="checkbox"
                                checked={shippingHasElevator === true}
                                onChange={(e) =>
                                  setShippingHasElevator(e.target.checked ? true : false)
                                }
                                className="h-4 w-4 rounded border-[#625E55]/30 text-[#625E55] focus:ring-[#625E55]/30"
                              />
                              <span>有電梯</span>
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <section className={`${ledgerCard} space-y-2`}>
                  <label htmlFor="order-notes" className={ledgerLabelZh}>
                    訂單備註
                  </label>
                  <textarea
                    id="order-notes"
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    readOnly={readOnly}
                    className={`${ledgerTa} min-h-[88px]`}
                  />
                </section>
                <div className="grid grid-cols-1 gap-3">
                  <div className={`flex flex-col gap-1.5 rounded-lg border border-dashed border-[#625E55]/25 bg-[#FAF9F6] p-4`}>
                    <span className={`${ledgerLabelZh} font-medium`}>
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
                                  disabled={readOnly || uploadingImageItemId === "order"}
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
                                  readOnly={readOnly}
                                  placeholder={`訂單說明圖 ${idx + 1}`}
                                  className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                      {!readOnly ? (
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
                      ) : null}
                    </div>
                  </div>
                </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[#625E55]">
                    品項明細（{itemRows.length}）
                  </h3>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-[#625E55]/25 px-3 text-xs font-semibold uppercase tracking-wide text-[#625E55] hover:bg-[#625E55]/10"
                      onClick={addItem}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      新增品項
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {itemRows.map((it, idx) => {
                    const summary = itemLedgerSummary(it);
                    return (
                    <div
                      key={it.id}
                      className={`${ledgerCard} space-y-2 p-3 sm:p-4`}
                    >
                      <div className="flex gap-3 border-b border-[#625E55]/10 pb-3">
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[#625E55]/15 bg-[#FAF9F6]">
                          {summary.thumb ? (
                            <img
                              src={summary.thumb}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-[#7D7767]/70">
                              無圖
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-semibold text-[#625E55]">
                            {summary.code}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-sm text-[#625E55]">
                            {summary.title}
                          </p>
                          <p className="mt-1 text-xs tabular-nums text-[#7D7767]">
                            NTD{" "}
                            {(it.kind === "variant" && it.variant_id
                              ? resolveListUnitPrice(it.variant_id)
                              : Number(it.unit_price) || 0
                            ).toLocaleString()}{" "}
                            ×{" "}
                            {it.quantity}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-[#7D7767]">
                          品項 {idx + 1}
                        </p>
                        {!readOnly && itemRows.length > 1 && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title="上移"
                              disabled={idx === 0}
                              onClick={() => moveItem(it.id, -1)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                              aria-label="上移"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={idx === itemRows.length - 1}
                              onClick={() => moveItem(it.id, 1)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                              aria-label="下移"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(it.id)}
                              className="text-[11px] text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-0.5"
                            >
                              移除
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>品項類型：</span>
                          <button
                            type="button"
                            disabled={readOnly}
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
                            } disabled:opacity-50 disabled:pointer-events-none`}
                          >
                            規格庫
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() =>
                              updateItem(it.id, {
                                kind: "custom",
                                variant_id: "",
                                channel_unit_price: null,
                              })
                            }
                            className={`rounded-full px-2 py-0.5 border text-[11px] ${
                              it.kind === "custom"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background"
                            } disabled:opacity-50 disabled:pointer-events-none`}
                          >
                            客製品項
                          </button>
                        </div>
                      </div>

                      {it.kind === "variant" ? (
                        <>
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,9rem)_minmax(0,1.45fr)_minmax(0,5.5rem)_minmax(0,7rem)_minmax(0,7rem)] lg:items-end">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-muted-foreground">
                                系列
                              </label>
                              {readOnly ? (
                                <div className={viewFieldClass}>
                                  {it.series_id
                                    ? seriesOptions.find((s) => s.id === it.series_id)
                                        ?.name ?? "—"
                                    : "全部系列"}
                                </div>
                              ) : (
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
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-variant-${it.id}`}
                              >
                                產品規格 *
                              </label>
                              {readOnly ? (
                                <div className="flex w-full min-w-0 flex-col gap-1.5">
                                  <div
                                    id={`item-variant-${it.id}`}
                                    className={`${viewFieldClass} w-full min-w-0`}
                                  >
                                    {(() => {
                                      const v = variants.find(
                                        (vv) => vv.id === it.variant_id
                                      );
                                      if (!v) return "—";
                                      return v.series_name
                                        ? `${v.series_name} / ${v.label}`
                                        : v.label;
                                    })()}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex w-full min-w-0 flex-col gap-1.5">
                                  <select
                                    id={`item-variant-${it.id}`}
                                    value={it.variant_id}
                                    onChange={(e) =>
                                      handleVariantSelect(it, e.target.value)
                                    }
                                    className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                              )}
                              {!readOnly &&
                                variants.find((v) => v.id === it.variant_id) && (
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
                            <div className="flex flex-col gap-1.5">
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-price-${it.id}`}
                              >
                                牌價
                              </label>
                              <input
                                id={`item-price-${it.id}`}
                                type="number"
                                min={0}
                                value={
                                  it.variant_id
                                    ? resolveListUnitPrice(it.variant_id)
                                    : it.unit_price
                                }
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    unit_price:
                                      Number(e.target.value) || 0,
                                  })
                                }
                                readOnly={readOnly || isVariantUnitPriceLocked(it)}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-xs text-muted-foreground">
                                通路價格
                              </span>
                              {(() => {
                                const channelPrice = resolveChannelUnitPrice(
                                  it.variant_id,
                                  it.series_id ?? null
                                );
                                return (
                                  <div className="h-9 flex items-center justify-end rounded-lg border border-dashed border-border bg-muted/40 px-3 text-xs tabular-nums text-muted-foreground">
                                    {channelPrice != null ? channelPrice.toLocaleString() : "—"}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
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
                                readOnly={readOnly}
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-seat-${it.id}`}
                              >
                                座高（cm）
                              </label>
                              <input
                                id={`item-seat-${it.id}`}
                                type="number"
                                placeholder="cm"
                                value={it.seat_height_cm ?? ""}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    seat_height_cm:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                              readOnly={readOnly}
                              placeholder={'客製品名稱：\n尺寸：\n材料：\n客製化說明：'}
                              className="min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                  {!readOnly ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="h-8 px-2 text-xs"
                                      onClick={() => clearItemImage(it.id)}
                                    >
                                      移除圖片
                                    </Button>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  尚未上傳圖片
                                </span>
                              )}
                              {!readOnly ? (
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
                              ) : null}
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
                              {readOnly ? (
                                <div className={viewFieldClass}>
                                  {it.custom_category?.trim()
                                    ? it.custom_category
                                    : "—"}
                                </div>
                              ) : (
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
                              )}
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                                required={!readOnly}
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
                                  readOnly={readOnly}
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                  readOnly={readOnly}
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                  readOnly={readOnly}
                                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 sm:max-w-[12rem]">
                            <label className="text-xs text-muted-foreground">
                              座高（cm）
                            </label>
                            <input
                              type="number"
                              placeholder="cm"
                              value={it.seat_height_cm ?? ""}
                              onChange={(e) =>
                                updateItem(it.id, {
                                  seat_height_cm:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                              readOnly={readOnly}
                              className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-1.5 lg:items-end">
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-wood-custom-${it.id}`}
                              >
                                木種
                              </label>
                              <WoodTypeComboboxInput
                                id={`item-wood-custom-${it.id}`}
                                value={it.wood_type ?? ""}
                                readOnly={readOnly}
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
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-list-price-custom-${it.id}`}
                              >
                                牌價
                              </label>
                              <input
                                id={`item-list-price-custom-${it.id}`}
                                type="number"
                                min={0}
                                value={it.unit_price}
                                onChange={(e) =>
                                  updateItem(it.id, {
                                    unit_price: Number(e.target.value) || 0,
                                  })
                                }
                                readOnly={readOnly}
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label
                                className="text-xs text-muted-foreground"
                                htmlFor={`item-channel-price-custom-${it.id}`}
                              >
                                通路價格
                              </label>
                              <input
                                id={`item-channel-price-custom-${it.id}`}
                                type="number"
                                min={0}
                                step={1}
                                value={
                                  it.channel_unit_price != null &&
                                  Number.isFinite(Number(it.channel_unit_price)) &&
                                  Number(it.channel_unit_price) > 0
                                    ? it.channel_unit_price
                                    : ""
                                }
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updateItem(it.id, {
                                    channel_unit_price:
                                      raw === "" ? null : Math.max(0, Number(raw) || 0),
                                  });
                                }}
                                readOnly={readOnly}
                                placeholder="選填"
                                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                有填通路價時，小計與訂單總額依通路價計算。
                              </p>
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
                              readOnly={readOnly}
                              placeholder={'客製品名稱：\n尺寸：\n材料：\n客製化說明：'}
                              className="min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default"
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
                                  {!readOnly ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="h-8 px-2 text-xs"
                                      onClick={() => clearItemImage(it.id)}
                                    >
                                      移除圖片
                                    </Button>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  尚未上傳圖片
                                </span>
                              )}
                              {!readOnly ? (
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
                              ) : null}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="grid grid-cols-1 gap-3 border-t border-[#625E55]/10 pt-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label
                            className="text-xs text-muted-foreground"
                            htmlFor={`item-stage-${it.id}`}
                          >
                            工序
                          </label>
                          {readOnly ? (
                            <div className={viewFieldClass}>
                              {it.work_order_stage ?? DEFAULT_WORK_ORDER_STAGE}
                            </div>
                          ) : (
                            <select
                              id={`item-stage-${it.id}`}
                              value={it.work_order_stage ?? DEFAULT_WORK_ORDER_STAGE}
                              onChange={(e) =>
                                updateItem(it.id, {
                                  work_order_stage: e.target.value as WorkOrderStage,
                                })
                              }
                              className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              {WORK_ORDER_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label
                            className="text-xs text-muted-foreground"
                            htmlFor={`item-assignee-${it.id}`}
                          >
                            負責人
                          </label>
                          {readOnly ? (
                            <div className={viewFieldClass}>
                              {it.work_order_assignee_id
                                ? employees.find((e) => e.id === it.work_order_assignee_id)
                                    ?.name ?? "—"
                                : "未指派"}
                            </div>
                          ) : (
                            <select
                              id={`item-assignee-${it.id}`}
                              value={it.work_order_assignee_id ?? ""}
                              onChange={(e) =>
                                updateItem(it.id, {
                                  work_order_assignee_id: e.target.value || null,
                                })
                              }
                              className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              <option value="">未指派</option>
                              {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#7D7767] text-right">
                        小計：{" "}
                        <span className="font-semibold text-[#625E55]">
                          {itemSubtotals[idx].toLocaleString()}
                        </span>
                      </p>
                    </div>
                  );
                  })}
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

                <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,9.5rem)_minmax(0,7.5rem)_minmax(0,1fr)_minmax(0,11rem)] lg:items-end lg:gap-x-3">
                  <label className="flex flex-col gap-1.5 min-w-0 max-w-[9.5rem]">
                    <span className="text-xs text-muted-foreground">折扣後總金額</span>
                    {readOnly ? (
                      <div className={`${viewFieldClass} tabular-nums`}>
                        {discountTotal !== "" && discountTotal != null
                          ? Number(discountTotal).toLocaleString()
                          : totalAmount > 0
                            ? totalAmount.toLocaleString()
                            : "0"}
                      </div>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={discountTotal}
                        onChange={(e) => {
                          setDiscountLocked(true);
                          setDiscountTotal(e.target.value);
                        }}
                        className="h-9 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={totalAmount > 0 ? String(totalAmount) : "0"}
                      />
                    )}
                  </label>

                  <label className="flex flex-col gap-1.5 min-w-0 max-w-[7.5rem]">
                    <span className="text-xs text-muted-foreground">運費</span>
                    {readOnly ? (
                      <div className={`${viewFieldClass} tabular-nums`}>
                        {(Number(shippingFee) || 0).toLocaleString()}
                      </div>
                    ) : (
                      <input
                        id="order-shipping-fee"
                        type="number"
                        min={0}
                        value={shippingFee}
                        onChange={(e) => setShippingFee(e.target.value)}
                        className="h-9 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )}
                  </label>

                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-xs text-muted-foreground">訂金比例</span>
                    {readOnly ? (
                      <div className={viewFieldClass}>
                        {depositPercent === "" || depositPercent == null
                          ? "自訂"
                          : `${depositPercent}%`}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                        <select
                          value={depositPercent}
                          onChange={(e) => setDepositPercent(e.target.value)}
                          className="h-9 w-full min-w-0 shrink-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-[7.25rem]"
                          aria-label="訂金比例"
                        >
                          <option value="">自訂</option>
                          <option value="30">30%</option>
                          <option value="40">40%</option>
                          <option value="50">50%</option>
                        </select>
                        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:justify-end">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            訂金試算
                            {trialDepositAmount != null ? (
                              <>
                                {" "}
                                <span className="font-semibold text-foreground">
                                  {trialDepositAmount.toLocaleString()}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground/80"> —</span>
                            )}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 shrink-0 px-2.5 text-xs"
                            disabled={trialDepositAmount == null}
                            onClick={() => {
                              if (trialDepositAmount != null) {
                                setDeposit(String(trialDepositAmount));
                              }
                            }}
                          >
                            帶入訂金
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-xs text-muted-foreground leading-snug">
                      預收訂金（計算訂金不含運費）
                    </span>
                    {readOnly ? (
                      <div className={`${viewFieldClass} tabular-nums`}>
                        {(Number(deposit) || 0).toLocaleString()}
                      </div>
                    ) : (
                      <input
                        id="order-deposit"
                        type="number"
                        min={0}
                        value={deposit}
                        onChange={(e) => setDeposit(e.target.value)}
                        className="h-9 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )}
                  </label>
                </div>
              </section>
            </div>
            </div>

            <div className="sticky bottom-0 z-20 shrink-0 border-t border-[#625E55]/25 bg-[#3d3a35] px-4 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-8">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/55">
                      應收總額（NTD）
                    </p>
                    <p className="mt-0.5 font-[family-name:var(--font-manrope)] text-2xl font-semibold tabular-nums tracking-tight text-[#FAF9F6]">
                      {grandTotal.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/55">
                      應收訂金金額
                    </p>
                    <p className="mt-0.5 font-[family-name:var(--font-manrope)] text-2xl font-semibold tabular-nums tracking-tight text-[#FAF9F6]">
                      {(Number(deposit) || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <Dialog.Close asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={saving}
                      className="h-11 rounded-lg text-white/85 hover:bg-white/10 hover:text-white"
                    >
                      {readOnly ? "關閉" : "取消"}
                    </Button>
                  </Dialog.Close>
                  {!readOnly ? (
                    <Button
                      type="submit"
                      disabled={saving}
                      className="h-12 min-w-[10rem] rounded-lg border-0 bg-[#FAF9F6] font-semibold text-[#625E55] shadow-sm hover:bg-[#f0efe8] focus-visible:ring-2 focus-visible:ring-[#FAF9F6]/40"
                    >
                      {saving ? "儲存中…" : "儲存訂單"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { OrderFormDialog };
