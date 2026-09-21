"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { OrderOverviewDialog } from "@/components/order-overview-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  CalendarDays,
  CalendarClock,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Printer,
  Hammer,
  PackageCheck,
  Truck,
  PauseCircle,
  ChevronDown,
  MessageSquare,
  ClipboardList,
} from "lucide-react";
import { cn, formatDateYyMmDd } from "@/lib/utils";
import { plannedVsDeliveryTone } from "@/lib/planned-delivery-tone";
import { orderNoteSections } from "@/lib/order-notes";
import { appendArmHeight } from "@/lib/product-arm-height";
import { stripSpecSuffixCodes } from "@/lib/strip-spec-suffix";
import {
  DEFAULT_WORK_ORDER_STAGE,
  isWorkOrderStage,
  normalizeWorkOrderStage,
  type WorkOrderStage,
  syncOrderStatusFromWorkOrders,
  WORK_ORDER_STAGES,
  stageStyleClassName,
  workOrderStageSortIndex,
} from "@/lib/work-order-stages";
import {
  formatSeatHeightCmLabel,
  isChairCh03FamilyProductCode,
  resolveSeatHeightCmForDisplay,
} from "@/lib/chair-product-code";
import { toast } from "sonner";

interface WorkOrderRow {
  id: string;
  order_item_id: string;
  order_id: string | null;
  /** 訂單主檔 customers.id，供客戶篩選與通路排序 */
  customer_id: string | null;
  order_number: string;
  customer_name: string;
  customer_alias?: string | null;
  shipping_contact_name?: string | null;
  item_name: string;
  quantity: number;
  category: string;
  stage: WorkOrderStage;
  order_status: string | null;
  /** 對應 public.employees.id */
  assignee_id: string | null;
  /** 由 employees 關聯帶出，供顯示／排序／搜尋 */
  assignee_name: string | null;
  expected_delivery_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  /** 木種（明細優先，未填退回規格庫） */
  item_wood: string;
  /** 尺寸：W/D/H（明細客製尺寸優先）＋座高＋扶手高 */
  item_size: string;
  /** 規格：product_variants.spec1（略去 -P/-R/-W/-F 代碼） */
  item_spec: string;
  /** 明細「客製化備註」（order_items.custom_notes） */
  item_notes: string | null;
  /** 明細「詳細描述 / 備註」（order_items.custom_description） */
  item_description: string | null;
  /** 訂單主檔「訂單備註」（orders.internal_notes） */
  order_notes: string | null;
}

/** 品項層級備註（客製化備註＋詳細描述），與訂單總覽共用來源與標籤 */
function workOrderItemNoteSections(w: WorkOrderRow) {
  return orderNoteSections({
    itemNotes: w.item_notes,
    itemDescription: w.item_description,
  });
}

function workOrderHasNotes(w: WorkOrderRow): boolean {
  return (
    workOrderItemNoteSections(w).length > 0 || !!(w.order_notes ?? "").trim()
  );
}

function formatWdh(w: unknown, d: unknown, h: unknown): string | null {
  const parts: string[] = [];
  if (w != null && w !== "") parts.push(`W${w}`);
  if (d != null && d !== "") parts.push(`D${d}`);
  if (h != null && h !== "") parts.push(`H${h}`);
  return parts.length > 0 ? parts.join(" × ") : null;
}

/** 尺寸字串：明細客製尺寸優先於規格庫，後接座高、扶手高（與列印訂單同口徑） */
function buildItemSizeText(oi: any, variant: any): string {
  const hasCustom =
    oi?.custom_dimension_w != null ||
    oi?.custom_dimension_d != null ||
    oi?.custom_dimension_h != null;
  let text = hasCustom
    ? formatWdh(oi.custom_dimension_w, oi.custom_dimension_d, oi.custom_dimension_h)
    : formatWdh(variant?.dimension_w, variant?.dimension_d, variant?.dimension_h);
  const seat = resolveSeatHeightCmForDisplay(oi?.seat_height_cm, variant?.seat_height_cm);
  if (seat != null) {
    const sh = formatSeatHeightCmLabel(seat);
    text = text ? `${text} · ${sh}` : sh;
  }
  return appendArmHeight(text, variant?.arm_height_cm) ?? "";
}

