"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
  SERIES_SELECT,
  SERIES_SELECT_NO_WEBSITE,
  SERIES_SELECT_MINIMAL,
  VARIANT_SELECT,
  VARIANT_SELECT_MINIMAL,
} from "@/lib/products-db";
import type { SeriesRow, VariantRow } from "@/types/products";
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
    size_chart_urls: Array.isArray(r.size_chart_urls)
      ? (r.size_chart_urls as unknown[]).map((u) => String(u)).filter(Boolean)
      : [],
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

function formatDim(v: VariantRow): string {
  if (v.dimension_w == null && v.dimension_d == null && v.dimension_h == null) return "—";
  return `W${v.dimension_w ?? "—"} × D${v.dimension_d ?? "—"} × H${v.dimension_h ?? "—"}`;
}

function formatPrintDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export default function SeriesIntroPrintPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = use(params);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    let seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT).eq("id", seriesId).maybeSingle();
    if (seriesRes.error) {
      seriesRes = await supabase
        .from(TABLE_PRODUCT_SERIES)
        .select(SERIES_SELECT_NO_WEBSITE)
        .eq("id", seriesId)
        .maybeSingle();
    }
    if (seriesRes.error) {
      seriesRes = await supabase
        .from(TABLE_PRODUCT_SERIES)
        .select(SERIES_SELECT_MINIMAL)
        .eq("id", seriesId)
        .maybeSingle();
    }

    let variantsRes = await supabase
      .from(TABLE_PRODUCT_VARIANTS)
      .select(VARIANT_SELECT)
      .eq("series_id", seriesId)
      .is("deleted_at", null);
    if (variantsRes.error) {
      variantsRes = await supabase
        .from(TABLE_PRODUCT_VARIANTS)
        .select(VARIANT_SELECT_MINIMAL)
        .eq("series_id", seriesId)
        .is("deleted_at", null);
    }

    if (seriesRes.error) {
      setLoadError(seriesRes.error.message || "載入失敗");
      setLoading(false);
      return;
    }
    if (!seriesRes.data) {
      setLoadError("找不到此系列");
      setLoading(false);
      return;
    }

    setSeries(mapSeries(seriesRes.data as unknown as Record<string, unknown>));
    setVariants(
      (variantsRes.data ?? []).map((r) => mapVariant(r as unknown as Record<string, unknown>))
    );
    setLoading(false);
  }, [seriesId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sortedVariants = useMemo(
    () =>
      [...variants].sort((a, b) => (a.product_code || "").localeCompare(b.product_code || "")),
    [variants]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin" />
        載入產品介紹表…
      </div>
    );
  }

  if (loadError || !series) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-red-600">{loadError || "找不到此系列"}</p>
        <button type="button" onClick={fetchData} className="text-sm font-medium text-gray-700 underline">
          重試
        </button>
      </div>
    );
  }

  const sizeCharts = series.size_chart_urls ?? [];

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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Føre Furniture"
                className="block h-14 w-auto object-contain object-left-top mb-3"
              />
              <h1 className="text-2xl font-semibold text-gray-900">{series.name || "—"}</h1>
              <p className="mt-1 text-sm text-gray-600">產品介紹表 · Product Sheet</p>
            </div>
            <div className="text-sm text-gray-700 sm:text-right">
              {series.category?.trim() && (
                <p>
                  <span className="text-gray-500">類別：</span>
                  {series.category}
                </p>
              )}
              {series.production_time?.trim() && (
                <p className="mt-1">
                  <span className="text-gray-500">交期：</span>約 {series.production_time} 週
                </p>
              )}
              <p className="mt-1">
                <span className="text-gray-500">製表日期：</span>
                {formatPrintDate()}
              </p>
            </div>
          </div>
        </header>

        {/* 主視覺圖 */}
        {series.image_url && (
          <section className="mb-6 break-inside-avoid">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={series.image_url}
              alt={series.name || "系列主視覺"}
              className="mx-auto max-h-[95mm] w-auto max-w-full rounded-lg border border-gray-200 object-contain"
            />
          </section>
        )}

        {/* 設計理念 */}
        {series.design_concept?.trim() && (
          <section className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-base font-semibold text-gray-900 border-l-4 border-gray-800 pl-2">
              設計理念
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {series.design_concept}
            </p>
          </section>
        )}

        {/* 規格與報價 */}
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold text-gray-900 border-l-4 border-gray-800 pl-2">
            規格與報價
          </h2>
          {sortedVariants.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">此系列尚無規格資料。</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-sm leading-snug">
              <thead>
                <tr className="border-b-2 border-gray-300 bg-gray-50">
                  <th className="w-[7rem] px-2 py-2.5 text-left font-semibold text-gray-700">產品代碼</th>
                  <th className="w-[4.5rem] px-1.5 py-2.5 text-left font-semibold text-gray-700">木種</th>
                  <th className="px-2 py-2.5 text-left font-semibold text-gray-700">尺寸 (cm)</th>
                  <th className="w-[4rem] px-1 py-2.5 text-right font-semibold text-gray-700">座高</th>
                  <th className="w-[5.5rem] px-2 py-2.5 text-left font-semibold text-gray-700">規格</th>
                  <th className="w-[6rem] px-2 py-2.5 text-right font-semibold text-gray-700">報價</th>
                </tr>
              </thead>
              <tbody>
                {sortedVariants.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100 align-top">
                    <td className="px-2 py-2 font-mono text-xs text-gray-900">{v.product_code || "—"}</td>
                    <td className="px-1.5 py-2 text-gray-800">{v.wood_type || "—"}</td>
                    <td className="px-2 py-2 text-gray-800 break-words">{formatDim(v)}</td>
                    <td className="px-1 py-2 text-right text-gray-800 tabular-nums">
                      {v.seat_height_cm != null ? v.seat_height_cm : "—"}
                    </td>
                    <td className="px-2 py-2 text-gray-800 break-words">{v.spec1?.trim() || "—"}</td>
                    <td className="px-2 py-2 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
                      {v.base_price != null ? `NT$ ${v.base_price.toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 尺寸圖 */}
        {sizeCharts.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-base font-semibold text-gray-900 border-l-4 border-gray-800 pl-2">
              尺寸圖
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {sizeCharts.map((url, i) => (
                <div key={url} className="break-inside-avoid rounded-lg border border-gray-200 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`尺寸圖 ${i + 1}`}
                    className="mx-auto max-h-[85mm] w-auto max-w-full object-contain"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 客製與保養 */}
        {series.customization_rules?.trim() && (
          <section className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-base font-semibold text-gray-900 border-l-4 border-gray-800 pl-2">
              客製與保養
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {series.customization_rules}
            </p>
          </section>
        )}

        <footer className="mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed print:mt-6">
          <p>電話：06-2302861 · 台南市歸仁區丁厝街125號 · 上班日 9:00–17:00</p>
          <p className="mt-1">本介紹表僅供參考，實際售價與規格以訂單確認為準。</p>
        </footer>
      </div>
    </div>
  );
}
