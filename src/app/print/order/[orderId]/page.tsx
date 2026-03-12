"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface PrintOrder {
  id: string;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: string | null;
  total_amount: number;
  original_amount: number;
  discount_amount: number;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  customer_type?: string | null;
  deposit_amount: number;
}

interface PrintOrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  custom_notes: string | null;
  kind: "variant" | "custom";
  name: string;
  description?: string | null;
  image_url?: string | null;
}

export default function PrintOrderPage() {
  const params = useParams<{ orderId: string }>();
  const rawOrderId = params?.orderId;

  const orderId = typeof rawOrderId === "string" ? decodeURIComponent(rawOrderId) : undefined;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<PrintOrder | null>(null);
  const [items, setItems] = useState<PrintOrderItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: orderRow, error: orderErr } = await supabase
          .from("orders")
          .select(
            "id, order_number, order_date, expected_delivery_date, status, total_amount, deposit_amount, customer_id, customers(name, phone, delivery_address, customer_type)"
          )
          .eq("id", orderId)
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || "找不到此訂單");
        }

        const safeTotal = Number(orderRow.total_amount ?? 0);

        const lineRes = await supabase
          .from("order_items")
          .select(
            "id, order_id, variant_id, quantity, unit_price, custom_notes, custom_category, custom_name, custom_description, custom_dimension_w, custom_dimension_d, custom_dimension_h"
          )
          .eq("order_id", orderId);

        if (lineRes.error) {
          throw new Error(lineRes.error.message || "讀取訂單明細失敗");
        }

        const itemRows = (lineRes.data ?? []) as any[];

        const variantIds = Array.from(
          new Set(
            itemRows
              .map((r) => r.variant_id as string | null)
              .filter((v): v is string => !!v)
          )
        );

        let variantMap: Record<
          string,
          { id: string; product_code: string; series_id: string | null; image_url: string | null }
        > = {};
        let seriesMap: Record<string, { id: string; name: string; image_url: string | null }> = {};

        if (variantIds.length > 0) {
          const { data: variants, error: variantErr } = await supabase
            .from("product_variants")
            .select("id, series_id, product_code, image_url")
            .in("id", variantIds);

          if (variantErr) {
            throw new Error(variantErr.message || "讀取產品規格失敗");
          }

          variantMap = Object.fromEntries(
            (variants ?? []).map((v: any) => [
              String(v.id),
              {
                id: String(v.id),
                product_code: String(v.product_code ?? ""),
                series_id: v.series_id ? String(v.series_id) : null,
                image_url: v.image_url ?? null,
              },
            ])
          );

          const seriesIds = Array.from(
            new Set(
              (variants ?? [])
                .map((v: any) => v.series_id as string | null)
                .filter((v): v is string => !!v)
            )
          );

          if (seriesIds.length > 0) {
            const { data: seriesRows, error: seriesErr } = await supabase
              .from("product_series")
              .select("id, series_name, image_url")
              .in("id", seriesIds);

            if (seriesErr) {
              throw new Error(seriesErr.message || "讀取產品系列失敗");
            }

            seriesMap = Object.fromEntries(
              (seriesRows ?? []).map((s: any) => [
                String(s.id),
                {
                  id: String(s.id),
                  name: String(s.series_name ?? ""),
                  image_url: s.image_url ?? null,
                },
              ])
            );
          }
        }

        const mappedItems: PrintOrderItem[] = itemRows.map((r: any, idx: number) => {
          const isCustom = !r.variant_id;

          if (isCustom) {
            const nameParts: string[] = [];
            if (r.custom_category) nameParts.push(String(r.custom_category));
            if (r.custom_name) nameParts.push(String(r.custom_name));
            const name = nameParts.length > 0 ? nameParts.join(" ") : "客製品項";

            const descParts: string[] = [];
            if (r.custom_description) descParts.push(String(r.custom_description));

            const hasDims =
              r.custom_dimension_w != null ||
              r.custom_dimension_d != null ||
              r.custom_dimension_h != null;
            if (hasDims) {
              descParts.push(
                `尺寸：約 ${r.custom_dimension_w ?? "—"} × ${r.custom_dimension_d ?? "—"} × ${
                  r.custom_dimension_h ?? "—"
                } cm`
              );
            }

            return {
              id: String(r.id ?? `item-${idx}`),
              quantity: Number(r.quantity ?? 1),
              unit_price: Number(r.unit_price ?? 0),
              custom_notes: r.custom_notes ?? null,
              kind: "custom",
              name,
              description: descParts.length > 0 ? descParts.join("；") : null,
              image_url: null,
            };
          }

          const variant = variantMap[String(r.variant_id)] || null;
          const series = variant?.series_id ? seriesMap[variant.series_id] || null : null;

          const name =
            series?.name && variant?.product_code
              ? `${series.name}｜${variant.product_code}`
              : variant?.product_code || series?.name || "產品項目";

          const imageUrl = variant?.image_url || series?.image_url || null;

          return {
            id: String(r.id ?? `item-${idx}`),
            quantity: Number(r.quantity ?? 1),
            unit_price: Number(r.unit_price ?? 0),
            custom_notes: r.custom_notes ?? null,
            kind: "variant",
            name,
            description: null,
            image_url: imageUrl,
          };
        });

        const originalAmount = mappedItems.reduce(
          (sum, it) => sum + it.quantity * it.unit_price,
          0
        );

        const discountAmount = Math.max(0, originalAmount - safeTotal);

        const customer =
          (orderRow.customers &&
            (Array.isArray(orderRow.customers)
              ? orderRow.customers[0]
              : orderRow.customers)) ||
          null;

        setOrder({
          id: String(orderRow.id),
          order_number: String(orderRow.order_number ?? ""),
          order_date: orderRow.order_date ?? null,
          expected_delivery_date: orderRow.expected_delivery_date ?? null,
          status: orderRow.status ?? null,
          total_amount: safeTotal,
          original_amount: originalAmount,
          discount_amount: discountAmount,
          customer_name: customer?.name ?? "",
          customer_phone: customer?.phone ?? null,
          customer_address: customer?.delivery_address ?? null,
          customer_type: customer?.customer_type ?? null,
          deposit_amount: Number(orderRow.deposit_amount ?? 0),
        });

        setItems(mappedItems);
      } catch (err) {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : "讀取訂單資料失敗");
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [orderId]);

  const totals = useMemo(() => {
    if (!order) {
      const raw = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
      return {
        original: raw,
        discount: 0,
        total: raw,
      };
    }
    return {
      original: order.original_amount,
      discount: order.discount_amount,
      total: order.total_amount,
    };
  }, [order, items]);

  const formattedDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("zh-TW") : "—";

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
        <p className="text-sm text-gray-600">載入訂單中…</p>
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

  const showDiscountRow =
    (order.customer_type && order.customer_type === "通路") || totals.discount > 0;

  const depositPercent =
    order.total_amount > 0 ? Math.round((order.deposit_amount / order.total_amount) * 100) : 0;

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black p-10 shadow-lg print:shadow-none print:p-0">
        {/* 右上角：列印按鈕（列印時隱藏） */}
        <div className="flex justify-end mb-4 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <span>🖨️ 列印 / 存成 PDF</span>
          </button>
        </div>

        {/* 品牌與訂單資訊 */}
        <header className="mb-8 border-b border-gray-200 pb-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              <img
                src="/logo.png"
                alt="Føre Furniture"
                className="h-16 object-contain mb-4"
              />
              <div>
                <h1 className="text-xl font-semibold tracking-wide text-gray-900">
                  Føre Furniture 曉雨傢俱工作室
                </h1>
                <div className="mt-2 space-y-0.5 text-[11px] text-gray-700">
                  <p>電話：02-0000-0000</p>
                  <p>Email：info@fore-furniture.com</p>
                  <p>地址：台北市某某區某某路 123 號</p>
                </div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm font-semibold tracking-wide text-gray-900">
                報價單 / 訂單確認單
              </p>
              <p className="text-xs text-gray-600">
                訂單編號：
                <span className="font-mono text-gray-900">{order.order_number}</span>
              </p>
              <p className="text-xs text-gray-600">
                日期：<span>{formattedDate(order.order_date)}</span>
              </p>
              {order.expected_delivery_date && (
                <p className="text-xs text-gray-600">
                  預計交期：<span>{formattedDate(order.expected_delivery_date)}</span>
                </p>
              )}
            </div>
          </div>

          {/* 客戶資訊 */}
          <div className="mt-6 grid grid-cols-2 gap-6 text-xs">
            <div className="space-y-1.5">
              <p className="font-semibold text-gray-900">客戶資訊</p>
              <p className="text-gray-800">
                客戶名稱：<span className="font-medium">{order.customer_name || "—"}</span>
              </p>
              {order.customer_phone && (
                <p className="text-gray-800">聯絡電話：{order.customer_phone}</p>
              )}
              {order.customer_address && (
                <p className="text-gray-800">送貨地址：{order.customer_address}</p>
              )}
              {order.customer_type && (
                <p className="text-gray-800">客戶類別：{order.customer_type}</p>
              )}
            </div>
            <div className="space-y-1.5 text-xs text-gray-800">
              <p className="font-semibold text-gray-900">備註</p>
              <p>此報價單內容如有疑義，請於 3 日內與我們聯繫確認。</p>
            </div>
          </div>
        </header>

        {/* 明細表格 */}
        <section className="mb-6">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-300 bg-gray-50">
                <th className="w-14 px-2 py-2 text-left font-medium text-gray-700">圖片</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">品項名稱</th>
                <th className="w-14 px-2 py-2 text-right font-medium text-gray-700">數量</th>
                <th className="w-20 px-2 py-2 text-right font-medium text-gray-700">單價</th>
                <th className="w-24 px-2 py-2 text-right font-medium text-gray-700">小計</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-gray-500 border-b border-gray-200"
                  >
                    此訂單目前尚無明細
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const lineTotal = item.quantity * item.unit_price;
                  return (
                    <tr key={item.id} className="border-b border-gray-200 align-top">
                      <td className="px-2 py-2">
                        {item.image_url ? (
                          <div className="h-14 w-14 overflow-hidden rounded border border-gray-200 bg-gray-100">
                            <img
                              src={item.image_url}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="h-14 w-14 rounded border border-dashed border-gray-200 bg-gray-50" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-900">{item.name}</div>
                        {item.description && (
                          <div className="mt-0.5 text-[11px] text-gray-600">
                            {item.description}
                          </div>
                        )}
                        {item.custom_notes && (
                          <div className="mt-0.5 text-[11px] text-gray-600">
                            {item.custom_notes}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900">
                        {item.quantity}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900">
                        {item.unit_price.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900">
                        {lineTotal.toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        {/* 金額加總區塊 */}
        <section className="mt-6 mb-10 flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">商品總計</span>
              <span className="font-medium text-gray-900">
                {totals.original.toLocaleString()}
              </span>
            </div>
            {showDiscountRow && (
              <div className="flex items-center justify-between">
                <span className="text-gray-700">通路 / 專案折扣</span>
                <span className="font-medium text-gray-900">
                  {totals.discount.toLocaleString()}
                </span>
              </div>
            )}
            <div className="mt-2 border-top border-gray-300 pt-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">總計金額</span>
              <span className="text-base font-semibold text-gray-900">
                {totals.total.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">訂金</span>
              <span className="font-medium text-gray-900">
                {order.deposit_amount.toLocaleString()}{" "}
                {depositPercent > 0 && (
                  <span className="text-[11px] text-gray-600">({depositPercent}%)</span>
                )}
              </span>
            </div>
          </div>
        </section>

        {/* 匯款資訊與條款、簽名欄 */}
        <footer className="mt-auto pt-6 border-t border-gray-200 text-xs text-gray-800 space-y-6">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-1.5">
              <p className="font-semibold text-gray-900">匯款帳號資訊</p>
              <p>銀行名稱：台灣銀行 安南分行（銀行代碼 004）</p>
              <p>戶名：蔡秉學</p>
              <p>帳號：137-004-356269</p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="font-semibold text-gray-900">客戶簽名欄</p>
                <div className="mt-4 h-12 border-b border-gray-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">工坊負責人簽章欄</p>
                <div className="mt-4 h-12 border-b border-gray-500" />
              </div>
            </div>
          </div>

          <div className="space-y-2 text-[11px] text-gray-600 leading-relaxed">
            <p className="font-semibold text-gray-700">品質保證與聲明</p>
            <p>
              頂級塗料與安全認證：本工坊使用之塗料皆通過嚴格環保與安全標準檢驗，確保甲醛與揮發性有機物逸散速率符合高標準，敬請安心使用。
            </p>
            <p>
              實木傢俱日常保養：請避免將傢俱長時間曝曬於陽光下，或讓冷氣出風口直接吹拂傢俱，以免造成漆面損傷或木材變形。放置高溫容器時請搭配杯墊或墊板；日常清潔以微濕布輕拭即可。
            </p>
            <p>
              天然實木特性聲明：實木傢俱具有自然生長紋理，包含木紋走向、色澤深淺差異與細微木結等皆屬正常現象，並非產品瑕疵或結構問題。
            </p>
            <p>
              運費說明：本報價單總計金額已包含一般地區基本運費。若配送地點為偏遠地區、無電梯需人工搬運樓層，或因空間限制需動用吊車等特殊作業，將依實際狀況另行報價並收取額外費用。
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