/** 下拉展開的品項明細：規格三欄＋品項備註／訂單備註 */
function WorkOrderDetailPanel({ w }: { w: WorkOrderRow }) {
  const specs = [
    { label: "木種", value: w.item_wood },
    { label: "尺寸", value: w.item_size },
    { label: "規格", value: w.item_spec },
  ];
  const itemNotes = workOrderItemNoteSections(w);
  const orderNote = (w.order_notes ?? "").trim();
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {specs.map((s) => (
          <div
            key={s.label}
            className="flex min-w-0 items-baseline gap-3 sm:flex-col sm:gap-0.5"
          >
            <dt className="w-9 shrink-0 text-xs text-muted-foreground sm:w-auto">
              {s.label}
            </dt>
            <dd
              className={cn(
                "min-w-0 break-words text-sm",
                s.value ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {s.value || "—"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-foreground">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            品項備註
          </p>
          {itemNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">無</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {itemNotes.map((sec) => (
                <div key={sec.label}>
                  {itemNotes.length > 1 && (
                    <span className="text-[11px] text-muted-foreground">
                      {sec.label}
                    </span>
                  )}
                  <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
                    {sec.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
          <p className="mb-1 flex flex-wrap items-center gap-1 text-xs font-semibold text-foreground">
            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            訂單備註
            <span className="font-normal text-muted-foreground">（整張訂單共用）</span>
          </p>
          {orderNote ? (
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
              {orderNote}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">無</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 展開明細的切換鈕；有任何備註時以小圓點提示 */
function DetailToggle({
  expanded,
  hasNotes,
  onClick,
  className,
}: {
  expanded: boolean;
  hasNotes: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${expanded ? "收合" : "展開"}品項明細${hasNotes ? "（有備註）" : ""}`}
      title={expanded ? "收合明細" : hasNotes ? "查看明細（有備註）" : "查看明細"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
        className
      )}
    >
      明細
      {hasNotes && (
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
      )}
      <ChevronDown
        className={cn("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}

/** 品項無類別時之下拉顯示與篩選鍵 */
const EMPTY_WORK_CATEGORY_LABEL = "（未填類別）";

function workOrderCategoryLabel(w: WorkOrderRow): string {
  const c = (w.category ?? "").trim();
  return c || EMPTY_WORK_CATEGORY_LABEL;
}

function parseDateMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 依工單「預計完成日」（planned_end_date）排序；無日期者置於最後 */
function comparePlannedEndDate(
  a: WorkOrderRow,
  b: WorkOrderRow,
  asc: boolean
): number {
  const na = parseDateMs(a.planned_end_date);
  const nb = parseDateMs(b.planned_end_date);
  if (na === null && nb === null) return 0;
  if (na === null) return 1;
  if (nb === null) return -1;
  const diff = na - nb;
  return asc ? diff : -diff;
}

function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}


interface EmployeeOption {
  id: string;
  name: string;
}

/** 與訂單管理客戶篩選相同：主檔含 channel_id 供 [通路] 置頂排序 */
interface WorkOrderCustomerOption {
  id: string;
  name: string;
  channel_id: string | null;
}

/** 頁面頂部分類卡片（同訂單管理排版）；依工單工序歸類 */
type StageCategoryKey =
  | "待排程"
  | "生產中"
  | "塗裝後"
  | "已出貨"
  | "無負責人或暫停";

const STAGE_CATEGORY_OPTIONS: StageCategoryKey[] = [
  "待排程",
  "生產中",
  "塗裝後",
  "已出貨",
  "無負責人或暫停",
];

const IN_PRODUCTION_STAGES: readonly WorkOrderStage[] = [
  "備料中",
  "零部件製作中",
  "砂磨中",
  "組裝中(一)",
  "塗裝中",
  "組裝中(二)",
  "塗裝中(二)",
];

const POST_PAINT_STAGES: readonly WorkOrderStage[] = [
  "塗裝後製程(組配、編織)",
  "包裝管理",
  "待出貨",
];

/** 各分類涵蓋之工序（供工序下拉選項；「無負責人或暫停」另含負責人條件，見 matchesStageCategory） */
const CATEGORY_STAGE_OPTIONS: Record<
  StageCategoryKey,
  readonly WorkOrderStage[]
> = {
  待排程: ["待排程"],
  生產中: IN_PRODUCTION_STAGES,
  塗裝後: POST_PAINT_STAGES,
  已出貨: ["已出貨"],
  無負責人或暫停: [...IN_PRODUCTION_STAGES, ...POST_PAINT_STAGES, "暫停"],
};

const STAGE_CATEGORY_META: Record<
  StageCategoryKey,
  { icon: typeof Hammer; hint: string | null }
> = {
  待排程: { icon: CalendarClock, hint: null },
  生產中: { icon: Hammer, hint: "備料～塗裝中(二)" },
  塗裝後: { icon: PackageCheck, hint: "塗裝後製程～待出貨" },
  已出貨: { icon: Truck, hint: null },
  無負責人或暫停: { icon: PauseCircle, hint: "生產中未指派，或暫停" },
};

/**
 * 工單是否屬於分類：前四類依工序；「無負責人或暫停」＝工序暫停，
 * 或已進入生產（非待排程／已出貨）但未指派負責人（可與其他分類重複出現）。
 */
function matchesStageCategory(w: WorkOrderRow, key: StageCategoryKey): boolean {
  if (key === "無負責人或暫停") {
    return (
      w.stage === "暫停" ||
      (!w.assignee_id && w.stage !== "待排程" && w.stage !== "已出貨")
    );
  }
  return CATEGORY_STAGE_OPTIONS[key].includes(w.stage);
}

const STAGE_OPTIONS = WORK_ORDER_STAGES;

/** 負責人篩選之「未指派」選項值（避免與 employees.id 衝突） */
const UNASSIGNED_FILTER = "__unassigned__";

export function WorkOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [overviewOrderId, setOverviewOrderId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<WorkOrderStage | "全部">("全部");
  const [stageCategory, setStageCategory] =
    useState<StageCategoryKey>("生產中");
  const [categoryFilter, setCategoryFilter] = useState<"全部" | string>("全部");
  const [customerFilter, setCustomerFilter] = useState("");
  /** 負責人下拉篩選："" 全部、UNASSIGNED_FILTER 未指派、其餘為 employees.id */
  const [assigneeIdFilter, setAssigneeIdFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [customers, setCustomers] = useState<WorkOrderCustomerOption[]>([]);
  type WorkSortKey =
    | "order_number"
    | "customer_name"
    | "item_name"
    | "stage"
    | "assignee_name"
    | "expected_delivery_date"
    | "planned_end_date";
  const [sortBy, setSortBy] = useState<WorkSortKey>("stage");
  const [sortAsc, setSortAsc] = useState(true);
  /** 已展開備註的工單 id（可同時展開多筆） */
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(
    () => new Set()
  );

  function toggleNote(id: string) {
    setExpandedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    bootstrap();
  }, []);

  async function fetchCustomersForFilter() {
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name, channel_id")
      .order("name", { ascending: true });
    if (!customerError && customerData) {
      setCustomers(
        (customerData as any[]).map((c) => ({
          id: String(c.id),
          name: String(c.name ?? ""),
          channel_id: c.channel_id != null ? String(c.channel_id) : null,
        })),
      );
    } else {
      setCustomers([]);
    }
  }

  async function bootstrap() {
    setLoading(true);
    // 讀取員工名單（只用來提供下拉選單）
    const { data: empData } = await supabase
      .from("employees")
      .select("id, name")
      .order("name", { ascending: true });
    setEmployees(
      ((empData ?? []) as any[]).map((e) => ({
        id: String(e.id),
        name: String(e.name ?? ""),
      }))
    );
    await Promise.all([fetchCustomersForFilter(), fetchWorkOrders()]);
    setLoading(false);
  }

  async function fetchWorkOrders() {
    const { data, error } = await supabase
      .from("work_orders")
      .select(
        `
        id,
        stage,
        assignee_id,
        employees!assignee_id (
          name
        ),
        planned_start_date,
        planned_end_date,
        order_items(
          id,
          custom_name,
          custom_category,
          custom_description,
          custom_notes,
          custom_dimension_w,
          custom_dimension_d,
          custom_dimension_h,
          quantity,
          seat_height_cm,
          wood_type,
          orders(
            id,
            customer_id,
            order_number,
            status,
            deleted_at,
            expected_delivery_date,
            shipping_contact_name,
            internal_notes,
            customers(name, alias)
          ),
          product_variants(
            product_code,
            wood_type,
            spec1,
            seat_height_cm,
            arm_height_cm,
            dimension_w,
            dimension_d,
            dimension_h,
            product_series(category)
          )
        )
      `
      )
      .order("planned_start_date", { ascending: true });

    if (error) {
      console.error("讀取工單失敗:", error);
      toast.error("工單讀取失敗");
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped: WorkOrderRow[] = ((data ?? []) as any[])
      // 排除所屬訂單已被軟刪除者，使生產管理與訂單管理一致
      .filter((r) => !r.order_items?.orders?.deleted_at)
      .map((r) => {
      const oi = r.order_items;
      const variant = oi?.product_variants;
      const order = oi?.orders;
      const customerRel = order?.customers;

      const customerName =
        (customerRel && customerRel.name) ||
        (Array.isArray(customerRel) && customerRel[0]?.name) ||
        "";

      const customerAlias =
        (customerRel && customerRel.alias) ||
        (Array.isArray(customerRel) && customerRel[0]?.alias) ||
        null;

      let itemName = "";
      if (oi?.custom_name) {
        itemName = String(oi.custom_name);
      } else if (variant?.product_code) {
        itemName = String(variant.product_code);
      }

      // 類別：明細 custom_category 優先，未填時退回系列品類（portal 舊單無 custom_category）
      const seriesRel = variant?.product_series;
      const seriesOne = Array.isArray(seriesRel) ? seriesRel[0] : seriesRel;
      const cat =
        (oi?.custom_category as string | null | undefined)?.trim() ||
        (seriesOne?.category as string | null | undefined)?.trim() ||
        "";

      // 中文規格：木種（明細優先於變體）＋編法等，如「白橡木 紙編」；不顯示尺寸
      const woodType =
        ((oi?.wood_type ?? variant?.wood_type) as string | null | undefined)?.trim() ||
        "";
      const spec1 =
        (variant?.spec1 as string | null | undefined)?.trim() || "";
      const chineseSpec = [woodType, spec1].filter(Boolean).join(" ");

      const fullNameParts = [itemName, chineseSpec].filter(
        (s) => typeof s === "string" && s.trim()
      ) as string[];

      const productCode =
        variant?.product_code != null ? String(variant.product_code).trim() : "";
      const seatCm = resolveSeatHeightCmForDisplay(oi?.seat_height_cm, variant?.seat_height_cm);
      let itemDisplay = fullNameParts.join(" ");
      if (isChairCh03FamilyProductCode(productCode) && seatCm != null) {
        const sh = formatSeatHeightCmLabel(seatCm);
        itemDisplay = itemDisplay.trim() ? `${itemDisplay} · ${sh}` : sh;
      }

      const empRel = (r as any).employees;
      const empOne = Array.isArray(empRel) ? empRel[0] : empRel;
      const assigneeName =
        empOne?.name != null && String(empOne.name).trim()
          ? String(empOne.name).trim()
          : null;

      return {
        id: String(r.id),
        order_item_id: oi?.id ? String(oi.id) : "",
        order_id: order?.id ? String(order.id) : null,
        customer_id:
          order?.customer_id != null && String(order.customer_id).trim()
            ? String(order.customer_id)
            : null,
        order_number: order?.order_number
          ? String(order.order_number)
          : "",
        customer_name: customerName,
        customer_alias: customerAlias != null ? String(customerAlias) : null,
        shipping_contact_name:
          order?.shipping_contact_name != null
            ? String(order.shipping_contact_name)
            : null,
        item_name: itemDisplay,
        quantity: Number(oi?.quantity ?? 0),
        category: cat,
        stage: normalizeWorkOrderStage(r.stage),
        order_status: (order?.status as string | null) ?? null,
        assignee_id: r.assignee_id != null ? String(r.assignee_id) : null,
        assignee_name: assigneeName,
        expected_delivery_date: order?.expected_delivery_date ?? null,
        planned_start_date: r.planned_start_date ?? null,
        planned_end_date: r.planned_end_date ?? null,
        item_wood: woodType,
        item_size: buildItemSizeText(oi, variant),
        item_spec: stripSpecSuffixCodes(spec1),
        item_notes: oi?.custom_notes ?? null,
        item_description: oi?.custom_description ?? null,
        order_notes: order?.internal_notes ?? null,
      };
    });

    // 排除「報價中」「結案」「已退貨」訂單，不進入生產列表
    const filtered = mapped.filter(
      (w) => w.order_status !== "報價中" && w.order_status !== "結案" && w.order_status !== "已退貨"
    );
    setRows(filtered);
  }

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const w of rows) {
      seen.add(workOrderCategoryLabel(w));
    }
    return Array.from(seen).sort((a, b) =>
      a.localeCompare(b, "zh-Hant", { numeric: true })
    );
  }, [rows]);

  /** 只列工單清單中出現過的客戶（通路客戶置頂並標示 [通路]）；主檔僅用來補通路資訊 */
  const customerFilterOptions = useMemo(() => {
    const byId = new Map<string, { name: string; channelId: string | null }>();
    customers.forEach((c) => {
      const ch =
        c.channel_id != null && String(c.channel_id).trim()
          ? String(c.channel_id)
          : null;
      byId.set(c.id, { name: c.name, channelId: ch });
    });
    rows.forEach((w) => {
      if (w.customer_id && !byId.has(w.customer_id)) {
        byId.set(w.customer_id, {
          name: w.customer_name?.trim() || "—",
          channelId: null,
        });
      }
    });
    const visibleIds = new Set<string>();
    rows.forEach((w) => {
      if (w.customer_id) visibleIds.add(w.customer_id);
    });
    return Array.from(byId.entries())
      .filter(([id]) => visibleIds.has(id))
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
  }, [customers, rows]);

  // 清單更新後，若原本選的客戶已不在選項中則清空，避免停在看不見的篩選
  useEffect(() => {
    if (
      customerFilter &&
      !customerFilterOptions.some((c) => c.id === customerFilter)
    ) {
      setCustomerFilter("");
    }
  }, [customerFilter, customerFilterOptions]);

  useEffect(() => {
    if (categoryFilter === "全部") return;
    const stillValid = rows.some(
      (w) => workOrderCategoryLabel(w) === categoryFilter
    );
    if (!stillValid) setCategoryFilter("全部");
  }, [rows, categoryFilter]);

  async function updateWorkOrderInline(
    id: string,
    patch: Partial<
      Pick<WorkOrderRow, "assignee_id" | "assignee_name" | "planned_end_date">
    > & {
      stage?: WorkOrderStage;
    }
  ) {
    const orderIdForSync = rows.find((w) => w.id === id)?.order_id ?? null;
    const payload: any = {};
    if (patch.stage) payload.stage = patch.stage;
    if (patch.assignee_id !== undefined) payload.assignee_id = patch.assignee_id;
    if (patch.planned_end_date !== undefined) {
      payload.planned_end_date = patch.planned_end_date;
    }
    if (Object.keys(payload).length === 0) return;

    const { error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("id", id);
    if (error) {
      toast.error(error.message || "更新工單失敗");
      return;
    }
    setRows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w))
    );

    if (orderIdForSync) {
      const sync = await syncOrderStatusFromWorkOrders(supabase, orderIdForSync);
      if (!sync.ok) {
        toast.error(sync.error || "回寫訂單狀態失敗");
      } else if (sync.nextOrderStatus) {
        toast.success(`訂單狀態已同步為「${sync.nextOrderStatus}」`);
      }
      await fetchWorkOrders();
    }
  }

  async function updateDeliveryDate(
    orderId: string | null,
    date: string | null,
    workOrderId: string
  ) {
    if (!orderId) return;
    const { error } = await supabase
      .from("orders")
      .update({ expected_delivery_date: date })
      .eq("id", orderId);
    if (error) {
      toast.error(error.message || "更新交期失敗");
      return;
    }
    setRows((prev) =>
      prev.map((w) =>
        w.order_id === orderId ? { ...w, expected_delivery_date: date } : w
      )
    );
  }

  /** 搜尋／類別／客戶／負責人先過濾（不含工序分類）；分類卡片計數與表格列共用，卡片數字＝點下去看到的筆數 */
  const preCategoryFiltered = useMemo(() => {
    return rows.filter((w) => {
      const matchCategory =
        categoryFilter === "全部" ||
        workOrderCategoryLabel(w) === categoryFilter;
      const matchCustomer =
        !customerFilter || w.customer_id === customerFilter;
      const matchAssigneeId =
        !assigneeIdFilter ||
        (assigneeIdFilter === UNASSIGNED_FILTER
          ? !w.assignee_id
          : w.assignee_id === assigneeIdFilter);
      const q = assigneeFilter.trim().toLowerCase();
      const matchAssignee =
        !q ||
        (w.assignee_name ?? "").toLowerCase().includes(q) ||
        w.customer_name.toLowerCase().includes(q) ||
        w.order_number.toLowerCase().includes(q) ||
        (w.shipping_contact_name ?? "").toLowerCase().includes(q) ||
        (w.item_name ?? "").toLowerCase().includes(q);
      return matchCategory && matchCustomer && matchAssigneeId && matchAssignee;
    });
  }, [rows, categoryFilter, customerFilter, assigneeIdFilter, assigneeFilter]);

  const categoryCards = useMemo(
    () =>
      STAGE_CATEGORY_OPTIONS.map((key) => ({
        key,
        count: preCategoryFiltered.filter((w) => matchesStageCategory(w, key))
          .length,
      })),
    [preCategoryFiltered]
  );

  /** 工序下拉只列當前分類內的站別（切換分類時重設為全部） */
  const stageOptionsForCategory = useMemo(
    () =>
      WORK_ORDER_STAGES.filter((s) =>
        CATEGORY_STAGE_OPTIONS[stageCategory].includes(s)
      ),
    [stageCategory]
  );

  const filtered = useMemo(() => {
    const list = preCategoryFiltered.filter((w) => {
      const matchCategory = matchesStageCategory(w, stageCategory);
      const matchStage = stageFilter === "全部" || w.stage === stageFilter;
      return matchCategory && matchStage;
    });

    // 排序：工序站別依 `WORK_ORDER_STAGES` 順序（見 work-order-stages.ts）
    list.sort((a, b) => {
      const key = sortBy;
      let cmp = 0;

      if (key === "stage") {
        cmp =
          workOrderStageSortIndex(a.stage) - workOrderStageSortIndex(b.stage);
        if (!sortAsc) cmp = -cmp;
      } else if (key === "assignee_name") {
        const as = (a.assignee_name ?? "").trim();
        const bs = (b.assignee_name ?? "").trim();
        cmp = as.localeCompare(bs, "zh-Hant", { numeric: true });
        if (!sortAsc) cmp = -cmp;
      } else if (key === "planned_end_date") {
        cmp = comparePlannedEndDate(a, b, sortAsc);
      } else if (key === "expected_delivery_date") {
        const na = parseDateMs(a.expected_delivery_date);
        const nb = parseDateMs(b.expected_delivery_date);
        if (na === null && nb === null) cmp = 0;
        else if (na === null) cmp = 1;
        else if (nb === null) cmp = -1;
        else cmp = na - nb;
        if (!sortAsc) cmp = -cmp;
      } else {
        // 1) 依照選擇的欄位排序
        const av = (a as any)[key];
        const bv = (b as any)[key];
        const as = av == null ? "" : String(av);
        const bs = bv == null ? "" : String(bv);
        cmp = as.localeCompare(bs, "zh-Hant", { numeric: true });
        if (!sortAsc) cmp = -cmp;
      }
      if (cmp !== 0) return cmp;

      // 2) 若同值，再依工序階段權重決定順序
      return workOrderStageSortIndex(a.stage) - workOrderStageSortIndex(b.stage);
    });

    return list;
  }, [preCategoryFiltered, stageCategory, stageFilter, sortBy, sortAsc]);

  function openOrderOverview(w: WorkOrderRow) {
    if (!w.order_id) return;
    setOverviewOrderId(w.order_id);
  }

  const uniqueAssignees = useMemo(
    () => employees.map((e) => e.name).filter(Boolean),
    [employees]
  );

  function toggleSort(key: WorkSortKey) {
    if (sortBy === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortBy(key);
      // 預設預計完成日為升冪，其餘欄位預設升冪
      setSortAsc(true);
    }
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: WorkSortKey }) {
    const active = sortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 text-sm font-semibold p-1.5 align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
        aria-label={`依${label}排序${active ? (sortAsc ? "升冪" : "降冪") : ""}`}
      >
        {label}
        {active ? (
          sortAsc ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    );
  }

  /* 以下四個欄位控制項由桌機表格與手機卡片共用 */
  function renderStageSelect(w: WorkOrderRow, className?: string) {
    return (
      <select
        value={w.stage}
        onChange={(e) =>
          updateWorkOrderInline(w.id, {
            stage: e.target.value as WorkOrderStage,
          })
        }
        title={w.stage}
        aria-label="工序"
        className={cn(
          "h-8 min-w-[5.5rem] rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring",
          stageStyleClassName(
            isWorkOrderStage(w.stage) ? w.stage : DEFAULT_WORK_ORDER_STAGE
          ),
          className
        )}
      >
        {STAGE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }

  function renderAssigneeSelect(w: WorkOrderRow, className?: string) {
    return (
      <select
        value={w.assignee_id ?? ""}
        onChange={(e) => {
          const id = e.target.value || null;
          const emp = employees.find((x) => x.id === id);
          updateWorkOrderInline(w.id, {
            assignee_id: id,
            assignee_name: emp?.name ?? null,
          });
        }}
        title={w.assignee_name ?? undefined}
        aria-label="負責人"
        className={cn(
          "h-8 min-w-[5.5rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
          className
        )}
      >
        <option value="">未指派</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.name}
          </option>
        ))}
      </select>
    );
  }

  function renderDeliveryInput(w: WorkOrderRow, className?: string) {
    return (
      <input
        type="date"
        value={dateInputValue(w.expected_delivery_date)}
        onChange={(e) => {
          const v = e.target.value || null;
          updateDeliveryDate(w.order_id, v, w.id);
        }}
        className={cn(
          "h-8 min-h-8 min-w-[7.5rem] rounded-md border border-input bg-background px-1.5 text-xs text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring",
          className
        )}
        aria-label="交期"
      />
    );
  }

  function renderPlannedInput(w: WorkOrderRow, className?: string) {
    return (
      <input
        type="date"
        value={dateInputValue(w.planned_end_date)}
        onChange={(e) => {
          const v = e.target.value;
          updateWorkOrderInline(w.id, {
            planned_end_date: v ? v : null,
          });
        }}
        className={cn(
          "h-8 min-h-8 min-w-[7.5rem] rounded-md border border-input bg-background px-1.5 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-ring",
          plannedVsDeliveryTone(w.planned_end_date, w.expected_delivery_date),
          className
        )}
        aria-label="預計完成日"
      />
    );
  }

  function renderOrderNumber(w: WorkOrderRow) {
    const label = w.order_number ? w.order_number.replace(/^ORD-/i, "") : "—";
    if (!w.order_id) return label;
    return (
      <button
        type="button"
        onClick={() => openOrderOverview(w)}
        className="text-left text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded px-0.5 py-0.5"
      >
        {label}
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入工單中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {categoryCards.map((s) => {
          const meta = STAGE_CATEGORY_META[s.key];
          const Icon = meta.icon;
          const active = stageCategory === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStageCategory(s.key);
                setStageFilter("全部");
              }}
              aria-pressed={active}
              title={`篩選：${s.key}`}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-primary bg-accent/30"
                  : "border-border bg-card hover:border-primary/40 hover:bg-accent/20"
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                  active ? "bg-primary" : "bg-secondary"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${
                    active ? "text-primary-foreground" : "text-primary"
                  }`}
                />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.key}
                </p>
                <p className="text-base font-semibold leading-tight text-foreground">
                  {s.count}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">件</span>
                </p>
                {meta.hint && (
                  <p className="text-[9px] leading-snug break-words text-muted-foreground/90">
                    {meta.hint}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto rounded-lg border border-border/70 bg-card/80 px-2 py-1.5 shadow-sm",
          "[scrollbar-width:thin] [-ms-overflow-style:auto]",
        )}
      >
        <select
          value={stageFilter}
          onChange={(e) =>
            setStageFilter(
              e.target.value === "全部"
                ? "全部"
                : (e.target.value as WorkOrderStage),
            )
          }
          className="h-8 w-[7.5rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-[8.25rem]"
        >
          <option value="全部">工序：全部</option>
          {stageOptionsForCategory.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(
              e.target.value === "全部" ? "全部" : e.target.value,
            )
          }
          className="h-8 w-[6.75rem] max-w-[10rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-[8.5rem]"
          aria-label="依品項類別篩選"
        >
          <option value="全部">類別：全部</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            客戶
          </span>
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="h-8 w-[7.5rem] max-w-[12rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-[9.5rem]"
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
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            負責人
          </span>
          <select
            value={assigneeIdFilter}
            onChange={(e) => setAssigneeIdFilter(e.target.value)}
            className="h-8 w-[6.5rem] max-w-[10rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-[8rem]"
            aria-label="依負責人篩選"
          >
            <option value="">全部負責人</option>
            <option value={UNASSIGNED_FILTER}>未指派</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          placeholder="搜尋品項、客戶、訂單…"
          title="搜尋品項 / 客戶 / 聯絡人 / 訂單 / 負責人"
          className="h-8 w-[7rem] min-w-[7rem] shrink-0 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-40 md:w-48"
        />
        <a
          href="/print/chair-production"
          className={cn(
            buttonVariants({ variant: "outline", size: "default" }),
            "h-8 shrink-0 gap-1 px-2 text-xs font-medium no-underline sm:px-2.5",
          )}
        >
          <Printer className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">椅子工單</span>
        </a>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            void Promise.all([fetchCustomersForFilter(), fetchWorkOrders()]);
          }}
          aria-label="重新整理工單"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* 手機／平板（lg 以下）：卡片清單 */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as WorkSortKey);
              setSortAsc(true);
            }}
            aria-label="排序欄位"
            className="h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="stage">排序：工序</option>
            <option value="expected_delivery_date">排序：交期</option>
            <option value="planned_end_date">排序：預計完成</option>
            <option value="order_number">排序：訂單</option>
            <option value="customer_name">排序：客戶</option>
            <option value="item_name">排序：品項</option>
            <option value="assignee_name">排序：負責人</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => setSortAsc((v) => !v)}
            aria-label={sortAsc ? "目前升冪，切換為降冪" : "目前降冪，切換為升冪"}
          >
            {sortAsc ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
            {sortAsc ? "升冪" : "降冪"}
          </Button>
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            目前尚無工單或不符合篩選條件。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((w) => {
              const expanded = expandedNoteIds.has(w.id);
              return (
                <div
                  key={w.id}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 text-xs leading-snug">
                      <span className="font-mono font-medium">{renderOrderNumber(w)}</span>
                      <span className="ml-1.5 font-medium text-foreground">
                        {w.customer_name || "—"}
                      </span>
                      {w.customer_alias && String(w.customer_alias).trim() && (
                        <span className="text-muted-foreground"> ({w.customer_alias})</span>
                      )}
                      {w.shipping_contact_name?.trim() ? (
                        <span className="text-muted-foreground">
                          ／{w.shipping_contact_name.trim()}
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                      ×{Number.isFinite(w.quantity) && w.quantity > 0 ? w.quantity : "—"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleNote(w.id)}
                    aria-expanded={expanded}
                    className="flex min-w-0 items-start justify-between gap-2 text-left focus:outline-none focus:ring-2 focus:ring-ring rounded"
                  >
                    <span className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">
                      {w.item_name || "—"}
                    </span>
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      明細
                      {workOrderHasNotes(w) && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                      )}
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                        aria-hidden
                      />
                    </span>
                  </button>
                  {expanded && (
                    <div className="rounded-lg bg-muted/40 p-2.5">
                      <WorkOrderDetailPanel w={w} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {renderStageSelect(w, "w-full min-w-0")}
                    {renderAssigneeSelect(w, "w-full min-w-0")}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">交期</span>
                      {renderDeliveryInput(w, "w-full min-w-0")}
                    </label>
                    <label className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">預計完成</span>
                      {renderPlannedInput(w, "w-full min-w-0")}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 電腦（lg 以上）：表格。解除 Table 預設的 min-w-max，讓表格縮到容器寬度、
          文字欄可換行，不出現左右捲軸。table-fixed 會讓不換行內容溢出蓋到相鄰欄，故不使用。 */}
      <div className="hidden rounded-xl border border-border bg-card overflow-x-auto min-w-0 max-w-full lg:block">
        <Table className="w-full min-w-0 text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="訂單" sortKey="order_number" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="客戶 / 專案" sortKey="customer_name" />
              </TableHead>
              {/* 品項內容最長，桌機給固定配額避免被日期／下拉欄擠到每列都折行 */}
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap w-[22%]">
                <SortHeader label="品項" sortKey="item_name" />
              </TableHead>
              <TableHead className="px-2 text-right text-sm font-semibold whitespace-nowrap">
                數量
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="工序" sortKey="stage" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="負責人" sortKey="assignee_name" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="交期" sortKey="expected_delivery_date" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="預計完成" sortKey="planned_end_date" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  目前尚無工單或不符合篩選條件。
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((w) => {
                const expanded = expandedNoteIds.has(w.id);
                return (
                  <React.Fragment key={w.id}>
                  <TableRow className={cn("border-b border-border", expanded && "border-b-0")}>
                    <TableCell className="px-1.5 py-2 align-top font-mono text-xs font-medium whitespace-nowrap">
                      {renderOrderNumber(w)}
                    </TableCell>
                    <TableCell className="p-2 align-top text-sm leading-tight">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 break-words">
                        <span className="font-medium text-foreground">
                          {w.customer_name || "—"}
                        </span>
                        {w.customer_alias && String(w.customer_alias).trim() && (
                          <span className="text-xs text-muted-foreground">
                            ({w.customer_alias})
                          </span>
                        )}
                        {w.shipping_contact_name?.trim() ? (
                          <span className="text-xs font-normal text-muted-foreground">
                            ／{w.shipping_contact_name.trim()}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="p-2 align-top text-sm leading-tight">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className="break-words text-foreground">
                          {w.item_name || "—"}
                        </span>
                        <DetailToggle
                          expanded={expanded}
                          hasNotes={workOrderHasNotes(w)}
                          onClick={() => toggleNote(w.id)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="p-2 align-top text-right text-sm tabular-nums whitespace-nowrap">
                      {Number.isFinite(w.quantity) && w.quantity > 0 ? w.quantity : "—"}
                    </TableCell>
                    <TableCell className="p-2 align-top whitespace-nowrap">
                      {renderStageSelect(w)}
                    </TableCell>
                    <TableCell className="p-2 align-top whitespace-nowrap">
                      {renderAssigneeSelect(w)}
                    </TableCell>
                    <TableCell className="p-2 align-top whitespace-nowrap">
                      {renderDeliveryInput(w)}
                    </TableCell>
                    <TableCell className="p-2 align-top whitespace-nowrap">
                      <div className="flex min-w-0 items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        {renderPlannedInput(w)}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8} className="px-3 pb-3 pt-1">
                        <div className="max-w-[60rem] rounded-lg border border-border/70 bg-card/60 p-3">
                          <WorkOrderDetailPanel w={w} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <datalist id="work-orders-assignees">
        {uniqueAssignees.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {rows.length} 筆工單（分類：{stageCategory}
        {STAGE_CATEGORY_META[stageCategory].hint
          ? `，${STAGE_CATEGORY_META[stageCategory].hint}`
          : ""}
        ）。交期為訂單對客戶之承諾；預計完成日為生產排程用，可與交期不同並隨時調整。
      </p>

      <OrderOverviewDialog
        open={overviewOrderId != null}
        onOpenChange={(open) => {
          if (!open) setOverviewOrderId(null);
        }}
        orderId={overviewOrderId}
        onEditOrder={(id) => {
          setOverviewOrderId(null);
          router.replace(
            `/?page=orders&openOrder=${encodeURIComponent(id)}`,
            { scroll: false },
          );
        }}
      />
    </div>
  );
}

