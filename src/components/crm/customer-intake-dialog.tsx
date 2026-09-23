"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { amegoBanQuery } from "@/lib/sales-invoice";
import { DEFAULT_WORK_ORDER_STAGE } from "@/lib/work-order-stages";
import { DEFAULT_SEAT_HEIGHT_CM, hasSeatSpecs } from "@/lib/product-seat-height";
import {
  CONTACT_METHOD_OPTIONS,
  CUSTOMER_SOURCE_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
} from "@/lib/customer-options";
import {
  INTAKE_FIELD_LABELS,
  INTAKE_TEXT_MAX_LENGTH,
  MATCH_REASON_LABELS,
  diffCustomerFields,
  findCustomerMatches,
  pickDefaultMatch,
  sanitizeIntakeResult,
  searchCustomers,
  type CustomerMatch,
  type ExistingCustomerFields,
  type FieldUpdate,
  type IntakeCustomer,
  type IntakeOrder,
  type IntakeOrderItem,
  type MatchReason,
} from "@/lib/customer-intake";
import { matchIntakeItem, type IntakeVariantMatch } from "@/lib/intake-variant-match";
import { Button } from "@/components/ui/button";
import { AddressZipcodeHint } from "@/components/crm/address-zipcode-hint";
import { CUSTOMER_VIEW_SELECT, mapCustomerViewRow } from "@/components/orders/order-helpers";
import type { OrderDraft, OrderItemInput, VariantOption } from "@/components/orders/types";
import type { CustomerRow } from "@/types/crm";
import type { Database } from "@/types/database.types";

type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];

/** 表單 state：文字欄位一律字串（空字串＝未填），電梯三態 */
type TextField = Exclude<keyof IntakeCustomer, "has_elevator">;
type IntakeForm = Record<TextField, string> & { has_elevator: boolean | null };

const TEXT_FIELDS: TextField[] = [
  "name",
  "contact_person",
  "phone",
  "delivery_address",
  "company",
  "tax_id",
  "brand_name",
  "line_id",
  "ig_account",
  "source",
  "customer_type",
  "contact_method",
  "notes",
];

const NEW_CUSTOMER = "__new__";

const EMPTY_ORDER: IntakeOrder = {
  items: [],
  expected_delivery_date: null,
  notes: null,
  discount_percent: null,
  discount_amount: null,
  deposit_requested: false,
  deposit_percent: null,
  deposit_amount: null,
  shipping_fee: null,
};

/** 沒寫訂金比例／金額但要求帶入訂金時，用訂單表單預設的比例 */
const DEFAULT_DEPOSIT_PERCENT = 50;

type ItemMatch = IntakeVariantMatch<VariantOption> | null;

function formatDims(it: Pick<IntakeOrderItem, "dimension_w" | "dimension_d" | "dimension_h">): string | null {
  const dims = [it.dimension_w, it.dimension_d, it.dimension_h];
  return dims.some((d) => d != null) ? `${dims.map((d) => d ?? "—").join("×")} cm` : null;
}

/** 訊息裡對這個品項的描述（只確定系列時寫進備註，讓使用者挑規格時參考） */
function describeItem(it: IntakeOrderItem): string {
  return [
    it.name,
    it.wood_type,
    formatDims(it),
    it.unit_price != null ? `單價 ${it.unit_price.toLocaleString()}` : null,
    it.notes,
  ]
    .filter(Boolean)
    .join("・");
}

/** 預估單價（與訂單表單結算相同邏輯：訂製款／客製用訊息價格，現成規格用牌價，訊息另有指定價格時優先） */
function estimateUnitPrice(it: IntakeOrderItem, match: ItemMatch): number {
  if (match?.kind === "variant" && !match.customOrder) return it.unit_price ?? match.variant.base_price ?? 0;
  return it.unit_price ?? 0;
}

