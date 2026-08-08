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
  groupPriceListRowsBySeries,
  parsePriceListCategoriesFromSearchParams,
  parsePriceListSeriesIdsFromSearchParams,
  parsePriceListValidUntil,
  priceListCategoryLabel,
  type PriceListRow,
} from "@/lib/price-list";
import {
  categoryLabel,
  footerContact,
  parseSheetLang,
  woodTypeLabel,
} from "@/lib/product-sheet";
import { Loader2 } from "lucide-react";

/**
 * 價目表：直式 A4，排版語言與產品介紹表一致（白底、細分隔線、無色塊）。
 * 定位：介紹表（品牌文件，無價格）→ 價目表（全系列，有日期效期）→ 報價單（單一客戶訂單）。
 * 只列 show_on_sheet = true 的規格（與介紹表共用同一勾選）。
 */

function mapSeries(r: Record<string, unknown>): SeriesRow {
  const nameVal = r.name ?? r.series_name;
  return {
    id: String(r.id),
    name: String(nameVal ?? ""),
    name_en: r.name_en != null ? String(r.name_en) : null,
    category: String(r.category ?? ""),
    image_url: r.image_url != null ? String(r.image_url) : null,
  } as SeriesRow;
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
    desktop_area: null,
    spec1: r.spec1 != null ? String(r.spec1) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
    is_custom_order: r.is_custom_order === true,
    show_on_sheet: r.show_on_sheet === true,
    show_on_price_list: r.show_on_price_list === true,
    dimension_drawing_url: null,
  };
}

function formatPrintDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/** YYYY-MM-DD → YYYY/MM/DD */
function formatValidUntil(iso: string): string {
  return iso.replaceAll("-", "/");
}

/** 尺寸欄：W × D × H，椅類補 SH 座高 */
function formatRowDimension(row: PriceListRow): string {
  const base = row.dimension || "—";
  return row.seatHeightCm != null ? `${base} · SH${row.seatHeightCm}` : base;
}

