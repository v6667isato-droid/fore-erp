"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowBigUp, Hand } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/use-require-auth";

interface AddressLabelOrder {
  id: string;
  order_number: string;
  customer_name: string;
  shipping_contact_name: string | null;
  shipping_contact_phone: string | null;
  shipping_has_elevator: boolean | null;
  shipping_address: string | null;
  /** 客戶主檔：訂單欄位空白時備援 */
  customer_contact_person: string | null;
  customer_phone: string | null;
  customer_address: string | null;
}

interface AddressLabelItem {
  id: string;
  name: string;
  quantity: number;
}

function seriesNameFromVariant(variant: {
  product_series?: { series_name?: string } | { series_name?: string }[] | null;
} | null): string {
  if (!variant) return "";
  const ps = variant.product_series;
  if (Array.isArray(ps)) return String(ps[0]?.series_name ?? "").trim();
  if (ps && typeof ps === "object")
    return String((ps as { series_name?: string }).series_name ?? "").trim();
  return "";
}

/** 出貨品項：系列, 名稱 (代碼)，尺寸另附於後 */
function formatShippingItemLine(
  r: any,
  idx: number,
  variant: any | null
): string {
  const w = r.custom_dimension_w ?? variant?.dimension_w ?? null;
  const d = r.custom_dimension_d ?? variant?.dimension_d ?? null;
  const h = r.custom_dimension_h ?? variant?.dimension_h ?? null;
  const hasDim = w != null || d != null || h != null;
  const dimSuffix = hasDim
    ? ` · ${w ?? "—"}×${d ?? "—"}×${h ?? "—"} cm`
    : "";

  const isCustom = !r.variant_id;
  if (isCustom) {
    const series = String(r.custom_category ?? "").trim() || "客製";
    const nm = String(r.custom_name ?? "").trim() || "—";
    return `${series}, ${nm}${dimSuffix}`;
  }

  if (!variant) {
    return `—, 品項 ${idx + 1}${dimSuffix}`;
  }

  const series = seriesNameFromVariant(variant) || "—";
  const code = String(variant?.product_code ?? "").trim();
  const spec1 = String(variant?.spec1 ?? "").trim();
  const customOverride = String(r.custom_name ?? "").trim();
  const namePart = customOverride || spec1 || code || "—";

  let core: string;
  if (code && namePart === code) {
    core = `${series}, ${code}`;
  } else if (code) {
    core = `${series}, ${namePart} (${code})`;
  } else {
    core = `${series}, ${namePart}`;
  }

  return `${core}${dimSuffix}`;
}

