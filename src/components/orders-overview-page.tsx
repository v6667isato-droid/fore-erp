"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  CalendarDays,
  ExternalLink,
  Layers,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import { cn, formatDateYyMmDd } from "@/lib/utils";
import {
  DEFAULT_WORK_ORDER_STAGE,
  normalizeWorkOrderStage,
  stageStyleClassName,
  workOrderStageSortIndex,
  type WorkOrderStage,
} from "@/lib/work-order-stages";
import { toast } from "sonner";
import { VariantSeriesThumb } from "@/components/variant-series-thumb";
import { maxPlannedEndDate } from "@/lib/planned-end-aggregate";

/** 與訂單／生產列表一致之訂單狀態排序 */
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

function orderStatusSortIndex(status: string | null | undefined): number {
  if (!status) return 999;
  const i = ORDER_STATUS_SEQUENCE.indexOf(status as (typeof ORDER_STATUS_SEQUENCE)[number]);
  return i >= 0 ? i : 999;
}

const orderStatusBadgeClass: Record<string, string> = {
  報價中: "bg-amber-100 text-amber-800 border-amber-200",
  繪圖中: "bg-violet-100 text-violet-800 border-violet-200",
  排程中: "bg-amber-100 text-amber-800 border-amber-200",
  繪製製作圖: "bg-violet-100 text-violet-800 border-violet-200",
  生產中: "bg-blue-100 text-blue-800 border-blue-200",
  暫停: "bg-orange-100 text-orange-900 border-orange-200",
  已完工: "bg-teal-100 text-teal-900 border-teal-200",
  已出貨: "bg-emerald-100 text-emerald-800 border-emerald-200",
  結案: "bg-slate-200 text-slate-800 border-slate-300",
};