/** 解析品項 → 訂單表單品項：對到規格庫就帶規格（與手動選規格相同的欄位），否則用客製家具 */
function buildDraftItem(it: IntakeOrderItem, index: number, match: ItemMatch): OrderItemInput {
  const common = {
    id: `item-intake-${index}`,
    quantity: it.quantity,
    work_order_stage: DEFAULT_WORK_ORDER_STAGE,
    work_order_assignee_id: null,
    work_order_planned_end_date: null,
  };
  if (match?.kind === "variant") {
    const v = match.variant;
    const seatDefault = v.seat_height_cm ?? (hasSeatSpecs(v.series_category) ? DEFAULT_SEAT_HEIGHT_CM : null);
    if (match.customOrder) {
      // 訂製款：沒有牌價，價格、木種、尺寸都以訊息為準
      return {
        ...common,
        kind: "variant",
        variant_id: v.id,
        series_id: v.series_id,
        unit_price: it.unit_price ?? 0,
        channel_unit_price: null,
        custom_notes: it.notes ?? "",
        wood_type: it.wood_type,
        custom_dimension_w: it.dimension_w,
        custom_dimension_d: it.dimension_d,
        custom_dimension_h: it.dimension_h,
        seat_height_cm: it.seat_height_cm ?? seatDefault,
      };
    }
    const listPrice = v.base_price ?? 0;
    return {
      ...common,
      kind: "variant",
      variant_id: v.id,
      series_id: v.series_id,
      unit_price: listPrice,
      // 現成規格牌價鎖定；訊息指定的價格與牌價不同時，放進「通路價格／折扣價格」當個別折扣
      channel_unit_price: it.unit_price != null && it.unit_price !== listPrice ? it.unit_price : null,
      custom_notes: it.notes ?? "",
      wood_type: v.wood_type ?? it.wood_type,
      custom_dimension_w: v.dimension_w ?? null,
      custom_dimension_d: v.dimension_d ?? null,
      custom_dimension_h: v.dimension_h ?? null,
      seat_height_cm: it.seat_height_cm ?? seatDefault,
    };
  }
  if (match?.kind === "series") {
    // 系列確定、規格待選：選規格時會帶入規格的牌價與尺寸，訊息內容留在備註
    return {
      ...common,
      kind: "variant",
      variant_id: "",
      series_id: match.series_id,
      unit_price: 0,
      channel_unit_price: null,
      custom_notes: `客戶需求：${describeItem(it)}`,
      wood_type: it.wood_type,
      seat_height_cm: it.seat_height_cm,
    };
  }
  return {
    ...common,
    kind: "custom",
    variant_id: "",
    unit_price: it.unit_price ?? 0,
    channel_unit_price: null,
    custom_notes: it.notes ?? "",
    custom_category: it.category,
    custom_name: it.name,
    custom_description: null,
    custom_dimension_w: it.dimension_w,
    custom_dimension_d: it.dimension_d,
    custom_dimension_h: it.dimension_h,
    seat_height_cm: it.seat_height_cm,
    wood_type: it.wood_type,
  };
}

function matchLabel(match: ItemMatch): string {
  if (match?.kind === "variant") {
    return `規格庫：${match.variant.series_name} · ${match.variant.label}${match.customOrder ? "（訂製款）" : ""}`;
  }
  if (match?.kind === "series") return `規格庫：${match.series_name}（規格請在訂單中選擇）`;
  return "客製家具";
}

function toForm(c: IntakeCustomer): IntakeForm {
  const form = { has_elevator: c.has_elevator } as IntakeForm;
  for (const key of TEXT_FIELDS) form[key] = c[key] ?? "";
  return form;
}

function emptyForm(): IntakeForm {
  const form = { has_elevator: null } as IntakeForm;
  for (const key of TEXT_FIELDS) form[key] = "";
  return form;
}

function formToCustomer(form: IntakeForm): IntakeCustomer {
  const c = { has_elevator: form.has_elevator } as IntakeCustomer;
  for (const key of TEXT_FIELDS) c[key] = form[key].trim() || null;
  return c;
}

function existingFields(row: CustomerRow): ExistingCustomerFields {
  return {
    contact_person: row.contact_person ?? null,
    phone: row.phone ?? null,
    delivery_address: row.delivery_address ?? null,
    has_elevator: row.has_elevator ?? null,
    company: row.company ?? null,
    tax_id: row.tax_id ?? null,
    brand_name: row.brand_name ?? null,
    line_id: row.line_id ?? null,
    ig_account: row.ig_account ?? null,
    source: row.source ?? null,
    customer_type: row.customer_type ?? null,
    contact_method: row.contact_method ?? null,
    notes: row.notes ?? null,
  };
}

