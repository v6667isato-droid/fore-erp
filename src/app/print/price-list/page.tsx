"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
  SERIES_SELECT,
  SERIES_SELECT_NO_WEBSITE,
  VARIANT_SELECT,
  SERIES_SELECT_MINIMAL,
  VARIANT_SELECT_MINIMAL,
} from "@/lib/products-db";
import type { SeriesRow, VariantRow } from "@/types/products";
import {
  buildPriceListRows,
  groupPriceListRowsByCategory,
  parsePriceListCategoriesFromSearchParams,
  priceListCategoryLabel,
  type PriceListRow,
} from "@/lib/price-list";
import { Loader2 } from "lucide-react";

function mapSeries(r: Record<string, unknown>): SeriesRow {
  const nameVal = r.name ?? r.series_name;
  return {
    id: String(r.id),
    name: String(nameVal ?? ""),
    category: String(r.category ?? ""),
    notes: r.notes != null ? String(r.notes) : null,
    production_time: r.production_time != null ? String(r.production_time) : null,
    code_rule: r.code_rule != null ? String(r.code_rule) : null,
    design_concept: r.design_concept != null ? String(r.design_concept) : null,
    faq_scripts: r.faq_scripts != null ? String(r.faq_scripts) : null,
    social_media_copy: r.social_media_copy != null ? String(r.social_media_copy) : null,
    website_article: r.website_article != null ? String(r.website_article) : null,
    customization_rules: r.customization_rules != null ? String(r.customization_rules) : null,
    website: r.website != null ? String(r.website) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
  };
}

function mapVariant(r: Record<string, unknown>): VariantRow {
  return {
    id: String(r.id),
    series_id: String(r.series_id ?? ""),
    product_code: String(r.product_code ?? ""),
    wood_type: String(r.wood_type ?? ""),
    dimension_w: r.dimension_w != null ? Number(r.dimension_w) : null,
    dimension_d: r.dimension_d != null ? Number(r.dimension_d) : null,
    dimension_h: r.dimension_h != null ? Number(r.dimension_h) : null,
    seat_height_cm: r.seat_height_cm != null ? Number(r.seat_height_cm) : null,
    base_price: r.base_price != null ? Number(r.base_price) : null,
    desktop_area: r.desktop_area != null ? Number(r.desktop_area) : null,
    spec1: r.spec1 != null ? String(r.spec1) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
  };
}

function formatPrintDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function PriceListTable({ rows }: { rows: PriceListRow[] }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm leading-snug">
      <thead>
        <tr className="border-b-2 border-gray-300 bg-gray-50">
          <th className="w-[4.5rem] px-1.5 py-2.5 text-left font-semibold text-gray-700">圖片</th>
          <th className="w-[6.5rem] px-2 py-2.5 text-left font-semibold text-gray-700">產品代碼</th>
          <th className="w-[4rem] px-1.5 py-2.5 text-left font-semibold text-gray-700">木種</th>
          <th className="min-w-[8rem] px-2 py-2.5 text-left font-semibold text-gray-700">尺寸</th>
          <th className="w-[3.5rem] px-1 py-2.5 text-right font-semibold text-gray-700">座高</th>
          <th className="w-[5.5rem] px-2 py-2.5 text-left font-semibold text-gray-700">規格</th>
          <th className="w-[5rem] px-2 py-2.5 text-right font-semibold text-gray-700">建議售價</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const showSeriesHeader =
            index === 0 || rows[index - 1].seriesId !== row.seriesId;
          return (
            <FragmentRow
              key={row.variantId}
              row={row}
              showSeriesHeader={showSeriesHeader}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function FragmentRow({
  row,
  showSeriesHeader,
}: {
  row: PriceListRow;
  showSeriesHeader: boolean;
}) {
  const img = row.variantImageUrl;
  return (
    <>
      {showSeriesHeader && (
        <tr className="border-b border-gray-200 bg-gray-50/80">
          <td colSpan={7} className="px-2 py-2 font-semibold text-gray-900">
            {row.seriesName || "—"}
          </td>
        </tr>
      )}
      <tr className="border-b border-gray-100 align-top">
        <td className="px-1.5 py-2">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt=""
              className="h-14 w-14 rounded border border-gray-200 object-cover"
            />
          ) : (
            <span className="inline-flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-[10px] text-gray-400">
              無圖
            </span>
          )}
        </td>
        <td className="px-2 py-2 font-mono text-xs text-gray-900">{row.productCode || "—"}</td>
        <td className="px-1.5 py-2 text-gray-800">{row.woodType || "—"}</td>
        <td className="px-2 py-2 text-gray-800 break-words">{row.dimension || "—"}</td>
        <td className="px-1 py-2 text-right text-gray-800 tabular-nums">
          {row.seatHeightCm != null ? `${row.seatHeightCm}` : "—"}
        </td>
        <td className="px-2 py-2 text-gray-800 break-words">{row.spec1?.trim() || "—"}</td>
        <td className="px-2 py-2 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
          {row.basePrice != null ? row.basePrice.toLocaleString() : "—"}
        </td>
      </tr>
    </>
  );
}

