"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import {
  formatSeatHeightCmLabel,
  isChairCh03FamilyProductCode,
  resolveSeatHeightCmForDisplay,
} from "@/lib/chair-product-code";
import { parseExplanationImages, type ExplanationImage } from "@/lib/explanation-images";
import { stripSpecSuffixCodes } from "@/lib/strip-spec-suffix";
import { ORDER_OVERVIEW_SELECT } from "@/lib/order-overview-select";
import { appendArmHeight } from "@/lib/product-arm-height";

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
  "已退貨",
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
  已退貨: "bg-rose-100 text-rose-800 border-rose-200",
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
  seat_height_cm?: number | null;
  product_variants?: unknown;
}): string {
  const variant = oi.product_variants;
  const v = asArray(variant)[0] as
    | {
        product_code?: string | null;
        dimension_w?: number | null;
        dimension_d?: number | null;
        dimension_h?: number | null;
        seat_height_cm?: number | null;
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
  let label = bits.join(" / ") || "—";

  const code = v?.product_code != null ? String(v.product_code).trim() : "";
  const seatCm = resolveSeatHeightCmForDisplay(oi.seat_height_cm, v?.seat_height_cm);
  if (isChairCh03FamilyProductCode(code) && seatCm != null) {
    const sh = formatSeatHeightCmLabel(seatCm);
    label = label === "—" ? sh : `${label} · ${sh}`;
  }

  return label;
}

export type OverviewOrder = {
  id: string;
  customer_id: string | null;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_alias: string | null;
  shipping_contact_name: string | null;
  shipping_contact_phone: string | null;
  shipping_address: string | null;
  shipping_has_elevator: boolean | null;
  internal_notes: string | null;
  total_amount: number;
  deposit_amount: number;
  shipping_fee: number;
  explanation_images: ExplanationImage[];
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
  /** 明細設計圖：order_items.image_url 優先，否則規格／系列圖 */
  image_url: string | null;
  item_name: string;
  /** 產品編號（客製品項為 null） */
  product_code: string | null;
  wood_type: string | null;
  dimension_text: string | null;
  spec_text: string | null;
  unit_price: number;
  custom_notes: string | null;
  description: string | null;
  stage: WorkOrderStage;
  assignee: string | null;
  planned_end_date: string | null;
  expected_delivery_date: string | null;
  has_work_order: boolean;
};

function itemWoodType(r: { wood_type?: unknown }): string | null {
  const w = r.wood_type;
  if (w == null || String(w).trim() === "") return null;
  return String(w).trim();
}

function buildLineDetail(oi: any): {
  item_name: string;
  product_code: string | null;
  image_url: string | null;
  wood_type: string | null;
  dimension_text: string | null;
  spec_text: string | null;
  unit_price: number;
  custom_notes: string | null;
  description: string | null;
} {
  const variant = asArray(oi.product_variants)[0] as
    | {
        product_code?: string | null;
        spec1?: string | null;
        wood_type?: string | null;
        dimension_w?: number | null;
        dimension_d?: number | null;
        dimension_h?: number | null;
        seat_height_cm?: number | null;
        arm_height_cm?: number | null;
        image_url?: string | null;
        product_series?:
          | { series_name?: string | null; image_url?: string | null }
          | { series_name?: string | null; image_url?: string | null }[]
          | null;
      }
    | undefined;

  const seriesRaw = variant?.product_series;
  const series = Array.isArray(seriesRaw) ? seriesRaw[0] : seriesRaw;

  const variantImg =
    variant?.image_url != null && String(variant.image_url).trim()
      ? String(variant.image_url).trim()
      : null;
  const seriesImg =
    series?.image_url != null && String(series.image_url).trim()
      ? String(series.image_url).trim()
      : null;
  const itemImg =
    oi.image_url != null && String(oi.image_url).trim() ? String(oi.image_url).trim() : null;
  const image_url = itemImg ?? variantImg ?? seriesImg ?? null;

  const lineSeat = oi.seat_height_cm != null ? Number(oi.seat_height_cm) : NaN;
  /** 尺寸格式：W58 D55 H75（缺值欄位省略） */
  const formatDims = (
    w: number | null | undefined,
    d: number | null | undefined,
    h: number | null | undefined,
  ): string | null => {
    const parts: string[] = [];
    if (w != null) parts.push(`W${w}`);
    if (d != null) parts.push(`D${d}`);
    if (h != null) parts.push(`H${h}`);
    return parts.length ? parts.join(" ") : null;
  };
  const hasDims =
    oi.custom_dimension_w != null ||
    oi.custom_dimension_d != null ||
    oi.custom_dimension_h != null;
  let dimText: string | null = hasDims
    ? formatDims(oi.custom_dimension_w, oi.custom_dimension_d, oi.custom_dimension_h)
    : null;

  const isCustom = !oi.variant_id;
  let item_name = "—";
  let description: string | null = null;
  let spec_text: string | null = null;

  if (isCustom) {
    if (oi.custom_name) item_name = String(oi.custom_name);
    else if (oi.custom_category) item_name = String(oi.custom_category);
    else item_name = "客製品項";
    if (oi.custom_description) description = String(oi.custom_description);
  } else {
    item_name =
      (series?.series_name != null && String(series.series_name).trim()
        ? String(series.series_name).trim()
        : null) ||
      (variant?.product_code != null ? String(variant.product_code) : null) ||
      "產品項目";
    if (!dimText && variant) {
      dimText = formatDims(variant.dimension_w, variant.dimension_d, variant.dimension_h);
    }
    const rawSpec = variant?.spec1 != null ? String(variant.spec1) : "";
    spec_text = stripSpecSuffixCodes(rawSpec) || null;
  }

  if (dimText && Number.isFinite(lineSeat)) {
    dimText = `${dimText} 座高:${lineSeat}cm`;
  } else if (!dimText && Number.isFinite(lineSeat)) {
    dimText = `座高:${lineSeat}cm`;
  } else if (
    dimText &&
    !Number.isFinite(lineSeat) &&
    variant?.seat_height_cm != null &&
    Number.isFinite(Number(variant.seat_height_cm))
  ) {
    dimText = `${dimText} 座高:${Number(variant.seat_height_cm)}cm`;
  }

  // 扶手高度取自規格庫；未填寫者不加這一段
  dimText = appendArmHeight(dimText, variant?.arm_height_cm, " ", true);

  return {
    item_name,
    product_code:
      variant?.product_code != null && String(variant.product_code).trim()
        ? String(variant.product_code).trim()
        : null,
    image_url,
    wood_type: itemWoodType(oi) ?? (variant?.wood_type != null ? String(variant.wood_type).trim() : null),
    dimension_text: dimText,
    spec_text,
    unit_price: Number(oi.unit_price ?? 0),
    custom_notes: oi.custom_notes != null ? String(oi.custom_notes) : null,
    description,
  };
}

export function parseOrdersPayload(data: unknown[]): OverviewOrder[] {
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

      const detail = buildLineDetail(oi);

      return {
        order_item_id: String(oi.id ?? ""),
        quantity: Number(oi.quantity ?? 0),
        item_label: buildItemLabel(oi),
        thumbnail_url,
        image_url: detail.image_url,
        item_name: detail.item_name,
        product_code: detail.product_code,
        wood_type: detail.wood_type,
        dimension_text: detail.dimension_text,
        spec_text: detail.spec_text,
        unit_price: detail.unit_price,
        custom_notes: detail.custom_notes,
        description: detail.description,
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
      customer_id:
        row.customer_id != null && String(row.customer_id).trim()
          ? String(row.customer_id)
          : null,
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
      shipping_contact_phone:
        row.shipping_contact_phone != null && String(row.shipping_contact_phone).trim()
          ? String(row.shipping_contact_phone)
          : null,
      shipping_address:
        row.shipping_address != null && String(row.shipping_address).trim()
          ? String(row.shipping_address)
          : null,
      shipping_has_elevator:
        row.shipping_has_elevator === true
          ? true
          : row.shipping_has_elevator === false
            ? false
            : null,
      internal_notes:
        row.internal_notes != null && String(row.internal_notes).trim()
          ? String(row.internal_notes)
          : null,
      total_amount: Number(row.total_amount ?? 0),
      deposit_amount: Number(row.deposit_amount ?? 0),
      shipping_fee: Number(row.shipping_fee ?? 0),
      explanation_images: parseExplanationImages(row.explanation_image_url),
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
    .is("deleted_at", null)
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
  window.location.href = `/?page=orders&openOrder=${encoded}`;
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function OrderFullDetailSections({
  order,
}: {
  order: OverviewOrder;
}) {
  const itemsSubtotal = order.lines.reduce(
    (sum, l) => sum + l.quantity * l.unit_price,
    0
  );
  const balance = Math.max(0, order.total_amount - order.deposit_amount);
  const hasShipping =
    order.shipping_address?.trim() ||
    order.shipping_contact_phone?.trim() ||
    order.shipping_has_elevator != null;
  const borderCls = "border-border";
  const mutedBg = "bg-muted/30";

  return (
    <div className={cn("flex flex-col gap-4 border-t px-4 py-4 sm:px-5", borderCls)}>
      {(hasShipping || order.internal_notes?.trim()) && (
        <div className="flex flex-col gap-1.5">
          {hasShipping ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">配送資訊</span>
              {order.shipping_contact_name?.trim() ? (
                <span>收貨人 <span className="text-foreground">{order.shipping_contact_name.trim()}</span></span>
              ) : null}
              {order.shipping_contact_phone?.trim() ? (
                <span>電話 <span className="text-foreground tabular-nums">{order.shipping_contact_phone.trim()}</span></span>
              ) : null}
              {order.shipping_address?.trim() ? (
                <span>地址 <span className="text-foreground break-words">{order.shipping_address.trim()}</span></span>
              ) : null}
              {order.shipping_has_elevator != null ? (
                <span>電梯 <span className="text-foreground">{order.shipping_has_elevator ? "有" : "無"}</span></span>
              ) : null}
            </div>
          ) : null}
          {order.internal_notes?.trim() ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">訂單備註</span>
              <span className="whitespace-pre-line break-words">{order.internal_notes.trim()}</span>
            </div>
          ) : null}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">訂單明細</p>
        <div className={cn("overflow-x-auto rounded-lg border", borderCls)}>
          <table className="w-full min-w-[860px] text-xs">
            <thead>
              <tr className={cn("border-b text-left", borderCls, mutedBg)}>
                <th className="w-16 px-2 py-2 font-semibold">設計圖</th>
                <th className="min-w-[7rem] px-2 py-2 font-semibold">品項</th>
                <th className="w-14 px-2 py-2 font-semibold">木種</th>
                <th className="min-w-[8rem] px-2 py-2 font-semibold">尺寸(cm)</th>
                <th className="min-w-[5rem] px-2 py-2 font-semibold">規格</th>
                <th className="w-10 px-2 py-2 text-right font-semibold">數量</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">單價</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">小計</th>
                <th className="min-w-[4rem] px-2 py-2 font-semibold">工序</th>
                <th className="min-w-[3.5rem] px-2 py-2 font-semibold">負責</th>
                <th className="min-w-[5rem] px-2 py-2 font-semibold whitespace-nowrap">預計完成</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                    此訂單尚無品項。
                  </td>
                </tr>
              ) : (
                order.lines.map((line) => {
                  const notes = [line.description, line.custom_notes]
                    .map((t) => t?.trim())
                    .filter(Boolean)
                    .join("\n");
                  const lineTotal = line.quantity * line.unit_price;
                  return (
                    <Fragment key={line.order_item_id}>
                      <tr className="border-b border-border align-top">
                        <td className="p-2">
                          {line.image_url ? (
                            <div className="h-14 w-14 overflow-hidden rounded border border-border bg-muted/40">
                              <img
                                src={line.image_url}
                                alt={line.item_name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : (
                            <VariantSeriesThumb
                              imageUrl={line.thumbnail_url}
                              sizeClassName="h-14 w-14"
                              compactPlaceholder
                            />
                          )}
                        </td>
                        <td className="p-2 font-medium text-foreground break-words">{line.item_name}</td>
                        <td className="p-2 text-muted-foreground break-words">{line.wood_type ?? "—"}</td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">{line.dimension_text ?? "—"}</td>
                        <td className="p-2 font-mono text-muted-foreground break-words">{line.spec_text ?? "—"}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">{line.quantity}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {line.unit_price.toLocaleString()}
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium text-foreground">
                          {lineTotal.toLocaleString()}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {line.has_work_order ? (
                            <span
                              className={cn(
                                "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
                                stageStyleClassName(line.stage)
                              )}
                            >
                              {line.stage}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-md border border-dashed border-muted-foreground/40 bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              尚無工單
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {line.assignee ? (
                            <span className="inline-flex items-center gap-1 text-foreground">
                              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                              {line.assignee}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground tabular-nums whitespace-nowrap">
                          {order.planned_end_order_max
                            ? formatDateYyMmDd(order.planned_end_order_max)
                            : "—"}
                        </td>
                      </tr>
                      {notes ? (
                        <tr className="border-b border-border">
                          <td className="px-2 py-1.5 text-muted-foreground align-top">備註</td>
                          <td colSpan={10} className="px-2 py-1.5 text-muted-foreground whitespace-pre-line break-words">
                            {notes}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs",
          borderCls,
          mutedBg
        )}
      >
        <span className="text-muted-foreground">
          商品小計 <span className="tabular-nums text-foreground">{itemsSubtotal.toLocaleString()}</span>
        </span>
        <span className="text-muted-foreground">
          運費 <span className="tabular-nums text-foreground">{order.shipping_fee.toLocaleString()}</span>
        </span>
        <span className="text-muted-foreground">
          訂單總額 <span className="tabular-nums font-semibold text-foreground">{formatCurrency(order.total_amount)}</span>
        </span>
        <span className="text-muted-foreground">
          已收訂金 <span className="tabular-nums text-foreground">{order.deposit_amount.toLocaleString()}</span>
        </span>
        <span className="text-muted-foreground">
          尾款 <span className="tabular-nums font-medium text-foreground">{balance.toLocaleString()}</span>
        </span>
      </div>

      {order.explanation_images.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold text-foreground">設計圖面／訂單說明</p>
          <div className="space-y-4">
            {order.explanation_images.map((img, idx) => (
              <div key={idx} className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  {img.title?.trim() ? img.title : `說明圖 ${idx + 1}`}
                </p>
                <div className={cn("overflow-hidden rounded-lg border bg-muted/20", borderCls)}>
                  <img
                    src={img.url}
                    alt={img.title?.trim() ? img.title : `說明圖 ${idx + 1}`}
                    className="w-full max-h-[480px] object-contain"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OrderOverviewCard({
  order,
  variant = "page",
  onEditOrder,
  showEditButton = true,
  /** 完整訂單：明細、設計圖、金額與配送資訊 */
  detailLevel = "summary",
}: {
  order: OverviewOrder;
  variant?: "page" | "dialog";
  onEditOrder?: () => void;
  /** dialog 時是否顯示「編輯訂單」（通路客戶端可關閉） */
  showEditButton?: boolean;
  /** 視覺分支已統一為語意 token；保留 prop 以維持對外介面 */
  visualTone?: "default" | "warm";
  detailLevel?: "summary" | "full";
}) {
  const full = detailLevel === "full";
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3 sm:p-4">
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
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

      {full ? <OrderFullDetailSections order={order} /> : null}

      {/* 精簡檢視：品項負責人與工序進度表（完整檢視已併入訂單明細） */}
      {!full ? (
      <>
      {/* 欄位皆不換行；容器（ui/table 外層）在寬度不足時整表橫向捲動（含手機） */}
      <Table className="min-w-[48rem] w-full text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
            <TableHead className="px-2 text-xs font-semibold whitespace-nowrap">
              品項
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
              木種
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
              尺寸
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
              規格
            </TableHead>
            <TableHead className="px-1 text-right text-xs font-semibold whitespace-nowrap">
              數量
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {variant === "dialog" ? "負責" : "負責窗口"}
              </span>
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
              {variant === "dialog" ? "工序" : "工序／進度"}
            </TableHead>
            <TableHead className="px-1 text-xs font-semibold whitespace-nowrap">
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
              <TableCell colSpan={8} className="text-sm text-muted-foreground py-6 text-center whitespace-normal">
                此訂單尚無品項。
              </TableCell>
            </TableRow>
          ) : (
            order.lines.map((line) => {
              const stage = line.stage;
              const itemDisplay = line.product_code
                ? `${line.product_code} ${line.item_name}`
                : line.item_name;
              return (
                <TableRow key={line.order_item_id} className="border-b border-border">
                  <TableCell className="p-2 align-middle text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {full && line.image_url ? (
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-muted/40">
                          <img
                            src={line.image_url}
                            alt={line.item_name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : (
                      <VariantSeriesThumb
                        imageUrl={line.thumbnail_url}
                        sizeClassName="h-10 w-10"
                        compactPlaceholder
                      />
                      )}
                      <span className="text-foreground">{itemDisplay}</span>
                    </div>
                  </TableCell>
                  <TableCell className="p-2 align-middle text-xs text-muted-foreground whitespace-nowrap">
                    {line.wood_type || "—"}
                  </TableCell>
                  <TableCell className="p-2 align-middle text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {line.dimension_text || "—"}
                  </TableCell>
                  <TableCell className="p-2 align-middle text-xs text-muted-foreground whitespace-nowrap">
                    {line.spec_text || "—"}
                  </TableCell>
                  <TableCell className="p-2 align-middle text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : "—"}
                  </TableCell>
                  <TableCell className="p-2 align-middle text-xs whitespace-nowrap">
                    {line.assignee ? (
                      <span className="inline-flex items-center gap-1 text-foreground">
                        <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                        {line.assignee}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-2 align-middle text-xs whitespace-nowrap">
                    {line.has_work_order ? (
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
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
                  <TableCell className="p-2 align-middle text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
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
      </>
      ) : null}
    </div>
  );
}

type OverviewCustomerRow = {
  id: string;
  name: string;
  channel_id: string | null;
};

export function OrdersOverviewPage() {
  const [rows, setRows] = useState<OverviewOrder[]>([]);
  const [customers, setCustomers] = useState<OverviewCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [hideClosed, setHideClosed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [ordersRes, customersRes] = await Promise.all([
      supabase.from("orders").select(ORDER_OVERVIEW_SELECT).is("deleted_at", null).order("order_date", { ascending: false }),
      supabase.from("customers").select("id, name, channel_id").order("name", { ascending: true }),
    ]);

    const { data, error } = ordersRes;
    if (!customersRes.error && customersRes.data) {
      setCustomers(
        (customersRes.data as any[]).map((c) => ({
          id: String(c.id),
          name: String(c.name ?? ""),
          channel_id:
            c.channel_id != null && String(c.channel_id).trim() ? String(c.channel_id) : null,
        }))
      );
    } else {
      setCustomers([]);
    }

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

  /** 主檔客戶 + 訂單曾出現但主檔可能缺漏的 customer_id；通路客戶置頂並標示 [通路]（與訂單管理一致） */
  const customerFilterOptions = useMemo(() => {
    const byId = new Map<string, { name: string; channelId: string | null }>();
    customers.forEach((c) => {
      const ch = c.channel_id != null && String(c.channel_id).trim() ? String(c.channel_id) : null;
      byId.set(c.id, { name: c.name, channelId: ch });
    });
    rows.forEach((o) => {
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
  }, [customers, rows]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((o) => {
      if (hideClosed && o.status === "結案") return false;
      if (customerFilter && o.customer_id !== customerFilter) return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_alias && o.customer_alias.toLowerCase().includes(q)) ||
        o.lines.some((l) => l.item_label.toLowerCase().includes(q)) ||
        (o.shipping_contact_name && o.shipping_contact_name.toLowerCase().includes(q))
      );
    });
  }, [rows, search, hideClosed, customerFilter]);

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
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">客戶</span>
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="h-9 min-w-[10rem] max-w-[min(100vw-2rem,18rem)] rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