/** 比對需掃過全部客戶；Supabase 單次最多回 1000 筆，分頁讀完（新→舊，同姓等同分結果先列近期客戶） */
async function fetchAllCustomers(): Promise<CustomerRow[]> {
  const pageSize = 1000;
  const rows: CustomerRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_VIEW_SELECT)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`讀取客戶資料失敗：${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page.map(mapCustomerViewRow));
    if (page.length < pageSize) return rows;
  }
}

function contactMethodLabel(value: string | null | undefined): string {
  return CONTACT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "";
}

function displayUpdateValue(u: FieldUpdate, value: string | boolean | null): string {
  if (value == null || value === "") return "（空白）";
  if (typeof value === "boolean") return value ? "有電梯" : "無電梯";
  if (u.field === "contact_method") return contactMethodLabel(value);
  return value;
}

const STRONG_REASON_CLASS = "border-emerald-200 bg-emerald-100 text-emerald-800";
const POSSIBLE_REASON_CLASS = "border-amber-200 bg-amber-100 text-amber-800";
/** 同姓、手動選擇：僅供參考 */
const NEUTRAL_REASON_CLASS = "border-border bg-muted text-muted-foreground";
const STRONG_REASONS: MatchReason[] = ["phone", "tax_id", "line_id", "ig_account"];

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const labelClass = "text-xs text-muted-foreground";
const sectionClass = "space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4";
const sectionTitleClass = "text-sm font-semibold text-foreground";

const PLACEHOLDER = `例：
王小明 0912-345-678
台南市東區大學路1號5樓（有電梯）
統編 12345678 抬頭 小明設計有限公司
想訂胡桃木餐桌 180x90 一張、餐椅 4 張，希望 11 月底前送到`;

/** 既有客戶選項（比對結果與搜尋結果共用） */
function CustomerOptionButton({
  customer: c,
  reasons,
  manual = false,
  selected,
  onSelect,
}: {
  customer: CustomerRow;
  reasons: MatchReason[];
  /** 從搜尋選取、不在比對結果中 */
  manual?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const detail = [c.contact_person !== c.name ? c.contact_person : null, c.phone, c.company, c.delivery_address]
    .filter(Boolean)
    .join("・");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition ${
        selected ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:bg-muted/50"
      }`}
    >
      <span className="flex w-full flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">
          {c.name}
          {c.alias ? <span className="ml-1 text-xs text-muted-foreground">（{c.alias}）</span> : null}
        </span>
        {reasons.map((r) => (
          <span
            key={r}
            className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
              STRONG_REASONS.includes(r)
                ? STRONG_REASON_CLASS
                : r === "surname"
                  ? NEUTRAL_REASON_CLASS
                  : POSSIBLE_REASON_CLASS
            }`}
          >
            {MATCH_REASON_LABELS[r]}
          </span>
        ))}
        {manual ? (
          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${NEUTRAL_REASON_CLASS}`}>
            手動選擇
          </span>
        ) : null}
      </span>
      {detail ? <span className="w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span> : null}
    </button>
  );
}

export interface CustomerIntakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 規格庫（開訂單時用來對應品項；不傳則品項一律以客製家具帶入） */
  variants?: VariantOption[];
  /** 客戶建立／更新後呼叫（呼叫端重新載入客戶清單；開訂單前會先等它完成） */
  onCustomerSaved?: () => void | Promise<void>;
  /** 有提供時顯示「開訂單」按鈕：傳回預先帶入的訂單內容，由呼叫端開啟訂單表單 */
  onCreateOrder?: (draft: OrderDraft) => void;
}

/**
 * 貼上建立客戶／訂單：貼上 LINE／IG／Email 等客戶訊息 → AI 解析欄位 →
 * 以電話／統編／LINE／IG／名稱／地址比對既有客戶 → 確認後建立新客戶或補上既有客戶資料，
 * 可再帶入訂單表單（訂單仍由使用者在訂單表單確認後儲存）。
 */
