"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface AddressLabelOrder {
  id: string;
  order_number: string;
  customer_name: string;
  contact_person: string | null;
  phone: string | null;
  shipping_address: string | null;
  customer_address: string | null;
}

interface AddressLabelItem {
  id: string;
  name: string;
  quantity: number;
}

export default function AddressLabelPage() {
  const params = useParams<{ orderId: string }>();
  const rawOrderId = params?.orderId;
  const orderId = typeof rawOrderId === "string" ? decodeURIComponent(rawOrderId) : undefined;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<AddressLabelOrder | null>(null);
  const [items, setItems] = useState<AddressLabelItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showContact, setShowContact] = useState(true);
  const [showItems, setShowItems] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [labelCount, setLabelCount] = useState(1);

  useEffect(() => {
    if (!orderId) return;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: orderRow, error: orderErr } = await supabase
          .from("orders")
          .select(
            "id, order_number, shipping_address, customers(name, contact_person, phone, delivery_address)"
          )
          .eq("id", orderId)
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
          contact_person: custRaw?.contact_person ?? null,
          phone: custRaw?.phone ?? null,
          shipping_address: orderRow.shipping_address ?? null,
          customer_address: custRaw?.delivery_address ?? null,
        };

        const { data: itemRows, error: itemErr } = await supabase
          .from("order_items")
          .select(
            "id, quantity, custom_name, custom_dimension_w, custom_dimension_d, custom_dimension_h, product_variants(product_code, dimension_w, dimension_d, dimension_h)"
          )
          .eq("order_id", orderId);

        if (itemErr) {
          throw new Error(itemErr.message || "讀取訂單品項失敗");
        }

        const mappedItems: AddressLabelItem[] = (itemRows ?? []).map((r: any, idx: number) => {
          const variant = r.product_variants;
          const baseName: string =
            (r.custom_name as string | null) ||
            (variant?.product_code as string | null) ||
            `品項 ${idx + 1}`;

          // 優先使用客製尺寸，其次使用規格尺寸
          const w = r.custom_dimension_w ?? variant?.dimension_w ?? null;
          const d = r.custom_dimension_d ?? variant?.dimension_d ?? null;
          const h = r.custom_dimension_h ?? variant?.dimension_h ?? null;
          const hasDim = w != null || d != null || h != null;
          const dimText = hasDim
            ? ` (${w ?? "—"}×${d ?? "—"}×${h ?? "—"} cm)`
            : "";

          const name = `${baseName}${dimText}`;

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
  }, [orderId]);

  const labels = useMemo(() => {
    if (!order || labelCount <= 0) return [];
    return Array.from({ length: labelCount }, (_, idx) => ({
      seq: idx + 1,
    }));
  }, [order, labelCount]);

  const effectiveContact =
    order?.contact_person && order.contact_person.trim()
      ? order.contact_person
      : order?.customer_name ?? "";

  const effectiveAddress =
    order?.shipping_address && order.shipping_address.trim()
      ? order.shipping_address
      : order?.customer_address ?? "";

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
                checked={showContact}
                onChange={(e) => setShowContact(e.target.checked)}
              />
              <span>聯絡人</span>
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
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={showPhone}
                onChange={(e) => setShowPhone(e.target.checked)}
              />
              <span>聯絡人電話</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={showAddress}
                onChange={(e) => setShowAddress(e.target.checked)}
              />
              <span>聯絡人地址</span>
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
        </div>

        {/* 標籤列印區 */}
        <div className="grid grid-cols-1 gap-4 print:gap-2">
          {labels.map((l) => (
            <div
              key={l.seq}
              className="border border-gray-300 rounded-md px-4 py-4 text-base leading-relaxed break-words print:px-5 print:py-4 print:text-lg"
            >
              <div className="font-semibold text-gray-900 text-xl tracking-tight print:text-2xl">
                訂單號碼：
                <span className="font-mono font-bold">
                  {order.order_number?.trim() || "—"}
                </span>
              </div>
              {showContact && (
                <div className="mt-1 text-lg text-gray-800 print:text-xl">
                  聯絡人：{effectiveContact || "—"}
                </div>
              )}
              {showPhone && (
                <div className="mt-0.5 text-lg text-gray-800 print:text-xl">
                  電話：{order.phone || "—"}
                </div>
              )}
              {showAddress && (
                <div className="mt-0.5 text-lg text-gray-800 print:text-xl">
                  地址：{effectiveAddress || "—"}
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
              <div className="mt-2 text-[10px] text-gray-500 text-right">
                地址條 {l.seq}/{labels.length}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