function PriceListPrintBody() {
  const searchParams = useSearchParams();
  const categoryFilters = useMemo(
    () => parsePriceListCategoriesFromSearchParams((key) => searchParams.getAll(key)),
    [searchParams]
  );
  const seriesIdFilters = useMemo(
    () => parsePriceListSeriesIdsFromSearchParams((key) => searchParams.getAll(key)),
    [searchParams]
  );
  const validUntil = useMemo(
    () => parsePriceListValidUntil((key) => searchParams.get(key)),
    [searchParams]
  );
  const lang = useMemo(() => parseSheetLang((key) => searchParams.get(key)), [searchParams]);

  /** 切換語言的 URL（保留其餘參數） */
  const langUrl = useCallback(
    (target: "zh" | "en") => {
      const params = new URLSearchParams(searchParams.toString());
      if (target === "en") params.set("lang", "en");
      else params.delete("lang");
      const qs = params.toString();
      return qs ? `/print/price-list?${qs}` : "/print/price-list";
    },
    [searchParams]
  );

  const [autoPrint, setAutoPrint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [variantsList, setVariantsList] = useState<VariantRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    type LooseRes = { data: unknown[] | null; error: { message: string } | null };
    let seriesRes: LooseRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT).is("deleted_at", null);
    if (seriesRes.error) {
      seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_NO_WEBSITE).is("deleted_at", null);
    }
    if (seriesRes.error) {
      seriesRes = await supabase.from(TABLE_PRODUCT_SERIES).select(SERIES_SELECT_MINIMAL).is("deleted_at", null);
    }

    let variantsRes: LooseRes = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT).is("deleted_at", null);
    if (variantsRes.error) {
      variantsRes = await supabase.from(TABLE_PRODUCT_VARIANTS).select(VARIANT_SELECT_MINIMAL).is("deleted_at", null);
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

  useEffect(() => {
    document.title = `價目表_${formatPrintDate().replaceAll("/", "")}`;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") === "1") setAutoPrint(true);
  }, []);

  const rows = useMemo(
    () => buildPriceListRows(seriesList, variantsList, categoryFilters, seriesIdFilters),
    [seriesList, variantsList, categoryFilters, seriesIdFilters]
  );
  const groups = useMemo(() => groupPriceListRowsBySeries(rows), [rows]);

  useEffect(() => {
    if (!autoPrint || loading || loadError) return;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [autoPrint, loading, loadError]);

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
    <div className="pricelist-root">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 14mm 15mm;
        }
        .pricelist-root {
          min-height: 100vh;
          background: #e9e7e2;
          padding: 1.5rem 0.75rem 3rem;
        }
        .pricelist-sheet {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #fff;
          color: #1c1c1c;
          padding: 14mm 15mm;
          box-shadow: 0 2px 14px rgba(0, 0, 0, 0.12);
          box-sizing: border-box;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .pricelist-en {
          letter-spacing: 0.04em;
        }
        .pricelist-group {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        @media print {
          .pricelist-root {
            background: #fff;
            padding: 0;
          }
          .pricelist-toolbar {
            display: none;
          }
          .pricelist-sheet {
            width: auto;
            min-height: 0;
            margin: 0;
            padding: 0;
            box-shadow: none;
          }
        }
      `}</style>

      <div className="pricelist-toolbar mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Link href="/print" className="text-xs text-gray-500 hover:text-gray-800">
          ← 列印頁面
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {rows.length === 0 && (
            <span className="text-xs text-amber-700">
              所選範圍沒有勾選「顯示於價目表」的規格
            </span>
          )}
          <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs font-medium">
            <Link
              href={langUrl("zh")}
              className={lang === "zh" ? "bg-gray-800 px-3 py-2 text-white" : "px-3 py-2 text-gray-700 hover:bg-gray-50"}
            >
              中文
            </Link>
            <Link
              href={langUrl("en")}
              className={lang === "en" ? "bg-gray-800 px-3 py-2 text-white" : "px-3 py-2 text-gray-700 hover:bg-gray-50"}
            >
              English
            </Link>
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            列印 / 存成 PDF
          </button>
        </div>
      </div>

      <div className="pricelist-sheet">
        {/* 頁首：標題左、logo 右 */}
        <header className="flex items-start justify-between">
          <div>
            <h1 style={{ fontSize: "13pt", fontWeight: 600, letterSpacing: "0.1em" }}>
              {lang === "en" ? (
                <span className="pricelist-en">Price List</span>
              ) : (
                <>
                  價目表 <span className="pricelist-en" style={{ fontWeight: 400 }}>Price List</span>
                </>
              )}
            </h1>
            <p style={{ fontSize: "7.5pt", color: "#8a8a8a", marginTop: "3mm" }}>
              {lang === "en" ? (
                <>
                  Date {formatPrintDate()}　·　Valid until {formatValidUntil(validUntil)}
                  {categoryFilters.length > 0 && (
                    <>　·　{categoryFilters.map((c) => categoryLabel(c, "en")).join(", ")}</>
                  )}
                </>
              ) : (
                <>
                  製表日期 {formatPrintDate()}　·　有效期限至 {formatValidUntil(validUntil)}
                  {categoryFilters.length > 0 && <>　·　{priceListCategoryLabel(categoryFilters)}</>}
                </>
              )}
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Føre Furniture" style={{ height: "18mm" }} className="w-auto object-contain" />
        </header>

        {/* 表頭欄位說明列 */}
        {rows.length > 0 && (
          <div
            className="flex items-baseline"
            style={{
              marginTop: "10mm",
              paddingBottom: "1.5mm",
              borderBottom: "0.5pt solid #1c1c1c",
              fontSize: "7pt",
              color: "#8a8a8a",
            }}
          >
            <span style={{ width: "30%" }}>{lang === "en" ? "Product code" : "產品代碼"}</span>
            <span style={{ width: "18%" }}>{lang === "en" ? "Wood" : "木種"}</span>
            <span style={{ width: "34%" }}>{lang === "en" ? "Dimensions (cm)" : "尺寸（cm）"}</span>
            <span style={{ width: "18%", textAlign: "right" }}>{lang === "en" ? "Price" : "報價"}</span>
          </div>
        )}

        {rows.length === 0 ? (
          <p style={{ fontSize: "9pt", color: "#9a9a9a", padding: "20mm 0", textAlign: "center" }}>
            {lang === "en" ? "No items in the selected scope." : "所選範圍目前沒有可列出的規格。"}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.seriesId} className="pricelist-group" style={{ marginTop: "7mm" }}>
              <h2 style={{ fontSize: "8.5pt", fontWeight: 600, letterSpacing: "0.05em" }}>
                {lang === "en" ? g.seriesNameEn || g.seriesName : g.seriesName}
                {g.category?.trim() && (
                  <span style={{ marginLeft: "0.75em", fontWeight: 400, color: "#999", fontSize: "7pt" }}>
                    {categoryLabel(g.category, lang)}
                  </span>
                )}
              </h2>
              <div style={{ marginTop: "1.5mm" }}>
                {g.rows.map((row) => (
                  <div
                    key={row.variantId}
                    className="flex items-baseline"
                    style={{
                      borderBottom: "0.25pt solid #d8d8d8",
                      padding: "2mm 0",
                      fontSize: "7.5pt",
                    }}
                  >
                    <span className="pricelist-en" style={{ width: "30%" }}>
                      {row.productCode || "—"}
                    </span>
                    <span style={{ width: "18%", color: "#555" }}>
                      {row.woodType ? woodTypeLabel(row.woodType, lang) : "—"}
                    </span>
                    <span className="pricelist-en" style={{ width: "34%", color: "#555" }}>
                      {formatRowDimension(row)}
                    </span>
                    <span className="pricelist-en" style={{ width: "18%", textAlign: "right" }}>
                      {row.basePrice != null ? `NT$ ${row.basePrice.toLocaleString()}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {/* 頁尾：聯絡資訊＋聲明 */}
        <footer style={{ marginTop: "14mm" }}>
          <p style={{ fontSize: "6.5pt", color: "#8a8a8a", letterSpacing: "0.02em" }}>
            {footerContact(lang)}
          </p>
          <p style={{ fontSize: "6.5pt", color: "#8a8a8a", marginTop: "1.5mm" }}>
            {lang === "en"
              ? "Prices are for reference only; actual prices are subject to the official quotation."
              : "本價目表僅供參考，實際售價以報價單為準。"}
          </p>
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
