"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { stripSpecSuffixCodes } from "@/lib/strip-spec-suffix";
import { useRequireAuth } from "@/lib/use-require-auth";

interface PrintOrder {
  id: string;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: string | null;
  total_amount: number;
  original_amount: number;
  discount_amount: number;
  shipping_fee: number;
  customer_name: string;
  customer_type?: string | null;
  deposit_amount: number;
  explanation_image_url?: string | null;
  shipping_contact_name?: string | null;
  shipping_contact_phone?: string | null;
  shipping_address?: string | null;
  shipping_has_elevator?: boolean | null;
  invoice_title?: string | null;
  invoice_tax_id?: string | null;
  internal_notes?: string | null;
}

type ExplanationImage = { url: string; title?: string | null };

function parseExplanationImages(raw: string | null | undefined): ExplanationImage[] {
  if (raw == null || raw === "") return [];
  const normalizeUrl = (u: unknown): string | null => {
    if (typeof u !== "string") return null;
    const s = u.trim();
    return s ? s : null;
  };
  const normalizeTitle = (t: unknown): string | null => {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s ? s : null;
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed.every((x) => typeof x === "string")) {
        return (parsed as string[])
          .map((u) => normalizeUrl(u))
          .filter((u): u is string => Boolean(u))
          .map((url) => ({ url }));
      }
      return (parsed as any[])
        .map((x): ExplanationImage | null => {
          const url = normalizeUrl((x as any)?.url);
          if (!url) return null;
          const title = normalizeTitle((x as any)?.title);
          return { url, title };
        })
        .filter((x): x is ExplanationImage => x != null);
    }
    if (typeof parsed === "string") {
      const url = normalizeUrl(parsed);
      return url ? [{ url }] : [];
    }
    return [];
  } catch {
    const url = normalizeUrl(raw);
    return url ? [{ url }] : [];
  }
}

/** 另存 PDF 時瀏覽器多會用 document.title 當預設檔名 */
function orderDateToYyyyMmDd(orderDate: string | null): string {
  if (orderDate && /^\d{4}-\d{2}-\d{2}/.test(orderDate)) {
    return `${orderDate.slice(0, 4)}${orderDate.slice(5, 7)}${orderDate.slice(8, 10)}`;
  }
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function sanitizeForPdfFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "客戶";
  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "");
  return cleaned.slice(0, 80) || "客戶";
}

function buildPrintPdfFilename(o: PrintOrder): string {
  return `Fore Furniture_訂購確認單_${orderDateToYyyyMmDd(o.order_date)}_${sanitizeForPdfFilename(
    o.customer_name
  )}`;
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
  wood_type?: string | null;
  dimension_text?: string | null;
  spec_text?: string | null;
}