export default function AddressLabelPage() {
  const params = useParams<{ orderId: string }>();
  const rawOrderId = params?.orderId;
  const orderId = typeof rawOrderId === "string" ? decodeURIComponent(rawOrderId) : undefined;
  const { ready: authReady } = useRequireAuth();

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<AddressLabelOrder | null>(null);
  const [items, setItems] = useState<AddressLabelItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showShippingInfo, setShowShippingInfo] = useState(true);
  const [showItems, setShowItems] = useState(true);
  const [labelCount, setLabelCount] = useState(1);
  const [markHandleWithCare, setMarkHandleWithCare] = useState(false);
  const [markFragile, setMarkFragile] = useState(false);
  const [markThisSideUp, setMarkThisSideUp] = useState(false);

  useEffect(() => {
    if (!orderId || !authReady) return;
    const safeOrderId = orderId;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: orderRow, error: orderErr } = await supabase
          .from("orders")
          .select(
            "id, order_number, shipping_address, shipping_contact_name, shipping_contact_phone, shipping_has_elevator, customers(name, contact_person, phone, delivery_address)"
          )
          .eq("id", safeOrderId)
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || "找不到此訂單");
        }

        const custRaw =
          (orderRow.customers &&
            (Array.isArray(orderRow.customers)
              ? orderRow.customers[0]
              : orderRow.customers)) ||
          null;

        const orderData: AddressLabelOrder = {
          id: String(orderRow.id),
          order_number: String(orderRow.order_number ?? ""),
          customer_name: custRaw?.name ?? "",
          shipping_contact_name: orderRow.shipping_contact_name ?? null,
          shipping_contact_phone: orderRow.shipping_contact_phone ?? null,
          shipping_has_elevator:
            orderRow.shipping_has_elevator === true || orderRow.shipping_has_elevator === false
              ? orderRow.shipping_has_elevator
              : null,
          shipping_address: orderRow.shipping_address ?? null,
          customer_contact_person: custRaw?.contact_person ?? null,
          customer_phone: custRaw?.phone ?? null,
          customer_address: custRaw?.delivery_address ?? null,
        };

        const { data: itemRows, error: itemErr } = await supabase
          .from("order_items")
          .select(
            "id, variant_id, quantity, custom_name, custom_category, custom_dimension_w, custom_dimension_d, custom_dimension_h, product_variants(product_code, spec1, dimension_w, dimension_d, dimension_h, product_series(series_name))"
          )
          .eq("order_id", safeOrderId)
          .order("line_order", { ascending: true })
          .order("id", { ascending: true });

        if (itemErr) {
          throw new Error(itemErr.message || "讀取訂單品項失敗");
        }

        const mappedItems: AddressLabelItem[] = (itemRows ?? []).map((r: any, idx: number) => {
          const variantRaw = r.product_variants;
          const variant =
            variantRaw && !Array.isArray(variantRaw)
              ? variantRaw
              : Array.isArray(variantRaw)
                ? variantRaw[0]
                : null;

          const name = formatShippingItemLine(r, idx, variant);

          return {
            id: String(r.id ?? `item-${idx}`),
            name,
            quantity: Number(r.quantity ?? 1),
          };
        });

        setOrder(orderData);
        setItems(mappedItems);
      } catch (err) {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : "讀取地址條資料失敗");
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [orderId, authReady]);

  const labels = useMemo(() => {
    if (!order || labelCount <= 0) return [];
    return Array.from({ length: labelCount }, (_, idx) => ({
      seq: idx + 1,
    }));
  }, [order, labelCount]);

  const effectiveContact =
    order?.shipping_contact_name?.trim() ||
    order?.customer_contact_person?.trim() ||
    order?.customer_name ||
    "";

  const effectivePhone =
    order?.shipping_contact_phone?.trim() || order?.customer_phone?.trim() || "";

  const effectiveElevator =
    order?.shipping_has_elevator === true
      ? "有"
      : order?.shipping_has_elevator === false
        ? "無"
        : "—";

  const effectiveAddress =
    order?.shipping_address?.trim() || order?.customer_address?.trim() || "";

  if (!orderId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">無效的訂單連結</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">載入地址條資料中…</p>
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-red-600">{loadError || "找不到訂單"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black px-6 py-8 shadow-lg print:shadow-none print:px-10 print:py-8">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <h1 className="text-lg font-semibold text-gray-900">出貨地址條</h1>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <span>🖨️ 列印 / 存成 PDF</span>
          </button>
        </div>

        {/* 控制區（只在螢幕上顯示） */}
        <div className="mb-6 space-y-3 print:hidden">
          <div className="text-xs text-gray-600">
            <p>
              訂單編號：
              <span className="font-mono text-gray-900 ml-1">
                {order.order_number || order.id}
              </span>
            </p>
            <p>
              客戶名稱：
              <span className="ml-1 text-gray-900">{order.customer_name || "—"}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-700 items-center">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={showShippingInfo}
                onChange={(e) => setShowShippingInfo(e.target.checked)}
              />
              <span>收貨聯絡（聯絡人／電話／電梯／地址）</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={showItems}
                onChange={(e) => setShowItems(e.target.checked)}
              />
              <span>出貨品項</span>
            </label>
            <div className="inline-flex items-center gap-1">
              <span>地址條數量：</span>
              <input
                type="number"
                min={1}
                max={50}
                value={labelCount}
                onChange={(e) => {
                  const v = Number(e.target.value) || 1;
                  setLabelCount(Math.min(Math.max(v, 1), 50));
                }}
                className="h-7 w-16 rounded-md border border-gray-300 px-2 text-xs"
              />
            </div>
          </div>
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-3 py-2.5">
            <p className="text-[11px] font-medium text-gray-700 mb-2">物流標示（選填，列印於地址條上方）</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-700">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={markHandleWithCare}
                  onChange={(e) => setMarkHandleWithCare(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <Hand className="h-3.5 w-3.5 text-amber-800" aria-hidden />
                  小心輕放
                </span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={markFragile}
                  onChange={(e) => setMarkFragile(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-800" aria-hidden />
                  易碎品
                </span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={markThisSideUp}
                  onChange={(e) => setMarkThisSideUp(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <ArrowBigUp className="h-3.5 w-3.5 text-amber-800" aria-hidden />
                  此處朝上
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 標籤列印區 */}
        <div className="grid grid-cols-1 gap-4 print:gap-2">
          {labels.map((l) => (
            <div
              key={l.seq}
              className="border border-gray-300 rounded-md px-4 py-4 text-base leading-relaxed break-words print:px-5 print:py-4 print:text-lg"
            >
              {(markHandleWithCare || markFragile || markThisSideUp) && (
                <div className="mb-3 flex flex-wrap gap-2 print:mb-2 print:gap-1.5">
                  {markHandleWithCare && (
                    <div
                      className="inline-flex items-center gap-1.5 rounded border-2 border-gray-900 bg-amber-50 px-2.5 py-1 text-xs font-bold tracking-wide text-gray-900 print:border-gray-800 print:px-2 print:py-1 print:text-[11px]"
                      role="img"
                      aria-label="小心輕放"
                    >
                      <Hand className="h-4 w-4 shrink-0 print:h-3.5 print:w-3.5" strokeWidth={2.5} />
                      小心輕放
                    </div>
                  )}
                  {markFragile && (
                    <div
                      className="inline-flex items-center gap-1.5 rounded border-2 border-gray-900 bg-amber-50 px-2.5 py-1 text-xs font-bold tracking-wide text-gray-900 print:border-gray-800 print:px-2 print:py-1 print:text-[11px]"
                      role="img"
                      aria-label="易碎品"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 print:h-3.5 print:w-3.5" strokeWidth={2.5} />
                      易碎品
                    </div>
                  )}
                  {markThisSideUp && (
                    <div
                      className="inline-flex items-center gap-1.5 rounded border-2 border-gray-900 bg-amber-50 px-2.5 py-1 text-xs font-bold tracking-wide text-gray-900 print:border-gray-800 print:px-2 print:py-1 print:text-[11px]"
                      role="img"
                      aria-label="此處朝上"
                    >
                      <ArrowBigUp className="h-4 w-4 shrink-0 print:h-3.5 print:w-3.5" strokeWidth={2.5} />
                      此處朝上
                    </div>
                  )}
                </div>
              )}
              <div className="text-sm text-gray-800 print:text-base leading-relaxed">
                <span className="text-gray-500">訂單號碼</span>{" "}
                <span className="font-mono font-medium text-gray-900">
                  {order.order_number?.trim() || "—"}
                </span>
              </div>
              {showShippingInfo && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-800 print:text-base">
                  <div className="min-w-0">
                    <span className="text-gray-500">聯絡人</span>{" "}
                    <span className="font-medium break-words">{effectiveContact || "—"}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-gray-500">電話</span>{" "}
                    <span className="font-medium tabular-nums break-all">{effectivePhone || "—"}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-gray-500">電梯</span>{" "}
                    <span className="font-medium">{effectiveElevator}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-gray-500">地址</span>{" "}
                    <span className="font-medium break-words">{effectiveAddress || "—"}</span>
                  </div>
                </div>
              )}
              {showItems && items.length > 0 && (
                <div className="mt-2 text-gray-800 text-sm leading-snug print:text-base">
                  出貨品項：
                  <ul className="list-disc ml-5 mt-1 space-y-1">
                    {items.map((it) => (
                      <li key={it.id}>
                        {it.name} × {it.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 pt-2 border-t border-gray-200 text-center text-sm text-gray-900 print:text-base">
                <span className="inline-flex flex-wrap items-end justify-center gap-x-1 gap-y-0.5">
                  <span>出貨物件共</span>
                  <span
                    className="inline-block min-w-[10rem] sm:min-w-[12rem] border-b border-dotted border-gray-700 mb-0.5 h-5 print:min-w-[14rem]"
                    aria-hidden
                  />
                  <span>件</span>
                </span>
                <span className="sr-only">（件數請產線填寫）</span>
              </div>
              <div className="mt-1 text-[10px] text-gray-500 text-right">
                地址條 {l.seq}/{labels.length}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