export function CustomerIntakeDialog({
  open,
  onOpenChange,
  variants = [],
  onCustomerSaved,
  onCreateOrder,
}: CustomerIntakeDialogProps) {
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [form, setForm] = useState<IntakeForm>(emptyForm);
  const [order, setOrder] = useState<IntakeOrder>(EMPTY_ORDER);
  const [selectedId, setSelectedId] = useState<string>(NEW_CUSTOMER);
  /** 使用者手動勾選／取消的主檔更新欄位；未動過的依預設（補空白＝勾、改既有值＝不勾） */
  const [updateOverrides, setUpdateOverrides] = useState<Partial<Record<FieldUpdate["field"], boolean>>>({});

  const formCustomer = useMemo(() => formToCustomer(form), [form]);
  // 修改欄位（例如更正電話）時即時重新比對
  const matches = useMemo(() => findCustomerMatches(formCustomer, customers, 8), [formCustomer, customers]);
  /** 手動搜尋既有客戶（比對結果沒有要找的人時用） */
  const [searchQuery, setSearchQuery] = useState("");
  const selectedCustomer =
    selectedId === NEW_CUSTOMER ? null : customers.find((c) => c.id === selectedId) ?? null;
  const isNew = selectedCustomer == null;
  /** 已選的客戶若不在比對結果（改了欄位、或從搜尋選取），仍列在清單最上方 */
  const listedMatches = useMemo<CustomerMatch<CustomerRow>[]>(
    () =>
      selectedCustomer && !matches.some((m) => m.customer.id === selectedCustomer.id)
        ? [{ customer: selectedCustomer, reasons: [], strong: false, score: 0 }, ...matches]
        : matches,
    [selectedCustomer, matches]
  );
  const hasStrongMatch = matches.some((m) => m.strong);
  const onlySurnameMatches = matches.length > 0 && matches.every((m) => m.reasons.every((r) => r === "surname"));
  const searchResults = useMemo(() => {
    const listed = new Set(listedMatches.map((m) => m.customer.id));
    return searchCustomers(searchQuery, customers, 30).filter((c) => !listed.has(c.id));
  }, [searchQuery, customers, listedMatches]);

  function selectCustomer(id: string) {
    setSelectedId(id);
    setUpdateOverrides({});
    setSearchQuery("");
  }

  const updates = useMemo(
    () => (selectedCustomer ? diffCustomerFields(existingFields(selectedCustomer), formCustomer) : []),
    [selectedCustomer, formCustomer]
  );
  const isChecked = (u: FieldUpdate) => updateOverrides[u.field] ?? u.kind === "fill";
  const checkedUpdates = updates.filter(isChecked);

  const itemMatches = useMemo(() => order.items.map((it) => matchIntakeItem(it, variants)), [order.items, variants]);
  const depositPercent =
    order.deposit_amount != null
      ? null
      : order.deposit_percent ?? (order.deposit_requested ? DEFAULT_DEPOSIT_PERCENT : null);
  /** 確認畫面的金額預估（通路折扣等以訂單表單計算為準） */
  const estimate = useMemo(() => {
    const subtotal = order.items.reduce(
      (sum, it, i) => sum + it.quantity * estimateUnitPrice(it, itemMatches[i] ?? null),
      0
    );
    let discounted = subtotal;
    if (order.discount_percent != null) discounted = Math.round(subtotal * (1 - order.discount_percent / 100));
    else if (order.discount_amount != null) discounted = Math.max(0, subtotal - order.discount_amount);
    const deposit =
      order.deposit_amount ?? (depositPercent != null ? Math.round((discounted * depositPercent) / 100) : null);
    return { subtotal, discounted, deposit };
  }, [order, itemMatches, depositPercent]);

  function setField<K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function lookupCompanyByTaxId(ban: string) {
    // 統編滿 8 碼查光賀帶出公司抬頭（抬頭已有值則不覆蓋），與新增客戶相同
    void amegoBanQuery(ban).then((r) => {
      if (r.ok && r.name) setForm((prev) => (prev.company.trim() ? prev : { ...prev, company: r.name }));
    });
  }

  function resetAll() {
    setStep("paste");
    setText("");
    setError(null);
    setCustomers([]);
    setForm(emptyForm());
    setOrder(EMPTY_ORDER);
    setSelectedId(NEW_CUSTOMER);
    setUpdateOverrides({});
    setSearchQuery("");
  }

  async function handleParse() {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("請先貼上客戶資料");
      return;
    }
    if (trimmed.length > INTAKE_TEXT_MAX_LENGTH) {
      toast.error(`內容太長（上限 ${INTAKE_TEXT_MAX_LENGTH} 字），請只貼這位客戶的資料`);
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("登入已失效，請重新登入");
        return;
      }
      const [res, allCustomers] = await Promise.all([
        fetch("/api/customer-intake", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: trimmed }),
        }),
        fetchAllCustomers(),
      ]);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.customer) {
        toast.error(data?.error || "解析失敗，請稍後再試");
        return;
      }
      const result = sanitizeIntakeResult(data);
      const initialMatches = findCustomerMatches(result.customer, allCustomers);
      setCustomers(allCustomers);
      setForm(toForm(result.customer));
      setOrder(result.order);
      // 電話／統編等確定相同、或恰好一位同名客戶時預設選既有客戶，否則預設建立新客戶
      setSelectedId(pickDefaultMatch(initialMatches, result.customer)?.id ?? NEW_CUSTOMER);
      setUpdateOverrides({});
      setSearchQuery("");
      setStep("review");
      if (result.customer.tax_id && !result.customer.company) lookupCompanyByTaxId(result.customer.tax_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解析失敗，請稍後再試");
    } finally {
      setParsing(false);
    }
  }

  /** 建立新客戶或把勾選的欄位寫回既有客戶；回傳儲存後的客戶主檔 */
  async function saveCustomer(): Promise<CustomerRow | null> {
    if (selectedCustomer) {
      if (checkedUpdates.length === 0) return selectedCustomer;
      const patch: CustomerUpdate = {};
      for (const u of checkedUpdates) {
        if (u.field === "has_elevator") patch.has_elevator = u.next === true;
        else if (typeof u.next === "string") patch[u.field] = u.next;
      }
      const { data, error: err } = await supabase
        .from("customers")
        .update(patch)
        .eq("id", selectedCustomer.id)
        .select(CUSTOMER_VIEW_SELECT)
        .single();
      if (err || !data) {
        setError(err?.message || "更新客戶失敗");
        return null;
      }
      toast.success("已更新客戶資料");
      return mapCustomerViewRow(data as unknown as Record<string, unknown>);
    }

    const c = formCustomer;
    if (!c.name) {
      setError("請輸入客戶名稱");
      return null;
    }
    if (!c.source) {
      setError("請選擇客戶來源");
      return null;
    }
    if (!c.customer_type) {
      setError("請選擇客戶種類");
      return null;
    }
    const payload: CustomerInsert = {
      name: c.name,
      contact_person: c.contact_person,
      phone: c.phone,
      delivery_address: c.delivery_address,
      has_elevator: c.has_elevator === true,
      company: c.company,
      tax_id: c.tax_id,
      brand_name: c.brand_name,
      line_id: c.line_id,
      ig_account: c.ig_account,
      source: c.source,
      customer_type: c.customer_type,
      contact_method: c.contact_method,
      notes: c.notes,
    };
    const { data, error: err } = await supabase
      .from("customers")
      .insert(payload)
      .select(CUSTOMER_VIEW_SELECT)
      .single();
    if (err || !data) {
      setError(err?.message || "新增客戶失敗");
      return null;
    }
    toast.success("已新增客戶");
    return mapCustomerViewRow(data as unknown as Record<string, unknown>);
  }

  /** 訂單寄送／發票資料：這次訊息有寫的優先（可能是新地址），沒寫的沿用客戶主檔 */
  function buildOrderDraft(customer: CustomerRow): OrderDraft {
    const c = formCustomer;
    const items = order.items.map((it, i) => buildDraftItem(it, i, itemMatches[i] ?? null));
    return {
      customer_id: customer.id,
      shipping_contact_name: c.contact_person ?? customer.contact_person ?? null,
      shipping_contact_phone: c.phone ?? customer.phone ?? null,
      shipping_address: c.delivery_address ?? customer.delivery_address ?? null,
      // 電梯跟著地址走：這次有寫新地址就用這次的電梯資訊
      shipping_has_elevator: c.delivery_address ? c.has_elevator : customer.has_elevator ?? null,
      invoice_title: c.company ?? customer.company ?? null,
      invoice_tax_id: c.tax_id ?? customer.tax_id ?? null,
      expected_delivery_date: order.expected_delivery_date,
      internal_notes: order.notes,
      items,
      discount_percent: order.discount_percent,
      discount_amount: order.discount_amount,
      deposit_percent: depositPercent,
      deposit_amount: order.deposit_amount,
      shipping_fee: order.shipping_fee,
    };
  }

  async function handleSave(withOrder: boolean) {
    setError(null);
    setSaving(true);
    try {
      const saved = await saveCustomer();
      if (!saved) return;
      // 先等客戶清單重新載入，訂單表單的客戶下拉才找得到剛建立的客戶
      await onCustomerSaved?.();
      const draft = withOrder && onCreateOrder ? buildOrderDraft(saved) : null;
      onOpenChange(false);
      resetAll();
      if (draft) onCreateOrder?.(draft);
    } finally {
      setSaving(false);
    }
  }

  const busy = parsing || saving;
  const title = onCreateOrder ? "貼上建立客戶／訂單" : "貼上建立客戶";
  const saveLabel = isNew ? "建立客戶" : checkedUpdates.length > 0 ? "更新客戶資料" : "客戶資料不需更新";
  const orderLabel = isNew ? "建立客戶並開訂單" : checkedUpdates.length > 0 ? "更新並開訂單" : "開訂單";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-lg focus:outline-none sm:p-5"
          aria-describedby="customer-intake-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                {title}
              </Dialog.Title>
              <p id="customer-intake-desc" className="mt-1 text-sm text-muted-foreground">
                {step === "paste"
                  ? "把客戶在 LINE／IG／Email 傳來的資料整段貼上，AI 會整理欄位並查詢是否已有這位客戶。"
                  : "確認解析結果，選擇既有客戶或建立新客戶。"}
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

          {step === "paste" ? (
            <div className="mt-4 space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (!busy) void handleParse();
                  }
                }}
                rows={10}
                autoFocus
                placeholder={PLACEHOLDER}
                className="min-h-[220px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>內容會送到 AI 服務解析；確認前不會存檔。</span>
                <span className={text.length > INTAKE_TEXT_MAX_LENGTH ? "text-destructive" : undefined}>
                  {text.length} / {INTAKE_TEXT_MAX_LENGTH}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" disabled={busy}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="button" onClick={() => void handleParse()} disabled={busy || !text.trim()}>
                  {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {parsing ? "解析中…" : "解析"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* 1. 既有客戶比對 */}
              <section className={sectionClass}>
                <h3 className={sectionTitleClass}>是否已有這位客戶？</h3>
                <p className="text-sm text-muted-foreground">
                  {listedMatches.length === 0
                    ? "找不到相符的既有客戶，將建立新客戶；也可以在下方搜尋既有客戶。"
                    : hasStrongMatch
                      ? "找到電話／統編／帳號相同的客戶，很可能是同一位，請確認："
                      : onlySurnameMatches
                        ? "找到同姓的客戶，是否為其中一位？"
                        : "找到名稱或地址相近的客戶，請確認是否為同一位："}
                </p>
                <div className="space-y-2" role="radiogroup" aria-label="選擇客戶">
                  {listedMatches.map((m) => (
                    <CustomerOptionButton
                      key={m.customer.id}
                      customer={m.customer}
                      reasons={m.reasons}
                      manual={m.reasons.length === 0}
                      selected={m.customer.id === selectedId}
                      onSelect={() => selectCustomer(m.customer.id)}
                    />
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isNew}
                    onClick={() => selectCustomer(NEW_CUSTOMER)}
                    className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                      isNew ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-dashed border-border hover:bg-muted/50"
                    }`}
                  >
                    建立新客戶
                  </button>
                </div>
                <div className="space-y-2 border-t border-border/60 pt-3">
                  <label htmlFor="intake-customer-search" className={labelClass}>
                    或選擇其他既有客戶
                  </label>
                  <input
                    id="intake-customer-search"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={inputClass}
                    placeholder="搜尋姓名、電話、公司、地址…（輸入「曾」列出姓曾的客戶）"
                    autoComplete="off"
                  />
                  {searchQuery.trim() ? (
                    searchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground">找不到符合的客戶</p>
                    ) : (
                      <div className="max-h-72 space-y-2 overflow-y-auto" role="radiogroup" aria-label="搜尋結果">
                        {searchResults.map((c) => (
                          <CustomerOptionButton
                            key={c.id}
                            customer={c}
                            reasons={[]}
                            selected={c.id === selectedId}
                            onSelect={() => selectCustomer(c.id)}
                          />
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
                {isNew && hasStrongMatch ? (
                  <p className="text-xs text-amber-700" role="alert">
                    已有電話／統編／帳號相同的客戶，確定要另外建立新客戶嗎？
                  </p>
                ) : null}
              </section>

              {/* 2. 訂購內容（帶入訂單表單）：放在客戶欄位前，手機上不用捲到底才看得到 */}
              {onCreateOrder ? (
                <section className={sectionClass}>
                  <h3 className={sectionTitleClass}>訂購內容</h3>
                  {order.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">沒有解析到品項，開訂單後請自行新增。</p>
                  ) : (
                    <ul className="space-y-2">
                      {order.items.map((it, i) => {
                        const match = itemMatches[i] ?? null;
                        const detail = [
                          it.wood_type,
                          formatDims(it),
                          it.seat_height_cm != null ? `座高 ${it.seat_height_cm} cm` : null,
                          it.notes,
                        ]
                          .filter(Boolean)
                          .join("・");
                        const unitPrice = estimateUnitPrice(it, match);
                        return (
                          <li key={i} className="text-sm [overflow-wrap:anywhere]">
                            <span className="font-medium text-foreground">
                              {it.name} × {it.quantity}
                            </span>
                            {unitPrice > 0 ? (
                              <span className="ml-1.5 tabular-nums text-foreground">
                                單價 {unitPrice.toLocaleString()}
                              </span>
                            ) : null}
                            {detail ? <span className="ml-1.5 text-xs text-muted-foreground">{detail}</span> : null}
                            <span
                              className={`mt-0.5 block text-xs ${
                                match?.kind === "variant" ? "text-emerald-700" : "text-amber-700"
                              }`}
                            >
                              → {matchLabel(match)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {order.discount_percent != null ? <p>折扣：{order.discount_percent}%</p> : null}
                    {order.discount_percent == null && order.discount_amount != null ? (
                      <p>折抵：{order.discount_amount.toLocaleString()}</p>
                    ) : null}
                    {order.deposit_amount != null ? (
                      <p>訂金：{order.deposit_amount.toLocaleString()}</p>
                    ) : depositPercent != null ? (
                      <p>帶入訂金：{depositPercent}%</p>
                    ) : null}
                    {order.shipping_fee != null ? <p>運費：{order.shipping_fee.toLocaleString()}</p> : null}
                    {order.expected_delivery_date ? <p>希望交期：{order.expected_delivery_date}</p> : null}
                    {order.notes ? <p className="[overflow-wrap:anywhere]">訂單備註：{order.notes}</p> : null}
                  </div>
                  {estimate.subtotal > 0 ? (
                    <p className="text-sm tabular-nums text-foreground">
                      預估：小計 {estimate.subtotal.toLocaleString()}
                      {estimate.discounted !== estimate.subtotal ? ` → 折扣後 ${estimate.discounted.toLocaleString()}` : ""}
                      {estimate.deposit != null ? `，訂金 ${estimate.deposit.toLocaleString()}` : ""}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    對到規格庫的品項以規格帶入，其餘以「客製家具」帶入；通路折扣與金額以訂單表單計算為準，確認後再儲存。
                  </p>
                </section>
              ) : null}

              {/* 3. 解析結果（可修改） */}
              <section className={sectionClass}>
                <div>
                  <h3 className={sectionTitleClass}>客戶資料（可修改）</h3>
                  {!isNew ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      用來補上客戶主檔與帶入訂單；不會更改既有客戶的名稱。
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-name" className={labelClass}>
                      客戶名稱 {isNew ? <span className="text-destructive">*</span> : null}
                    </label>
                    <input
                      id="intake-name"
                      type="text"
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      className={inputClass}
                      placeholder="客戶名稱"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-contact" className={labelClass}>
                      聯絡人
                    </label>
                    <input
                      id="intake-contact"
                      type="text"
                      value={form.contact_person}
                      onChange={(e) => setField("contact_person", e.target.value)}
                      className={inputClass}
                      placeholder="聯絡人姓名"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-phone" className={labelClass}>
                      電話
                    </label>
                    <input
                      id="intake-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                      className={inputClass}
                      placeholder="聯絡電話"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-contact-method" className={labelClass}>
                      聯絡方式
                    </label>
                    <select
                      id="intake-contact-method"
                      value={form.contact_method}
                      onChange={(e) => setField("contact_method", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">未指定</option>
                      {CONTACT_METHOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label htmlFor="intake-address" className={labelClass}>
                      地址
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        id="intake-address"
                        type="text"
                        value={form.delivery_address}
                        onChange={(e) => setField("delivery_address", e.target.value)}
                        className={`${inputClass} min-w-0 flex-1`}
                        placeholder="送貨／收件地址"
                      />
                      <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={form.has_elevator === true}
                          onChange={(e) => setField("has_elevator", e.target.checked)}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                        <span className="whitespace-nowrap">有電梯</span>
                      </label>
                    </div>
                    <AddressZipcodeHint
                      address={form.delivery_address}
                      onApply={(next) => setField("delivery_address", next)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-source" className={labelClass}>
                      客戶來源 {isNew ? <span className="text-destructive">*</span> : null}
                    </label>
                    <select
                      id="intake-source"
                      value={form.source}
                      onChange={(e) => setField("source", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">請選擇</option>
                      {CUSTOMER_SOURCE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-type" className={labelClass}>
                      客戶種類 {isNew ? <span className="text-destructive">*</span> : null}
                    </label>
                    <select
                      id="intake-type"
                      value={form.customer_type}
                      onChange={(e) => setField("customer_type", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">請選擇</option>
                      {CUSTOMER_TYPE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-tax-id" className={labelClass}>
                      統一編號
                    </label>
                    <input
                      id="intake-tax-id"
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      value={form.tax_id}
                      onChange={(e) => {
                        const ban = e.target.value.replace(/\D/g, "");
                        setField("tax_id", ban);
                        if (/^\d{8}$/.test(ban)) lookupCompanyByTaxId(ban);
                      }}
                      className={inputClass}
                      placeholder="統一編號"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-company" className={labelClass}>
                      公司抬頭
                    </label>
                    <input
                      id="intake-company"
                      type="text"
                      value={form.company}
                      onChange={(e) => setField("company", e.target.value)}
                      className={inputClass}
                      placeholder="輸入統編自動帶出"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-brand" className={labelClass}>
                      品牌名稱
                    </label>
                    <input
                      id="intake-brand"
                      type="text"
                      value={form.brand_name}
                      onChange={(e) => setField("brand_name", e.target.value)}
                      className={inputClass}
                      placeholder="對外品牌／招牌名稱"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-line" className={labelClass}>
                      LINE ID
                    </label>
                    <input
                      id="intake-line"
                      type="text"
                      value={form.line_id}
                      onChange={(e) => setField("line_id", e.target.value)}
                      className={inputClass}
                      placeholder="LINE ID"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intake-ig" className={labelClass}>
                      IG 帳號
                    </label>
                    <input
                      id="intake-ig"
                      type="text"
                      value={form.ig_account}
                      onChange={(e) => setField("ig_account", e.target.value)}
                      className={inputClass}
                      placeholder="Instagram 帳號"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label htmlFor="intake-notes" className={labelClass}>
                      客情備註
                    </label>
                    <textarea
                      id="intake-notes"
                      value={form.notes}
                      onChange={(e) => setField("notes", e.target.value)}
                      rows={2}
                      className="min-h-[64px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="偏好、預算、往來紀錄等"
                    />
                  </div>
                </div>
              </section>

              {/* 4. 既有客戶：要寫回主檔的欄位 */}
              {selectedCustomer ? (
                <section className={sectionClass}>
                  <h3 className={sectionTitleClass}>更新「{selectedCustomer.name}」的客戶主檔</h3>
                  {updates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">客戶主檔已有這些資料，不需更新。</p>
                  ) : (
                    <ul className="space-y-2">
                      {updates.map((u) => (
                        <li key={u.field}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={isChecked(u)}
                              onChange={(e) =>
                                setUpdateOverrides((prev) => ({ ...prev, [u.field]: e.target.checked }))
                              }
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                            />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="font-medium text-foreground">
                                {u.kind === "fill" ? "補上" : u.kind === "append" ? "附加" : "改為新的"}
                                {INTAKE_FIELD_LABELS[u.field]}：
                              </span>
                              {u.kind === "change" ? (
                                <span className="text-muted-foreground">
                                  <span className="line-through">{displayUpdateValue(u, u.current)}</span>
                                  {" → "}
                                  <span className="text-foreground">{displayUpdateValue(u, u.next)}</span>
                                </span>
                              ) : u.kind === "append" && formCustomer.notes ? (
                                <span className="text-foreground">{formCustomer.notes}</span>
                              ) : (
                                <span className="text-foreground">{displayUpdateValue(u, u.next)}</span>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {updates.some((u) => u.field === "delivery_address" && u.kind === "change") ? (
                    <p className="text-xs text-muted-foreground">
                      不勾選地址時，新地址只會帶入這張訂單的寄送地址，不改客戶主檔。
                    </p>
                  ) : null}
                </section>
              ) : null}

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep("paste")} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" />
                  重新貼上
                </Button>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant={onCreateOrder ? "outline" : "default"}
                    onClick={() => void handleSave(false)}
                    disabled={busy || (!isNew && checkedUpdates.length === 0)}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {saveLabel}
                  </Button>
                  {onCreateOrder ? (
                    <Button type="button" onClick={() => void handleSave(true)} disabled={busy}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {orderLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