function PriceListPrintBody() {
  const searchParams = useSearchParams();
  const categoryFilters = useMemo(
    () => parsePriceListCategoriesFromSearchParams((key) => searchParams.getAll(key)),
    [searchParams]
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [variantsList, setVariantsList] = useState<VariantRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    let seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT);
    if (seriesRes.error) {
      seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_NO_WEBSITE);
    }
    if (seriesRes.error) {
      seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_MINIMAL);
    }

    let variantsRes = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT);
    if (variantsRes.error) {
      variantsRes = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT_MINIMAL);
    }

    if (seriesRes.error || variantsRes.error) {
      setLoadError(seriesRes.error?.message || variantsRes.error?.message || "載入失敗");
      setSeriesList([]);
      setVariantsList([]);
      setLoading(false);
      return;
    }

    setSeriesList(
      (seriesRes.data ?? []).map((r) => mapSeries(r as unknown as Record<string, unknown>))
    );
    setVariantsList(
      (variantsRes.data ?? []).map((r) => mapVariant(r as unknown as Record<string, unknown>))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = useMemo(
    () => buildPriceListRows(seriesList, variantsList, categoryFilters),
    [seriesList, variantsList, categoryFilters]
  );

  const groups = useMemo(() => groupPriceListRowsByCategory(rows), [rows]);
  const showCategorySections = groups.length > 1;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin" />
        載入價目表…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={fetchData}
          className="text-sm font-medium text-gray-700 underline"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white px-6 py-8 shadow-lg print:shadow-none print:px-8 print:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
          <Link href="/print" className="text-xs text-gray-500 hover:text-gray-800">
            ← 列印頁面
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            列印 / 存成 PDF
          </button>
        </div>

        <header className="mb-6 border-b border-gray-200 pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <img
                src="/logo.png"
                alt="Føre Furniture"
                className="block h-16 w-auto object-contain object-left-top mb-3"
              />
              <h1 className="text-xl font-semibold text-gray-900">產品價目表</h1>
              <p className="mt-1 text-sm text-gray-600">建議售價 · 含稅與否請依公司對外說明為準</p>
            </div>
            <div className="text-sm text-gray-700 sm:text-right">
              <p>
                <span className="text-gray-500">類別：</span>
                {priceListCategoryLabel(categoryFilters)}
              </p>
              <p className="mt-1">
                <span className="text-gray-500">列印日期：</span>
                {formatPrintDate()}
              </p>
              <p className="mt-1">
                <span className="text-gray-500">規格數：</span>
                {rows.length}
              </p>
            </div>
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="text-sm text-gray-600 py-8 text-center">所選類別目前沒有產品規格。</p>
        ) : showCategorySections ? (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.category} className="break-inside-avoid">
                <h2 className="mb-3 text-base font-semibold text-gray-900 border-l-4 border-gray-800 pl-2">
                  {g.category}
                </h2>
                <PriceListTable rows={g.rows} />
              </section>
            ))}
          </div>
        ) : (
          <section>
            {categoryFilters.length === 1 ? (
              <h2 className="mb-3 text-base font-semibold text-gray-900">{categoryFilters[0]}</h2>
            ) : null}
            <PriceListTable rows={rows} />
          </section>
        )}

        <footer className="mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed print:mt-6">
          <p>電話：06-2302861 · 台南市歸仁區丁厝街125號 · 上班日 9:00–17:00</p>
          <p className="mt-1">本價目表僅供參考，實際售價與規格以訂單確認為準。</p>
        </footer>
      </div>
    </div>
  );
}

export default function PriceListPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center text-sm text-gray-600">
          載入價目表…
        </div>
      }
    >
      <PriceListPrintBody />
    </Suspense>
  );
}