const paymentStatusBadgeClass: Record<string, string> = {
  未付款: "bg-amber-100 text-amber-800 border-amber-200",
  部分付款: "bg-blue-100 text-blue-800 border-blue-200",
  已付訂金: "bg-blue-100 text-blue-800 border-blue-200",
  已結清: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function relCustomerName(customers: unknown): string {
  if (!customers) return "";
  const c = customers as { name?: string } | { name?: string }[];
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name ?? "";
}

function relCustomerAlias(customers: unknown): string | null {
  if (!customers) return null;
  const c = customers as { alias?: string | null } | { alias?: string | null }[];
  const a = Array.isArray(c) ? c[0]?.alias : c.alias;
  return a != null && String(a).trim() ? String(a) : null;
}

function asArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function buildItemLabel(oi: {
  custom_name?: string | null;
  custom_dimension_w?: number | null;
  custom_dimension_d?: number | null;
  custom_dimension_h?: number | null;
  product_variants?: unknown;
}): string {
  const variant = oi.product_variants;
  const v = asArray(variant)[0] as
    | {
        product_code?: string | null;
        dimension_w?: number | null;
        dimension_d?: number | null;
        dimension_h?: number | null;
      }
    | undefined;

  let itemName = "";
  if (oi.custom_name) itemName = String(oi.custom_name);
  else if (v?.product_code) itemName = String(v.product_code);

  const w = oi.custom_dimension_w ?? v?.dimension_w ?? null;
  const d = oi.custom_dimension_d ?? v?.dimension_d ?? null;
  const h = oi.custom_dimension_h ?? v?.dimension_h ?? null;
  const parts = [w, d, h].filter((x) => x != null);
  const dim =
    parts.length === 0
      ? ""
      : `W:${w ?? "—"} × D:${d ?? "—"} × H:${h ?? "—"}`;

  const bits = [itemName, dim].filter((s) => typeof s === "string" && s.trim());
  return bits.join(" / ") || "—";
}

export type OverviewOrder = {
  id: string;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_alias: string | null;
  shipping_contact_name: string | null;
  /** 訂單內所有工單 planned_end_date 之最晚日；皆無則遞補為訂單預計交貨日（見 parse） */
  planned_end_order_max: string | null;
  lines: OverviewLine[];
};

export type OverviewLine = {
  order_item_id: string;
  quantity: number;
  item_label: string;
  /** 規格圖優先，否則系列主視覺 */
  thumbnail_url: string | null;
  stage: WorkOrderStage;
  assignee: string | null;
  planned_end_date: string | null;
  expected_delivery_date: string | null;
  has_work_order: boolean;
};

const ORDER_OVERVIEW_SELECT = `
        id,
        order_number,
        order_date,
        expected_delivery_date,
        status,
        payment_status,
        shipping_contact_name,
        customers(name, alias),
        order_items(
          id,
          quantity,
          custom_name,
          custom_category,
          custom_description,
          custom_dimension_w,
          custom_dimension_d,
          custom_dimension_h,
          product_variants(
            product_code,
            dimension_w,
            dimension_d,
            dimension_h,
            image_url,
            product_series(image_url)
          ),
          work_orders(
            id,
            stage,
            assignee_id,
            employees!assignee_id(name),
            planned_start_date,
            planned_end_date
          )
        )
      `;

function parseOrdersPayload(data: unknown[]): OverviewOrder[] {
  return (data as any[]).map((row) => {
    const customerName = relCustomerName(row.customers);
    const customerAlias = relCustomerAlias(row.customers);
    const oiList = asArray(row.order_items);

    const lines: OverviewLine[] = oiList.map((oi: any) => {
      const wos = asArray(oi.work_orders);
      const wo = wos[0] as
        | {
            stage?: string | null;
            assignee_id?: string | null;
            employees?: { name?: string | null } | { name?: string | null }[] | null;
            planned_end_date?: string | null;
          }
        | undefined;

      const linePlannedEnd = maxPlannedEndDate(
        wos.map((w: { planned_end_date?: string | null }) => w.planned_end_date)
      );

      const stage = wo?.stage
        ? normalizeWorkOrderStage(wo.stage)
        : DEFAULT_WORK_ORDER_STAGE;
      const has_work_order = wos.length > 0;
      const empRel = wo?.employees;
      const empOne = Array.isArray(empRel) ? empRel[0] : empRel;
      const assigneeName =
        empOne?.name != null && String(empOne.name).trim()
          ? String(empOne.name).trim()
          : null;

      const pvRaw = asArray(oi.product_variants)[0] as
        | {
            image_url?: string | null;
            product_series?: { image_url?: string | null } | { image_url?: string | null }[] | null;
          }
        | undefined;
      let thumbnail_url: string | null = null;
      if (pvRaw) {
        const vi =
          pvRaw.image_url != null && String(pvRaw.image_url).trim()
            ? String(pvRaw.image_url).trim()
            : null;
        const sr = pvRaw.product_series;
        const sOne = Array.isArray(sr) ? sr[0] : sr;
        const si =
          sOne?.image_url != null && String(sOne.image_url).trim()
            ? String(sOne.image_url).trim()
            : null;
        thumbnail_url = vi ?? si ?? null;
      }

      return {
        order_item_id: String(oi.id ?? ""),
        quantity: Number(oi.quantity ?? 0),
        item_label: buildItemLabel(oi),
        thumbnail_url,
        stage,
        assignee: assigneeName,
        planned_end_date: linePlannedEnd,
        expected_delivery_date: row.expected_delivery_date ?? null,
        has_work_order,
      };
    });

    lines.sort((a, b) => workOrderStageSortIndex(a.stage) - workOrderStageSortIndex(b.stage));

    const fromWorkOrders = maxPlannedEndDate(lines.map((l) => l.planned_end_date));
    const exp =
      row.expected_delivery_date != null && String(row.expected_delivery_date).trim()
        ? String(row.expected_delivery_date).slice(0, 10)
        : null;
    const planned_end_order_max = fromWorkOrders ?? exp ?? null;

    return {
      id: String(row.id),
      order_number: String(row.order_number ?? ""),
      order_date: row.order_date ?? null,
      expected_delivery_date: row.expected_delivery_date ?? null,
      status: String(row.status ?? ""),
      payment_status: String(row.payment_status ?? ""),
      customer_name: customerName,
      customer_alias: customerAlias,
      shipping_contact_name:
        row.shipping_contact_name != null && String(row.shipping_contact_name).trim()
          ? String(row.shipping_contact_name)
          : null,
      planned_end_order_max,
      lines,
    };
  });
}

export async function fetchOrderOverviewById(
  orderId: string
): Promise<OverviewOrder | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_OVERVIEW_SELECT)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[fetchOrderOverviewById]", error);
    return null;
  }
  if (!data) return null;
  const parsed = parseOrdersPayload([data] as unknown[]);
  return parsed[0] ?? null;
}

