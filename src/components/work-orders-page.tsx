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
  CalendarPlus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Printer,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { toast } from "sonner";

type WorkStage =
  | "待排程"
  | "備料中"
  | "製作中"
  | "砂磨中"
  | "塗裝中"
  | "組裝中"
  | "成品"
  | "暫停"
  | "已出貨";

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
  stage: WorkStage;
  order_status: string | null;
  assignee: string | null;
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

type ProductionOrderStatusFilter = "全部" | "生產中" | "非生產中";

const PRODUCTION_ORDER_STATUS_FILTERS: ProductionOrderStatusFilter[] = [
  "全部",
  "生產中",
  "非生產中",
];

const STAGE_OPTIONS: WorkStage[] = [
  "待排程",
  "備料中",
  "製作中",
  "砂磨中",
  "塗裝中",
  "組裝中",
  "成品",
  "暫停",
  "已出貨",
];

function stageStyle(stage: WorkStage): string {
  switch (stage) {
    case "待排程":
      return "bg-muted text-foreground border-border";
    case "備料中":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "製作中":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "砂磨中":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "塗裝中":
      return "bg-rose-100 text-rose-900 border-rose-200";
    case "組裝中":
      return "bg-indigo-100 text-indigo-900 border-indigo-200";
    case "成品":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "暫停":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "已出貨":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    default:
      return "bg-muted text-foreground border-border";
  }
}

export function WorkOrdersPage() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<WorkStage | "全部">("全部");
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
    | "assignee"
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
        assignee,
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
        stage: (r.stage as WorkStage) ?? "待排程",
        order_status: (order?.status as string | null) ?? null,
        assignee: r.assignee ?? null,
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
    patch: Partial<Pick<WorkOrderRow, "stage" | "assignee">>
  ) {
    const payload: any = {};
    if (patch.stage) payload.stage = patch.stage;
    if (patch.assignee !== undefined) payload.assignee = patch.assignee;
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
  }

  const filtered = useMemo(() => {
    const list = rows.filter((w) => {
      const matchStage =
        stageFilter === "全部" || w.stage === stageFilter;
      const matchOrderStatus =
        orderStatusFilter === "全部"
          ? true
          : orderStatusFilter === "生產中"
            ? isOrderStatusAtOrAfterProduction(w.order_status)
            : isOrderStatusBeforeProduction(w.order_status);
      const matchCategory =
        categoryFilter === "全部" ||
        workOrderCategoryLabel(w) === categoryFilter;
      const q = assigneeFilter.trim().toLowerCase();
      const matchAssignee =
        !q ||
        (w.assignee ?? "").toLowerCase().includes(q) ||
        w.customer_name.toLowerCase().includes(q) ||
        w.order_number.toLowerCase().includes(q);
      return matchStage && matchOrderStatus && matchCategory && matchAssignee;
    });

    // 排序：先依選定欄位；若為工序站別，依固定順序：
    // 待排程 → 備料中 → 製作中 → 砂磨中 → 塗裝中 → 組裝中 → 成品 → 暫停 → 已出貨
    list.sort((a, b) => {
      function stageWeight(stage: WorkStage): number {
        switch (stage) {
          case "待排程":
            return 0;
          case "備料中":
            return 1;
          case "製作中":
            return 2;
          case "砂磨中":
            return 3;
          case "塗裝中":
            return 4;
          case "組裝中":
            return 5;
          case "成品":
            return 6;
          case "暫停":
            return 7;
          case "已出貨":
            return 8;
          default:
            return 9;
        }
      }

      const key = sortBy;
      let cmp = 0;

      if (key === "stage") {
        // 1) 以工序站別權重排序
        cmp = stageWeight(a.stage) - stageWeight(b.stage);
      } else {
        // 1) 依照選擇的欄位排序
        const av = (a as any)[key];
        const bv = (b as any)[key];

        if (key === "planned_end_date" || key === "expected_delivery_date") {
          const ad = av ? new Date(av) : null;
          const bd = bv ? new Date(bv) : null;
          const at = ad ? ad.getTime() : 0;
          const bt = bd ? bd.getTime() : 0;
          cmp = at - bt;
        } else {
          const as = av == null ? "" : String(av);
          const bs = bv == null ? "" : String(bv);
          cmp = as.localeCompare(bs, "zh-Hant", { numeric: true });
        }
      }

      if (!sortAsc) cmp = -cmp;
      if (cmp !== 0) return cmp;

      // 2) 若同值，再依工序階段權重決定順序
      return stageWeight(a.stage) - stageWeight(b.stage);
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

  function buildGoogleCalendarUrl(w: WorkOrderRow): string | null {
    const dateRaw = w.planned_end_date ?? w.expected_delivery_date;
    if (!dateRaw) return null;

    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const ymd = `${year}${month}${day}`;

    const text = `[${w.customer_name || "未命名客戶"}] ${
      w.item_name || "未命名品項"
    } / ${w.stage}`;

    const detailsLines = [
      `訂單編號：${w.order_number || "—"}`,
      `負責人：${w.assignee || "未指派"}`,
      `備註：${w.note || "—"}`,
    ];
    const details = detailsLines.join("\n");

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text,
      dates: `${ymd}/${ymd}`,
      details,
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
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
                  : (e.target.value as WorkStage)
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
                <SortHeader label="負責人" sortKey="assignee" />
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
              filtered.map((w) => {
                const calendarUrl = buildGoogleCalendarUrl(w);
                return (
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
                          stage: e.target.value as WorkStage,
                        })
                      }
                      className={`h-8 rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring ${stageStyle(
                        w.stage
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
                        value={w.assignee ?? ""}
                        onChange={(e) =>
                          updateWorkOrderInline(w.id, {
                            assignee: e.target.value || null,
                          })
                        }
                        className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">未指派</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.name}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        {w.planned_end_date
                          ? formatDate(w.planned_end_date)
                          : w.expected_delivery_date
                          ? formatDate(w.expected_delivery_date)
                          : "—"}
                      </span>
                      {calendarUrl && (
                        <a
                          href={calendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="加到 Google 行事曆"
                          className="inline-flex h-7 w-7 ml-1 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )})
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
            ? "（訂單狀態：生產中～已出貨）"
            : "（訂單狀態：非生產中）"}
      </p>
    </div>
  );
}

