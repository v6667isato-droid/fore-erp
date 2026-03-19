'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
  explanation_image_url?: string | null;
}

type ExplanationImage = { url: string; title?: string | null };

function parseExplanationImages(raw: string | null | undefined): ExplanationImage[] {
  if (raw == null || raw === '') return [];
  const normalizeUrl = (u: unknown): string | null => {
    if (typeof u !== 'string') return null;
    const s = u.trim();
    return s ? s : null;
  };
  const normalizeTitle = (t: unknown): string | null => {
    if (typeof t !== 'string') return null;
    const s = t.trim();
    return s ? s : null;
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed.every((x) => typeof x === 'string')) {
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
    if (typeof parsed === 'string') {
      const url = normalizeUrl(parsed);
      return url ? [{ url }] : [];
    }
    return [];
  } catch {
    const url = normalizeUrl(raw);
    return url ? [{ url }] : [];
  }
}

interface PrintOrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  custom_notes: string | null;
  kind: 'variant' | 'custom';
  name: string;
  description?: string | null;
  image_url?: string | null;
  wood_type?: string | null;
  dimension_text?: string | null;
  spec_text?: string | null;
}

export default function PrintQuotationPage() {
  const params = useParams<{ orderId: string }>();
  const rawOrderId = params?.orderId;

  const orderId =
    typeof rawOrderId === 'string' ? decodeURIComponent(rawOrderId) : undefined;

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
          .from('orders')
          .select(
            'id, order_number, order_date, expected_delivery_date, status, total_amount, deposit_amount, explanation_image_url, customer_id, customers(name, phone, delivery_address, customer_type)'
          )
          .eq('id', orderId)
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || '找不到此訂單');
        }

        const safeTotal = Number(orderRow.total_amount ?? 0);

        const lineRes = await supabase
          .from('order_items')
          .select(
            'id, order_id, variant_id, quantity, unit_price, custom_notes, custom_category, custom_name, custom_description, custom_dimension_w, custom_dimension_d, custom_dimension_h, image_url, wood_type'
          )
          .eq('order_id', orderId);

        if (lineRes.error) {
          throw new Error(lineRes.error.message || '讀取訂單明細失敗');
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
            spec1: string | null;
          }
        > = {};
        let seriesMap: Record<
          string,
          { id: string; name: string; image_url: string | null }
        > = {};

        if (variantIds.length > 0) {
          const { data: variants, error: variantErr } = await supabase
            .from('product_variants')
            .select('id, series_id, product_code, image_url, wood_type, dimension_w, dimension_d, dimension_h, spec1')
            .in('id', variantIds);

          if (variantErr) {
            throw new Error(variantErr.message || '讀取產品規格失敗');
          }

          variantMap = Object.fromEntries(
            (variants ?? []).map((v: any) => [
              String(v.id),
              {
                id: String(v.id),
                product_code: String(v.product_code ?? ''),
                series_id: v.series_id ? String(v.series_id) : null,
                image_url: v.image_url ?? null,
                wood_type: v.wood_type ?? null,
                dimension_w: v.dimension_w != null ? Number(v.dimension_w) : null,
                dimension_d: v.dimension_d != null ? Number(v.dimension_d) : null,
                dimension_h: v.dimension_h != null ? Number(v.dimension_h) : null,
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
              .from('product_series')
              .select('id, series_name, image_url')
              .in('id', seriesIds);

            if (seriesErr) {
              throw new Error(seriesErr.message || '讀取產品系列失敗');
            }

            seriesMap = Object.fromEntries(
              (seriesRows ?? []).map((s: any) => [
                String(s.id),
                {
                  id: String(s.id),
                  name: String(s.series_name ?? ''),
                  image_url: s.image_url ?? null,
                },
              ])
            );
          }
        }

        const itemWoodType = (r: any): string | null => {
          const w = r.wood_type;
          if (w == null || String(w).trim() === '') return null;
          return String(w).trim();
        };

        const mappedItems: PrintOrderItem[] = itemRows.map(
          (r: any, idx: number) => {
            const isCustom = !r.variant_id;

            if (isCustom) {
              const nameParts: string[] = [];
              if (r.custom_category) nameParts.push(String(r.custom_category));
              if (r.custom_name) nameParts.push(String(r.custom_name));
              const name =
                nameParts.length > 0 ? nameParts.join(' ') : '客製品項';

              const descParts: string[] = [];
              if (r.custom_description)
                descParts.push(String(r.custom_description));
              // 尺寸不加入 description（另有尺寸欄位顯示），備註列不顯示尺寸

              const hasDims =
                r.custom_dimension_w != null ||
                r.custom_dimension_d != null ||
                r.custom_dimension_h != null;
              const dimText = hasDims
                ? `${r.custom_dimension_w ?? '—'} × ${r.custom_dimension_d ?? '—'} × ${r.custom_dimension_h ?? '—'}`
                : null;

              return {
                id: String(r.id ?? `item-${idx}`),
                quantity: Number(r.quantity ?? 1),
                unit_price: Number(r.unit_price ?? 0),
                custom_notes: r.custom_notes ?? null,
                kind: 'custom',
                name,
                description:
                  descParts.length > 0 ? descParts.join('；') : null,
                image_url: r.image_url ?? null,
                wood_type: itemWoodType(r),
                dimension_text: dimText,
                spec_text: null,
              };
            }

            const variant = variantMap[String(r.variant_id)] || null;
            const series = variant?.series_id
              ? seriesMap[variant.series_id] || null
              : null;

            // 規格品：報價品項只顯示系列名稱（規格、木種、尺寸另有欄位）
            const name =
              series?.name || variant?.product_code || '產品項目';

            const imageUrl = r.image_url ?? variant?.image_url ?? series?.image_url ?? null;

            const hasVariantDims =
              variant?.dimension_w != null ||
              variant?.dimension_d != null ||
              variant?.dimension_h != null;
            const dimText = hasVariantDims
              ? `${variant?.dimension_w ?? '—'} × ${variant?.dimension_d ?? '—'} × ${variant?.dimension_h ?? '—'}`
              : null;

            return {
              id: String(r.id ?? `item-${idx}`),
              quantity: Number(r.quantity ?? 1),
              unit_price: Number(r.unit_price ?? 0),
              custom_notes: r.custom_notes ?? null,
              kind: 'variant',
              name,
              description: null,
              image_url: imageUrl,
              wood_type: itemWoodType(r),
              dimension_text: dimText,
              spec_text: variant?.spec1 ?? null,
            };
          }
        );

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
          order_number: String(orderRow.order_number ?? ''),
          order_date: orderRow.order_date ?? null,
          expected_delivery_date: orderRow.expected_delivery_date ?? null,
          status: orderRow.status ?? null,
          total_amount: safeTotal,
          original_amount: originalAmount,
          discount_amount: discountAmount,
          customer_name: customer?.name ?? '',
          customer_phone: customer?.phone ?? null,
          customer_address: customer?.delivery_address ?? null,
          customer_type: customer?.customer_type ?? null,
          deposit_amount: Number(orderRow.deposit_amount ?? 0),
          explanation_image_url: orderRow.explanation_image_url ?? null,
        });

        setItems(mappedItems);
      } catch (err) {
        console.error(err);
        setLoadError(
          err instanceof Error ? err.message : '讀取訂單資料失敗'
        );
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [orderId]);

  const totals = useMemo(() => {
    if (!order) {
      const raw = items.reduce(
        (sum, it) => sum + it.quantity * it.unit_price,
        0
      );
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

  // 另存 PDF 時讓檔名為「日期_客戶姓名」（須在條件 return 前呼叫，遵守 Hooks 順序）
  useEffect(() => {
    if (!order) return;
    const dateStr = order.order_date
      ? new Date(order.order_date).toISOString().slice(0, 10).replace(/-/g, '')
      : '';
    const safeName = (order.customer_name || '未填').replace(/[/\\:*?"<>|]/g, '').trim() || '客戶';
    const title = `${dateStr}_${safeName}`;
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [order]);

  const formattedDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('zh-TW') : '—';

  if (!orderId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">無效的報價連結</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-600">載入報價中…</p>
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-red-600">{loadError || '找不到報價'}</p>
      </div>
    );
  }

  const showDiscountRow =
    (order.customer_type && order.customer_type === '通路') ||
    totals.discount > 0;

  const depositPercent =
    order.total_amount > 0
      ? Math.round((order.deposit_amount / order.total_amount) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black px-6 py-8 shadow-lg print:shadow-none print:px-10 print:py-8">
        <div className="flex justify-end mb-6 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <span>🖨️ 列印 / 存成 PDF</span>
          </button>
        </div>

        <header className="mb-10 border-b border-gray-200 pb-8">
          <div className="flex items-start justify-between gap-8">
            <div className="flex flex-col items-start gap-3">
              <img
                src="/logo.png"
                alt="Føre Furniture"
                className="h-24 object-contain"
              />
              <div className="space-y-1 text-xs text-gray-700 leading-relaxed">
                <p>電話：06-2302861</p>
                <p>地址：台南市歸仁區丁厝街125號</p>
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
              </div>
            </div>
            <div className="text-right space-y-2 text-sm text-gray-700 leading-relaxed">
              <p className="text-lg font-semibold text-gray-900">報價單</p>
              <p>
                報價單號：<span className="font-mono text-gray-900">{order.order_number}</span>
              </p>
              <p>報價日期：<span>{formattedDate(order.order_date)}</span></p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-8 text-sm leading-relaxed">
            <div className="space-y-2">
              <p className="font-semibold text-gray-900">客戶資訊</p>
              <p className="text-gray-800">
                客戶名稱：<span className="font-medium">{order.customer_name || '—'}</span>
              </p>
              {order.customer_phone && (
                <p className="text-gray-800">聯絡電話：{order.customer_phone}</p>
              )}
              {order.customer_address && (
                <p className="text-gray-800">送貨地址：{order.customer_address}</p>
              )}
            </div>
            <div />
          </div>
        </header>

        <section className="mb-4">
          <p className="text-sm font-semibold text-gray-900">報價內容</p>
        </section>

        <section className="mb-8">
          <table className="w-full border-collapse text-sm leading-snug">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-50">
                <th className="w-16 px-3 py-3 text-left font-semibold text-gray-700">圖片</th>
                <th className="min-w-[140px] px-3 py-3 text-left font-semibold text-gray-700">報價品項</th>
                <th className="w-20 px-3 py-3 text-left font-semibold text-gray-700">木種</th>
                <th className="w-32 px-3 py-3 text-left font-semibold text-gray-700">尺寸(cm)</th>
                <th className="w-24 px-3 py-3 text-left font-semibold text-gray-700">規格</th>
                <th className="w-14 px-3 py-3 text-right font-semibold text-gray-700">數量</th>
                <th className="w-20 px-3 py-3 text-right font-semibold text-gray-700">單價</th>
                <th className="w-24 px-3 py-3 text-right font-semibold text-gray-700">小計</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-8 text-center text-sm text-gray-500 border-b border-gray-200"
                  >
                    此報價目前尚無明細
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const lineTotal = item.quantity * item.unit_price;
                  const customNotesTrimmed = item.custom_notes == null ? '' : String(item.custom_notes).trim();
                  const descriptionTrimmed = item.description == null ? '' : String(item.description).trim();
                  const hasCustomNotes = customNotesTrimmed !== '';
                  const hasDescription = descriptionTrimmed !== '';
                  // 規格品：有 custom_notes 才顯示備註列；客製品：有 description 或 custom_notes 就顯示備註列
                  const hasNotes = hasCustomNotes || (item.kind === 'custom' && hasDescription);
                  const notesContent =
                    item.kind === 'custom'
                      ? [descriptionTrimmed, customNotesTrimmed].filter(Boolean).join('\n')
                      : customNotesTrimmed;
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-b border-gray-200 align-top">
                        <td className="px-3 py-3">
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
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-900">{item.name}</div>
                          {item.kind === 'variant' && item.description && (
                            <div className="mt-1 text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                              {item.description}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-gray-700">{item.wood_type ?? '—'}</td>
                        <td className="px-3 py-3 text-gray-700 text-xs leading-relaxed">
                          {item.dimension_text ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-gray-700 font-mono text-xs">
                          {item.spec_text ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-900 tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-900 tabular-nums">
                          {item.unit_price.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-900 font-medium tabular-nums">
                          {lineTotal.toLocaleString()}
                        </td>
                      </tr>
                      {hasNotes && (
                        <tr className="border-b border-gray-200">
                          <td className="px-3 py-2 text-sm font-medium text-gray-600 align-top">備註</td>
                          <td colSpan={7} className="px-3 py-2 align-top text-sm text-gray-800 whitespace-pre-line">
                            {notesContent}
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

        <section className="flex justify-end mb-8">
          <div className="w-full max-w-xs space-y-3 text-sm leading-relaxed">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">商品總計</span>
              <span className="text-gray-900 tabular-nums">{totals.original.toLocaleString()}</span>
            </div>
            {showDiscountRow && (
              <div className="flex items-center justify-between">
                <span className="text-gray-700">通路 / 專案折扣</span>
                <span className="text-gray-900 tabular-nums">{totals.discount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <span className="font-semibold text-gray-900">報價總金額</span>
              <span className="font-semibold text-gray-900 tabular-nums">{totals.total.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">訂金</span>
              <span className="text-gray-900 tabular-nums">
                {order.deposit_amount.toLocaleString()}
                {depositPercent > 0 && (
                  <span className="ml-1 text-gray-600">({depositPercent}%)</span>
                )}
              </span>
            </div>
          </div>
        </section>

        <div className="mb-8 space-y-1 text-sm text-gray-600 leading-relaxed">
          <p>備註：此報價單內容如有疑義，請於 3 日內與我們聯繫確認。</p>
          <p>本報價單效期為一個月。</p>
        </div>

        <footer className="pt-6 border-t border-gray-200 space-y-6 text-sm text-gray-800 leading-relaxed">
          {parseExplanationImages(order.explanation_image_url).length > 0 && (
            <div className="space-y-5">
              {parseExplanationImages(order.explanation_image_url).map((img, idx) => (
                <div key={idx} className="space-y-2">
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

          <div className="space-y-2">
            <p className="font-semibold text-gray-900">匯款帳號資訊</p>
            <div className="space-y-1.5 leading-snug">
              <p>銀行名稱：台灣銀行 安南分行（銀行代碼 004）</p>
              <p>戶名：蔡秉學</p>
              <p>帳號：137-004-356269</p>
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
          </div>
        </footer>
      </div>
    </div>
  );
}