function openOrderInManagement(orderId: string) {
  if (typeof window === "undefined") return;
  const encoded = encodeURIComponent(orderId);
  window.location.href = `/?page=orders#orders:${encoded}`;
}

export function OrderOverviewCard({
  order,
  variant = "page",
  onEditOrder,
  showEditButton = true,
  /** 通路／精簡檢視：米色摘要區，贴近訂單總覽示意 */
  visualTone = "default",
}: {
  order: OverviewOrder;
  variant?: "page" | "dialog";
  onEditOrder?: () => void;
  /** dialog 時是否顯示「編輯訂單」（通路客戶端可關閉） */
  showEditButton?: boolean;
  visualTone?: "default" | "warm";
}) {
  const warm = visualTone === "warm";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        warm ? "border-[#E6DFD3]" : "border-border"
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-3 border-b px-4 py-3 sm:p-4",
          warm ? "border-[#E6DFD3] bg-[#F4EFE8]" : "border-border bg-muted/30"
        )}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
            <span className="font-mono text-base font-semibold tabular-nums text-foreground">
              {order.order_number || "—"}
            </span>
            <span className="text-sm font-medium text-foreground min-w-0">
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="truncate">
                  {order.customer_name || "—"}
                  {order.customer_alias ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({order.customer_alias})
                    </span>
                  ) : null}
                </span>
                {order.shipping_contact_name?.trim() ? (
                  <span className="text-xs font-normal text-muted-foreground break-words">
                    {order.shipping_contact_name.trim()}
                  </span>
                ) : null}
              </span>
            </span>
          </div>
          {variant === "page" ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 shrink-0 w-fit px-3 text-xs"
              onClick={() => openOrderInManagement(order.id)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              訂單管理開啟
            </Button>
          ) : showEditButton !== false ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 shrink-0 w-fit px-3 text-xs"
              onClick={onEditOrder}
              disabled={!onEditOrder}
            >
              編輯訂單
            </Button>
          ) : null}
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 text-xs",
            warm ? "text-[#5c574f]" : "text-muted-foreground"
          )}
        >
          <Badge
            variant="outline"
            className={cn(
              "font-normal",
              orderStatusBadgeClass[order.status] ?? "border-border"
            )}
          >
            {order.status || "—"}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "font-normal",
              paymentStatusBadgeClass[order.payment_status] ?? "border-border"
            )}
          >
            {order.payment_status || "—"}
          </Badge>
          {order.order_date && (
            <span className="tabular-nums">下單 {formatDateYyMmDd(order.order_date)}</span>
          )}
          {order.expected_delivery_date && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarDays className="h-3 w-3 shrink-0" />
              交期 {formatDateYyMmDd(order.expected_delivery_date)}
            </span>
          )}
          {order.planned_end_order_max && (
            <span className="inline-flex items-center gap-1 tabular-nums" title="訂單內各工單預計完成日之最晚者">
              <CalendarDays className="h-3 w-3 shrink-0" />
              預計完成 {formatDateYyMmDd(order.planned_end_order_max)}
            </span>
          )}
        </div>
      </div>

      <Table
        className="table-fixed w-full min-w-0 text-xs"
        wrapperClassName="overflow-x-visible"
      >
        <TableHeader>
          <TableRow
            className={cn(
              "hover:bg-transparent border-b",
              warm ? "border-[#E8E0D4] bg-[#FAF8F4]" : "border-border"
            )}
          >
            <TableHead className="w-[40%] min-w-0 px-2 text-xs font-semibold whitespace-normal">
              品項
            </TableHead>
            <TableHead className="w-11 min-w-0 px-1 text-right text-xs font-semibold whitespace-normal">
              數量
            </TableHead>
            <TableHead className="w-[18%] min-w-0 px-1 text-xs font-semibold whitespace-normal">
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {variant === "dialog" ? "負責" : "負責窗口"}
              </span>
            </TableHead>
            <TableHead className="w-[22%] min-w-0 px-1 text-xs font-semibold whitespace-normal">
              {variant === "dialog" ? "工序" : "工序／進度"}
            </TableHead>
            <TableHead className="w-[18%] min-w-0 px-1 text-xs font-semibold whitespace-normal">
              <span
                className="inline-flex items-center gap-1"
                title="同訂單各品項工單中之最晚預計完成日"
              >
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                預計完成（全單最晚）
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center whitespace-normal">
                此訂單尚無品項。
              </TableCell>
            </TableRow>
          ) : (
            order.lines.map((line) => {
              const stage = line.stage;
              return (
                <TableRow
                  key={line.order_item_id}
                  className={cn("border-b", warm ? "border-[#EEE8DE]" : "border-border")}
                >
                  <TableCell className="p-2 align-top text-xs whitespace-normal break-words">
                    <div className="flex gap-2 items-start min-w-0">
                      <VariantSeriesThumb
                        imageUrl={line.thumbnail_url}
                        sizeClassName="h-10 w-10"
                        compactPlaceholder
                        className={warm ? "border-[#E0D8CC] bg-white/80" : undefined}
                      />
                      <span className="line-clamp-4 text-foreground min-w-0">{line.item_label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="p-2 align-top text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : "—"}
                  </TableCell>
                  <TableCell className="p-2 align-top text-xs whitespace-normal break-words">
                    {line.assignee ? (
                      <span className="inline-flex items-start gap-1 text-foreground">
                        <User className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        {line.assignee}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-2 align-top text-xs whitespace-normal">
                    {line.has_work_order ? (
                      <span
                        className={cn(
                          "inline-flex max-w-full rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
                          stageStyleClassName(stage)
                        )}
                      >
                        {stage}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-md border border-dashed border-muted-foreground/40 bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        尚無工單
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="p-2 align-top text-[11px] tabular-nums text-muted-foreground whitespace-normal break-words">
                    {order.planned_end_order_max
                      ? formatDateYyMmDd(order.planned_end_order_max)
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function OrdersOverviewPage() {
  const [rows, setRows] = useState<OverviewOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hideClosed, setHideClosed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_OVERVIEW_SELECT)
      .order("order_date", { ascending: false });

    if (error) {
      console.error("[orders-overview]", error);
      toast.error("訂單總覽讀取失敗");
      setRows([]);
      setLoading(false);
      return;
    }

    const parsed = parseOrdersPayload((data ?? []) as unknown[]);
    setRows(parsed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((o) => {
      if (hideClosed && o.status === "結案") return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_alias && o.customer_alias.toLowerCase().includes(q)) ||
        o.lines.some((l) => l.item_label.toLowerCase().includes(q)) ||
        (o.shipping_contact_name && o.shipping_contact_name.toLowerCase().includes(q))
      );
    });
  }, [rows, search, hideClosed]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const cmpStatus = orderStatusSortIndex(a.status) - orderStatusSortIndex(b.status);
      if (cmpStatus !== 0) return cmpStatus;
      const da = a.expected_delivery_date ?? "";
      const db = b.expected_delivery_date ?? "";
      if (da !== db) return da.localeCompare(db);
      return b.order_number.localeCompare(a.order_number, "zh-Hant", { numeric: true });
    });
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入訂單總覽中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4 shrink-0" />
            <span className="text-xs">依訂單彙整品項 · 負責人與工序進度</span>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            每張訂單一張卡片：上方為訂單主檔與客戶；下方表格為各品項在生產工單上的負責窗口與工序。若品項尚無工單，工序顯示為「待排程」且負責人為「—」。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => void load()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新整理
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="搜尋訂單編號、客戶、品項…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              "h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            aria-label="搜尋訂單"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
            className="rounded border-input"
          />
          隱藏已結案
        </label>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "目前沒有訂單資料。"
            : "沒有符合條件的訂單，請調整搜尋或篩選。"}
        </div>
      ) : (
        <ul className="flex flex-col gap-5">
          {sorted.map((order) => (
            <li key={order.id}>
              <OrderOverviewCard order={order} variant="page" />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        顯示 {sorted.length} / {rows.length} 筆訂單
        {hideClosed ? "（已隱藏結案）" : ""}
      </p>
    </div>
  );
}
