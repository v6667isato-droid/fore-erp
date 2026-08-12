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
} from "lucide-react";
import { cn, formatDateYyMmDd } from "@/lib/utils";
import { plannedVsDeliveryTone } from "@/lib/planned-delivery-tone";
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
  note: string | null;
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
            customers(name, alias)
          ),
          product_variants(
            product_code,
            wood_type,
            spec1,
            seat_height_cm,
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
        note: oi?.custom_description ?? null,
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

      <div className="rounded-xl border border-border bg-card overflow-x-auto min-w-0 max-w-full">
        {/* 與訂單管理頁一致：自動欄寬＋外層橫向捲動；table-fixed 會讓不換行內容溢出蓋到相鄰欄 */}
        <Table className="min-w-[52rem] text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="訂單" sortKey="order_number" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
                <SortHeader label="客戶 / 專案" sortKey="customer_name" />
              </TableHead>
              <TableHead className="px-2 text-sm font-semibold whitespace-nowrap">
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
              filtered.map((w) => (
                <TableRow key={w.id} className="border-b border-border">
                  <TableCell className="p-2 align-top font-mono text-sm font-medium whitespace-nowrap">
                    {w.order_id ? (
                      <button
                        type="button"
                        onClick={() => openOrderOverview(w)}
                        className="text-left text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded px-0.5 py-0.5"
                      >
                        {w.order_number ? w.order_number.replace(/^ORD-/i, "") : "—"}
                      </button>
                    ) : (
                      w.order_number ? w.order_number.replace(/^ORD-/i, "") : "—"
                    )}
                  </TableCell>
                  <TableCell className="p-2 align-top text-sm leading-tight whitespace-nowrap">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
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
                  <TableCell className="p-2 align-top text-sm leading-tight whitespace-nowrap">
                    <span className="text-foreground">{w.item_name || "—"}</span>
                  </TableCell>
                  <TableCell className="p-2 align-top text-right text-sm tabular-nums whitespace-nowrap">
                    {Number.isFinite(w.quantity) && w.quantity > 0 ? w.quantity : "—"}
                  </TableCell>
                  <TableCell className="p-2 align-top whitespace-nowrap">
                    <select
                      value={w.stage}
                      onChange={(e) =>
                        updateWorkOrderInline(w.id, {
                          stage: e.target.value as WorkOrderStage,
                        })
                      }
                      title={w.stage}
                      className={`h-8 min-w-[5.5rem] rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring ${stageStyleClassName(
                        isWorkOrderStage(w.stage) ? w.stage : DEFAULT_WORK_ORDER_STAGE
                      )}`}
                    >
                      {STAGE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="p-2 align-top whitespace-nowrap">
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
                      className="h-8 min-w-[5.5rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">未指派</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="p-2 align-top whitespace-nowrap">
                    <input
                      type="date"
                      value={dateInputValue(w.expected_delivery_date)}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        updateDeliveryDate(w.order_id, v, w.id);
                      }}
                      className="h-8 min-h-8 min-w-[7.5rem] rounded-md border border-input bg-background px-1.5 text-xs text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label="交期"
                    />
                  </TableCell>
                  <TableCell className="p-2 align-top whitespace-nowrap">
                    <div className="flex min-w-0 items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
                        )}
                        aria-label="預計完成日"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
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

