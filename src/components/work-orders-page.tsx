"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
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
  User,
  Wrench,
  CalendarDays,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Printer,
} from "lucide-react";
import { cn, formatDateYyMmDd } from "@/lib/utils";
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
import { toast } from "sonner";

interface WorkOrderRow {
  id: string;
  order_item_id: string;
  order_id: string | null;
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

/** 與「預計完成」欄顯示一致：預計完成日優先，否則訂單交期 */
function effectivePlannedCompletionDate(w: WorkOrderRow): string | null {
  return w.planned_end_date ?? w.expected_delivery_date ?? null;
}

function parseDateMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 依有效預計完成日排序；無日期者固定置於最後（升／降皆同） */
function comparePlannedCompletion(
  a: WorkOrderRow,
  b: WorkOrderRow,
  asc: boolean
): number {
  const na = parseDateMs(effectivePlannedCompletionDate(a));
  const nb = parseDateMs(effectivePlannedCompletionDate(b));
  if (na === null && nb === null) return 0;
  if (na === null) return 1;
  if (nb === null) return -1;
  const diff = na - nb;
  return asc ? diff : -diff;
}

interface EmployeeOption {
  id: string;
  name: string;
}

/** 與訂單管理相同之狀態順序；用於「生產中」前／後篩選 */
const ORDER_STATUS_SEQUENCE = [
  "報價中",
  "繪圖中",
  "排程中",
  "繪製製作圖",
  "生產中",
  "暫停",
  "已完工",
  "已出貨",
  "結案",
] as const;

function orderStatusIndex(status: string | null | undefined): number {
  if (!status) return -1;
  return ORDER_STATUS_SEQUENCE.indexOf(
    status as (typeof ORDER_STATUS_SEQUENCE)[number]
  );
}

/** 訂單狀態為「生產中」起（含）至「已出貨」 */
function isOrderStatusAtOrAfterProduction(status: string | null | undefined): boolean {
  const i = orderStatusIndex(status);
  const prod = orderStatusIndex("生產中");
  const ship = orderStatusIndex("已出貨");
  return i >= prod && i <= ship && prod >= 0;
}

/** 訂單狀態在「生產中」之前（繪圖／排程／製作圖等） */
function isOrderStatusBeforeProduction(status: string | null | undefined): boolean {
  const i = orderStatusIndex(status);
  const prod = orderStatusIndex("生產中");
  return i >= 0 && prod >= 0 && i < prod;
}

/** 工序為「已出貨」時視同非生產中，不列入「生產中」篩選 */
function isWorkOrderStageShipped(stage: WorkOrderStage): boolean {
  return stage === "已出貨";
}

type ProductionOrderStatusFilter = "全部" | "生產中" | "非生產中";

const PRODUCTION_ORDER_STATUS_FILTERS: ProductionOrderStatusFilter[] = [
  "全部",
  "生產中",
  "非生產中",
];

const STAGE_OPTIONS = WORK_ORDER_STAGES;

export function WorkOrdersPage() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<WorkOrderStage | "全部">("全部");
  const [orderStatusFilter, setOrderStatusFilter] =
    useState<ProductionOrderStatusFilter>("生產中");
  const [categoryFilter, setCategoryFilter] = useState<"全部" | string>("全部");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  type WorkSortKey =
    | "order_number"
    | "customer_name"
    | "item_name"
    | "category"
    | "stage"
    | "assignee_name"
    | "planned_end_date"
    | "expected_delivery_date";
  const [sortBy, setSortBy] = useState<WorkSortKey>("stage");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);

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
    await fetchWorkOrders();
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
          custom_dimension_w,
          custom_dimension_d,
          custom_dimension_h,
          quantity,
          orders(
            id,
            order_number,
            status,
            expected_delivery_date,
            shipping_contact_name,
            customers(name, alias)
          ),
          product_variants(
            product_code,
            wood_type,
            dimension_w,
            dimension_d,
            dimension_h
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

    const mapped: WorkOrderRow[] = ((data ?? []) as any[]).map((r) => {
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

      const cat =
        (oi?.custom_category as string | null | undefined)?.trim() || "";

      const w = oi?.custom_dimension_w ?? variant?.dimension_w ?? null;
      const d = oi?.custom_dimension_d ?? variant?.dimension_d ?? null;
      const h = oi?.custom_dimension_h ?? variant?.dimension_h ?? null;
      const parts = [w, d, h].filter((x) => x != null);
      const dim =
        parts.length === 0
          ? ""
          : `W:${w ?? "—"} x D:${d ?? "—"} x H:${h ?? "—"}`;

      const fullNameParts = [itemName, dim].filter(
        (s) => typeof s === "string" && s.trim()
      ) as string[];

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
        order_number: order?.order_number
          ? String(order.order_number)
          : "",
        customer_name: customerName,
        customer_alias: customerAlias != null ? String(customerAlias) : null,
        shipping_contact_name:
          order?.shipping_contact_name != null
            ? String(order.shipping_contact_name)
            : null,
        item_name: fullNameParts.join(" / "),
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

    // 排除「報價中」「結案」訂單，不進入生產列表
    const filtered = mapped.filter(
      (w) => w.order_status !== "報價中" && w.order_status !== "結案"
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

  useEffect(() => {
    if (categoryFilter === "全部") return;
    const stillValid = rows.some(
      (w) => workOrderCategoryLabel(w) === categoryFilter
    );
    if (!stillValid) setCategoryFilter("全部");
  }, [rows, categoryFilter]);

  async function updateWorkOrderInline(
    id: string,
    patch: Partial<Pick<WorkOrderRow, "assignee_id" | "assignee_name">> & {
      stage?: WorkOrderStage;
    }
  ) {
    const orderIdForSync = rows.find((w) => w.id === id)?.order_id ?? null;
    const payload: any = {};
    if (patch.stage) payload.stage = patch.stage;
    if (patch.assignee_id !== undefined) payload.assignee_id = patch.assignee_id;
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

  const filtered = useMemo(() => {
    const list = rows.filter((w) => {
      const matchStage =
        stageFilter === "全部" || w.stage === stageFilter;
      const matchOrderStatus =
        orderStatusFilter === "全部"
          ? true
          : orderStatusFilter === "生產中"
            ? isOrderStatusAtOrAfterProduction(w.order_status) &&
              !isWorkOrderStageShipped(w.stage)
            : isOrderStatusBeforeProduction(w.order_status) ||
              isWorkOrderStageShipped(w.stage);
      const matchCategory =
        categoryFilter === "全部" ||
        workOrderCategoryLabel(w) === categoryFilter;
      const q = assigneeFilter.trim().toLowerCase();
      const matchAssignee =
        !q ||
        (w.assignee_name ?? "").toLowerCase().includes(q) ||
        w.customer_name.toLowerCase().includes(q) ||
        w.order_number.toLowerCase().includes(q);
      return matchStage && matchOrderStatus && matchCategory && matchAssignee;
    });

    // 排序：工序站別依 `WORK_ORDER_STAGES` 順序（見 work-order-stages.ts）
    list.sort((a, b) => {
      const key = sortBy;
      let cmp = 0;

      if (key === "stage") {
        cmp =
          workOrderStageSortIndex(a.stage) - workOrderStageSortIndex(b.stage);
        if (!sortAsc) cmp = -cmp;
      } else if (key === "planned_end_date") {
        cmp = comparePlannedCompletion(a, b, sortAsc);
      } else {
        // 1) 依照選擇的欄位排序
        const av = (a as any)[key];
        const bv = (b as any)[key];

        if (key === "expected_delivery_date") {
          const na = parseDateMs(av);
          const nb = parseDateMs(bv);
          if (na === null && nb === null) cmp = 0;
          else if (na === null) cmp = 1;
          else if (nb === null) cmp = -1;
          else cmp = na - nb;
        } else {
          const as = av == null ? "" : String(av);
          const bs = bv == null ? "" : String(bv);
          cmp = as.localeCompare(bs, "zh-Hant", { numeric: true });
        }
        if (!sortAsc) cmp = -cmp;
      }
      if (cmp !== 0) return cmp;

      // 2) 若同值，再依工序階段權重決定順序
      return workOrderStageSortIndex(a.stage) - workOrderStageSortIndex(b.stage);
    });

    return list;
  }, [
    rows,
    stageFilter,
    orderStatusFilter,
    categoryFilter,
    assigneeFilter,
    sortBy,
    sortAsc,
  ]);

  function openOrderDetail(w: WorkOrderRow) {
    if (!w.order_id) return;
    if (typeof window === "undefined") return;
    const encodedId = encodeURIComponent(w.order_id);
    // 保留在目前頁面，只更新網址 hash，交由主系統視情況處理
    window.location.hash = `orders:${encodedId}`;
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
        className="inline-flex items-center gap-1 text-xs font-semibold p-1.5 align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wrench className="h-4 w-4" />
          <span>工單列表 · 依品項追蹤生產進度</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {PRODUCTION_ORDER_STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setOrderStatusFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  orderStatusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent/40"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <select
            value={stageFilter}
            onChange={(e) =>
              setStageFilter(
                e.target.value === "全部"
                  ? "全部"
                  : (e.target.value as WorkOrderStage)
              )
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="全部">工序：全部</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(
                e.target.value === "全部" ? "全部" : e.target.value
              )
            }
            className="h-8 max-w-[12rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依品項類別篩選"
          >
            <option value="全部">類別：全部</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            placeholder="搜尋客戶 / 訂單 / 負責人…"
            className="h-8 min-w-[12rem] rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <a
            href="/print/chair-production"
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "h-8 gap-1.5 px-2.5 text-xs font-medium no-underline"
            )}
          >
            <Printer className="h-3.5 w-3.5" />
            椅子清單
          </a>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={fetchWorkOrders}
            aria-label="重新整理工單"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold">
                <SortHeader label="訂單編號" sortKey="order_number" />
              </TableHead>
              <TableHead className="text-xs font-semibold">
                <SortHeader label="客戶 / 專案" sortKey="customer_name" />
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell whitespace-nowrap">
                聯絡人
              </TableHead>
              <TableHead className="text-xs font-semibold">
                <SortHeader label="品項 / 尺寸" sortKey="item_name" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-right whitespace-nowrap">
                數量
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                <SortHeader label="類別" sortKey="category" />
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                <SortHeader label="工序站別" sortKey="stage" />
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                <SortHeader label="負責人" sortKey="assignee_name" />
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                <SortHeader label="預計完成" sortKey="planned_end_date" />
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
                  目前尚無工單或不符合篩選條件。
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((w) => (
                <TableRow key={w.id} className="border-b border-border">
                  <TableCell className="p-2 align-middle whitespace-nowrap font-mono text-xs font-medium">
                    {w.order_id ? (
                      <button
                        type="button"
                        onClick={() => openOrderDetail(w)}
                        className="text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded px-1 py-0.5"
                      >
                        {w.order_number || "—"}
                      </button>
                    ) : (
                      w.order_number || "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium text-foreground">
                      {w.customer_name || "—"}
                    </span>
                    {w.customer_alias && String(w.customer_alias).trim() && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({w.customer_alias})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    {w.shipping_contact_name?.trim() || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {w.item_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {Number.isFinite(w.quantity) && w.quantity > 0 ? w.quantity : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {w.category || "—"}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <select
                      value={w.stage}
                      onChange={(e) =>
                        updateWorkOrderInline(w.id, {
                          stage: e.target.value as WorkOrderStage,
                        })
                      }
                      className={`h-8 rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring ${stageStyleClassName(
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
                  <TableCell className="text-sm hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
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
                        className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">未指派</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell w-[4.5rem] min-w-0 tabular-nums whitespace-nowrap p-1.5">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {w.planned_end_date
                          ? formatDateYyMmDd(w.planned_end_date)
                          : w.expected_delivery_date
                          ? formatDateYyMmDd(w.expected_delivery_date)
                          : "—"}
                      </span>
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
        顯示 {filtered.length} / {rows.length} 筆工單
        {orderStatusFilter === "全部"
          ? "（訂單狀態：全部）"
          : orderStatusFilter === "生產中"
            ? "（訂單：生產中～已出貨；工序已出貨者改列於「非生產中」）"
            : "（訂單：生產前段，或工序已出貨）"}
      </p>
    </div>
  );
}