export default function PrintOrderPage() {
  const params = useParams<{ orderId: string }>();
  const rawOrderId = params?.orderId;

  const orderId = typeof rawOrderId === "string" ? decodeURIComponent(rawOrderId) : undefined;
  const { ready: authReady } = useRequireAuth();

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<PrintOrder | null>(null);
  const [items, setItems] = useState<PrintOrderItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    document.title = buildPrintPdfFilename(order);
  }, [order]);

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
            "id, order_number, order_date, expected_delivery_date, status, total_amount, deposit_amount, shipping_fee, explanation_image_url, shipping_address, shipping_contact_name, shipping_contact_phone, shipping_has_elevator, invoice_title, invoice_tax_id, internal_notes, customer_id, customers(name, customer_type)"
          )
          .eq("id", safeOrderId)
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || "找不到此訂單");
        }

        const safeTotal = Number(orderRow.total_amount ?? 0);
        const shippingFee = Number(orderRow.shipping_fee ?? 0);

        const lineRes = await supabase
          .from("order_items")
          .select(
            "id, order_id, variant_id, quantity, unit_price, custom_notes, custom_category, custom_name, custom_description, custom_dimension_w, custom_dimension_d, custom_dimension_h, seat_height_cm, image_url, wood_type"
          )
          .eq("order_id", safeOrderId)
          .order("line_order", { ascending: true })
          .order("id", { ascending: true });

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
          {
            id: string;
            product_code: string;
            series_id: string | null;
            image_url: string | null;
            wood_type: string | null;
            dimension_w: number | null;
            dimension_d: number | null;
            dimension_h: number | null;
            seat_height_cm: number | null;
            spec1: string | null;
          }
        > = {};
        let seriesMap: Record<string, { id: string; name: string; image_url: string | null }> = {};

        if (variantIds.length > 0) {
          const { data: variants, error: variantErr } = await supabase
            .from("product_variants")
            .select("id, series_id, product_code, image_url, wood_type, dimension_w, dimension_d, dimension_h, seat_height_cm, spec1")
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
                wood_type: v.wood_type ?? null,
                dimension_w: v.dimension_w != null ? Number(v.dimension_w) : null,
                dimension_d: v.dimension_d != null ? Number(v.dimension_d) : null,
                dimension_h: v.dimension_h != null ? Number(v.dimension_h) : null,
                seat_height_cm:
                  v.seat_height_cm != null ? Number(v.seat_height_cm) : null,
                spec1: v.spec1 != null ? String(v.spec1) : null,
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

        const itemWoodType = (r: any): string | null => {
          const w = r.wood_type;
          if (w == null || String(w).trim() === "") return null;
          return String(w).trim();
        };

        const mappedItems: PrintOrderItem[] = itemRows.map((r: any, idx: number) => {
          const isCustom = !r.variant_id;
          const lineSeat =
            r.seat_height_cm != null ? Number(r.seat_height_cm) : NaN;

          // 不論客製或規格，一律優先使用 order_items.custom_dimension_*
          const hasDims =
            r.custom_dimension_w != null ||
            r.custom_dimension_d != null ||
            r.custom_dimension_h != null;
          let dimText: string | null = hasDims
            ? `${r.custom_dimension_w ?? "—"} × ${r.custom_dimension_d ?? "—"} × ${r.custom_dimension_h ?? "—"}`
            : null;

          if (isCustom) {
            // 客製品名稱：只顯示「客製名稱」，不再前綴類別（避免出現「櫃 訂製櫃」）
            let name = "客製品項";
            if (r.custom_name) {
              name = String(r.custom_name);
            } else if (r.custom_category) {
              name = String(r.custom_category);
            }

            const descParts: string[] = [];
            if (r.custom_description) descParts.push(String(r.custom_description));

            let dimOut = dimText;
            if (Number.isFinite(lineSeat)) {
              dimOut = dimOut
                ? `${dimOut} · 座高 ${lineSeat} cm`
                : `座高 ${lineSeat} cm`;
            }

            return {
              id: String(r.id ?? `item-${idx}`),
              quantity: Number(r.quantity ?? 1),
              unit_price: Number(r.unit_price ?? 0),
              custom_notes: r.custom_notes ?? null,
              kind: "custom",
              name,
              description: descParts.length > 0 ? descParts.join("；") : null,
              image_url: r.image_url ?? null,
              wood_type: itemWoodType(r),
              dimension_text: dimOut,
              spec_text: null,
            };
          }

          const variant = variantMap[String(r.variant_id)] || null;
          const series = variant?.series_id ? seriesMap[variant.series_id] || null : null;

          // 規格品：報價品項只顯示系列名稱（規格、木種、尺寸另有欄位）
          const name = series?.name || variant?.product_code || "產品項目";

          const imageUrl = r.image_url ?? variant?.image_url ?? series?.image_url ?? null;

          if (!dimText && variant) {
            const hasVariantDims =
              variant.dimension_w != null ||
              variant.dimension_d != null ||
              variant.dimension_h != null;
            const base = hasVariantDims
              ? `${variant.dimension_w ?? "—"} × ${variant.dimension_d ?? "—"} × ${variant.dimension_h ?? "—"}`
              : null;
            const shSeat = Number.isFinite(lineSeat)
              ? lineSeat
              : variant.seat_height_cm != null
                ? Number(variant.seat_height_cm)
                : NaN;
            if (base && Number.isFinite(shSeat)) {
              dimText = `${base} · 座高 ${shSeat} cm`;
            } else if (base) {
              dimText = base;
            } else if (Number.isFinite(shSeat)) {
              dimText = `座高 ${shSeat} cm`;
            }
          } else if (dimText && Number.isFinite(lineSeat)) {
            dimText = `${dimText} · 座高 ${lineSeat} cm`;
          } else if (
            dimText &&
            !Number.isFinite(lineSeat) &&
            variant &&
            variant.seat_height_cm != null &&
            Number.isFinite(Number(variant.seat_height_cm))
          ) {
            // 明細未填座高時，尺寸欄仍於後方標註規格庫座高
            dimText = `${dimText} · 座高 ${Number(variant.seat_height_cm)} cm`;
          }

          return {
            id: String(r.id ?? `item-${idx}`),
            quantity: Number(r.quantity ?? 1),
            unit_price: Number(r.unit_price ?? 0),
            custom_notes: r.custom_notes ?? null,
            kind: "variant",
            name,
            description: null,
            image_url: imageUrl,
            // 明細未填木種時，回退顯示規格庫（product_variants）的木種
            wood_type: itemWoodType(r) ?? variant?.wood_type ?? null,
            dimension_text: dimText,
            // 規格欄位顯示 product_variants.spec1（列印時略去 -P/-R/-W/-F 等後綴）
            spec_text: stripSpecSuffixCodes(String(variant?.spec1 ?? "")) || null,
          };
        });

        const originalAmount = mappedItems.reduce(
          (sum, it) => sum + it.quantity * it.unit_price,
          0
        );

        // total_amount 已含運費，折扣僅計算商品金額的差異
        const discountAmount = Math.max(0, originalAmount - Math.max(0, safeTotal - shippingFee));

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
          shipping_fee: shippingFee,
          customer_name: customer?.name ?? "",
          customer_type: customer?.customer_type ?? null,
          deposit_amount: Number(orderRow.deposit_amount ?? 0),
          explanation_image_url: orderRow.explanation_image_url ?? null,
          shipping_contact_name: orderRow.shipping_contact_name ?? null,
          shipping_contact_phone: orderRow.shipping_contact_phone ?? null,
          shipping_address: orderRow.shipping_address ?? null,
          shipping_has_elevator:
            orderRow.shipping_has_elevator === true ||
            orderRow.shipping_has_elevator === false
              ? Boolean(orderRow.shipping_has_elevator)
              : null,
          invoice_title: orderRow.invoice_title ?? null,
          invoice_tax_id: orderRow.invoice_tax_id ?? null,
          internal_notes: orderRow.internal_notes ?? null,
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
  }, [orderId, authReady]);

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

  const remainingAmount = Math.max(0, totals.total - (order.deposit_amount || 0));

  const elevatorLabel =
    order.shipping_has_elevator === true
      ? "有電梯"
      : order.shipping_has_elevator === false
        ? "無電梯"
        : "—";

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black px-6 py-8 shadow-lg print:shadow-none print:px-4 print:py-8">
        <div className="flex justify-end mb-6 print:hidden">
          <button
            type="button"
            onClick={() => {
              document.title = buildPrintPdfFilename(order);
              window.print();
            }}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <span>🖨️ 列印 / 存成 PDF</span>
          </button>
        </div>

        <header className="mb-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[2fr_1fr]">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex h-full items-center justify-between gap-4">
                <img
                  src="/logo.png"
                  alt="Føre Furniture"
                  className="block h-24 w-auto shrink-0 object-contain object-left"
                />
                <div className="space-y-1 border-l border-gray-200 pl-5 text-xs text-gray-700 leading-relaxed">
                  <p>電話：06-2302861</p>
                  <p>聯絡時間：上班日 9:00 - 17:00</p>
                  <p className="whitespace-nowrap">地址：台南市歸仁區丁厝街125號</p>
                  <p>
                    Line：
                    <a
                      href="https://line.me/ti/p/~fore.fore"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-900 underline hover:no-underline"
                    >
                      @fore.fore
                    </a>
                  </p>
                  <p className="whitespace-nowrap">
                    Email：
                    <a
                      href="mailto:forefurniture.studio@gmail.com"
                      className="text-gray-900 underline hover:no-underline"
                    >
                      forefurniture.studio@gmail.com
                    </a>
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700 leading-relaxed">
              <p className="mb-2 text-lg font-semibold leading-tight text-gray-900">訂單確認單</p>
              <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1.5 text-xs">
                <span className="text-gray-500">訂單編號</span>
                <span className="text-gray-900 whitespace-nowrap">{order.order_number}</span>
                <span className="text-gray-500">訂單日期</span>
                <span className="text-gray-900">{formattedDate(order.order_date)}</span>
                {order.expected_delivery_date && (
                  <>
                    <span className="text-gray-500">預計交期</span>
                    <span className="text-gray-900">{formattedDate(order.expected_delivery_date)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 p-4 text-sm leading-relaxed">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-gray-800 sm:grid-cols-[auto_2fr_auto_1fr] sm:gap-x-8">
              <span className="text-gray-500">客戶名稱</span>
              <span className="font-medium text-gray-900 sm:col-span-3">{order.customer_name || "—"}</span>
              <span className="text-gray-500">寄送聯絡人</span>
              <span className="font-medium">{order.shipping_contact_name?.trim() || "—"}</span>
              <span className="text-gray-500">電話</span>
              <span className="font-medium">{order.shipping_contact_phone?.trim() || "—"}</span>
              {/* 只填其中一個時值撐滿整列，避免 4 欄 grid 下地址／電梯被擠到同列右側 */}
              {order.invoice_title?.trim() ? (
                <>
                  <span className="text-gray-500">公司抬頭</span>
                  <span className={order.invoice_tax_id?.trim() ? "font-medium" : "font-medium sm:col-span-3"}>
                    {order.invoice_title.trim()}
                  </span>
                </>
              ) : null}
              {order.invoice_tax_id?.trim() ? (
                <>
                  <span className="text-gray-500">統一編號</span>
                  <span className={order.invoice_title?.trim() ? "font-medium" : "font-medium sm:col-span-3"}>
                    {order.invoice_tax_id.trim()}
                  </span>
                </>
              ) : null}
              <span className="text-gray-500">地址</span>
              <span className="font-medium break-words">{order.shipping_address?.trim() || "—"}</span>
              <span className="text-gray-500">電梯</span>
              <span className="font-medium">{elevatorLabel}</span>
            </div>
          </div>
        </header>

        <section className="mb-4">
          <p className="text-sm font-semibold text-gray-900">報價內容</p>
        </section>

        <section className="mb-8 print-quote-table-wrap">
          <table className="w-full table-auto border-collapse text-sm leading-snug">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-50">
                <th className="w-[4rem] px-1.5 py-3 text-left font-semibold text-gray-700">圖片</th>
                <th className="w-[8.5rem] px-2 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">報價品項</th>
                <th className="w-[5.5rem] px-1.5 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">木種</th>
                <th className="print-col-dimension w-[28%] min-w-[11rem] px-2 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">
                  尺寸(cm)
                </th>
                <th className="print-col-spec w-[7rem] min-w-[6.5rem] px-2 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">
                  規格
                </th>
                <th className="w-[3.5rem] px-1.5 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">數量</th>
                <th className="w-[4.75rem] px-1.5 py-3 text-right font-semibold text-gray-700">單價</th>
                <th className="w-[5rem] px-1.5 py-3 text-right font-semibold text-gray-700">小計</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-8 text-center text-sm text-gray-500 border-b border-gray-200"
                  >
                    此訂單目前尚無明細
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const lineTotal = item.quantity * item.unit_price;
                  const hasCustomNotes =
                    item.custom_notes != null && String(item.custom_notes).trim() !== "";
                  const hasDescription =
                    item.description != null && String(item.description).trim() !== "";
                  const hasNotes = hasCustomNotes || hasDescription;
                  const notesContent = [item.description, item.custom_notes]
                    .map((t) => t?.trim())
                    .filter(Boolean)
                    .join("\n");

                  return (
                    <Fragment key={item.id}>
                    <tr className={`${hasNotes ? "" : "border-b border-gray-200 "}align-top text-sm`}>
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
                      <td className="px-2 py-2">
                        <div className="font-medium text-gray-900 whitespace-nowrap">
                          {item.name}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">
                        {item.wood_type ?? "—"}
                      </td>
                      <td className="print-col-dimension px-2 py-2 text-gray-700 whitespace-nowrap">
                        {item.dimension_text ?? "—"}
                      </td>
                      <td className="print-col-spec px-2 py-2 text-gray-700 font-mono whitespace-nowrap print:min-w-[5.5rem]">
                        {item.spec_text ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900 tabular-nums">
                        {item.quantity}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900 tabular-nums">
                        {item.unit_price.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-900 font-medium tabular-nums">
                        {lineTotal.toLocaleString()}
                      </td>
                    </tr>
                    {hasNotes && (
                      <tr className="border-b border-gray-200">
                        <td colSpan={8} className="px-2 pb-2 text-xs text-gray-500 whitespace-pre-line">
                          備註：{notesContent}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <section className="mb-8 flex items-start justify-between gap-8 break-inside-avoid">
          {order.internal_notes?.trim() ? (
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <p className="mb-1 font-semibold text-gray-900">訂單備註</p>
              <p className="whitespace-pre-line break-words text-gray-700">
                {order.internal_notes.trim()}
              </p>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="w-full max-w-xs shrink-0 break-inside-avoid text-sm leading-relaxed">
            <dl className="space-y-2">
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">商品總計</dt>
                <dd className="text-gray-900 tabular-nums">{totals.original.toLocaleString()}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">運費</dt>
                <dd className="text-gray-900 tabular-nums">{order.shipping_fee.toLocaleString()}</dd>
              </div>
              {showDiscountRow && (
                <div className="flex items-center justify-between">
                  <dt className="text-gray-600">通路 / 專案折扣</dt>
                  <dd className="text-gray-900 tabular-nums">-{totals.discount.toLocaleString()}</dd>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                <dt className="font-semibold text-gray-900">總金額</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">
                  {totals.total.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">已收訂金</dt>
                <dd className="text-gray-900 tabular-nums">
                  -{order.deposit_amount.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="font-bold text-gray-900">尾款金額</dt>
                <dd className="font-bold text-gray-900 tabular-nums">
                  {remainingAmount.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <footer className="pt-6 border-t border-gray-200 space-y-6 text-sm text-gray-800 leading-relaxed">
          {parseExplanationImages(order.explanation_image_url).length > 0 && (
            <div className="space-y-5">
              {parseExplanationImages(order.explanation_image_url).map((img, idx) => (
                <div key={idx} className="space-y-2 break-inside-avoid">
                  <div className="text-sm font-semibold text-gray-900">
                    {img.title?.trim() ? img.title : `訂單說明圖 ${idx + 1}`}
                  </div>
                  <div className="w-full overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    <img
                      src={img.url}
                      alt={img.title?.trim() ? img.title : `訂單說明圖 ${idx + 1}`}
                      className="w-full max-h-[520px] object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
            <p>尾款金額請於收到商品確認無誤後，一週內匯款至指定帳戶。</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
            <div className="space-y-2">
              <p className="font-semibold text-gray-900">匯款帳號資訊</p>
              <div className="space-y-1.5 leading-snug">
                <p>銀行名稱：台灣銀行 安南分行（銀行代碼 004）</p>
                <p>戶名：蔡秉學</p>
                <p>帳號：137-004-356269</p>
              </div>
            </div>
            <div className="flex justify-start sm:justify-end">
              <img
                src="/company-stamp.png"
                alt="公司章"
                className="w-32 max-w-full object-contain"
              />
            </div>
          </div>

          <div className="space-y-3 text-xs text-gray-600 leading-relaxed">
            <p className="text-sm font-semibold text-gray-900">品質保證與聲明</p>
            <p>
              頂級塗料與安全認證：本工坊使用日本大谷塗料，具日本食器使用標準(F4星)，通過嚴格環保與安全標準檢驗，確保甲醛與揮發性有機物逸散速率符合高標準，敬請安心使用。
            </p>
            <p>
              實木傢俱日常保養：請避免將傢俱長時間曝曬於陽光下，或讓冷氣出風口直接吹拂傢俱，以免造成漆面損傷或木材變形。放置高溫容器時請搭配杯墊或墊板；日常清潔以微濕布輕拭即可。
            </p>
            <p>
              天然實木特性聲明：實木傢俱具有自然生長紋理，包含木紋走向、色澤深淺差異與細微木結等皆屬正常現象，並非產品瑕疵或結構問題。
            </p>
            <p>
              運費說明：配送地區為一般台灣本島西部縣市，若為東部、外島及偏遠山區，則運費將視實際情況另行調整與報價。
            </p>
            <p>
              每件 FØRE Furniture 作品均為您的空間量身打造。為確保高品質木料與製作排程的優先權，需於支付訂金並確認設計圖後正式啟動。
            </p>
            <p>
              由於訂製家具具備唯一性與不可逆之生產特質，合約生效後若因個人因素異動或取消，已繳納之訂金將用於補償已投入之木材採購、設計研擬與行政成本，恕不予退還。
            </p>
            <p>
              為追求結構的極致穩固與精準度，圖面核對完成即視為「最終製作規格」。
            </p>
            <p>
              進入正式生產排程後，恕不接受品項、尺寸或細節變更。若因不可抗力或特殊需求需進行重大變動，客戶需負擔已產生之全額材料損失與延伸工時費用，且交期將依實際進度重新調整。
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

