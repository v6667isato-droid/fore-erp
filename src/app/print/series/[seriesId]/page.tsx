"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
  TABLE_SERIES_SWATCHES,
  SERIES_SELECT,
  SERIES_SELECT_NO_WEBSITE,
  SERIES_SELECT_MINIMAL,
  VARIANT_SELECT,
  VARIANT_SELECT_MINIMAL,
} from "@/lib/products-db";
import type { SeriesRow, VariantRow } from "@/types/products";
import {
  DEFAULT_WOOD_CODES,
  categoryLabel,
  footerContact,
  stripWoodCode,
  type SheetLang,
} from "@/lib/product-sheet";
import { Loader2 } from "lucide-react";

/**
 * 產品介紹表：A4 橫向兩頁（Time & Style 風格）。
 * 第一頁：產品照片＋設計理念（左圖右文）；第二頁：variant 尺寸線圖＋規格＋材料色樣。
 * 質感來自留白與對齊：全頁白底黑灰文字，無色塊無框線裝飾。
 */

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
    customization_rules: r.customization_rules != null ? String(r.customization_rules) : null,
    website: r.website != null ? String(r.website) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
    size_chart_urls: [],
    detail_image_urls: Array.isArray(r.detail_image_urls)
      ? (r.detail_image_urls as unknown[]).map((u) => String(u)).filter(Boolean)
      : [],
    show_price_on_sheet: r.show_price_on_sheet === true,
    name_en: r.name_en != null ? String(r.name_en) : null,
    design_concept_en: r.design_concept_en != null ? String(r.design_concept_en) : null,
    customization_rules_en: r.customization_rules_en != null ? String(r.customization_rules_en) : null,
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
    arm_height_cm: r.arm_height_cm != null ? Number(r.arm_height_cm) : null,
    base_price: r.base_price != null ? Number(r.base_price) : null,
    desktop_area: null,
    spec1: r.spec1 != null ? String(r.spec1) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
    is_custom_order: r.is_custom_order === true,
    show_on_sheet: r.show_on_sheet === true,
    show_on_price_list: r.show_on_price_list === true,
    dimension_drawing_url: r.dimension_drawing_url != null ? String(r.dimension_drawing_url) : null,
  };
}

type SheetSwatch = {
  id: string;
  category: "wood" | "fabric" | "door" | "cloth";
  name: string;
  name_en: string | null;
  image_url: string;
};

/** 數字轉 cm 文字：小數只在有值時顯示（46.5 → "46.5"、46 → "46"） */
function formatCm(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v);
}

/**
 * 從線圖檔名解析裁切後像素尺寸（uuid_WxH.png）。
 * 有尺寸 → 以 300DPI 換算定寬渲染（上限＝格寬，高度不限）；提高匯出 DPI 可讓圖變大。
 * 無尺寸（舊檔）→ fallback 塞 33mm 高的盒子。
 */
function parseDrawingSize(url: string): { w: number; h: number } | null {
  const m = url.match(/_(\d+)x(\d+)\.png(?:\?|$)/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** 300DPI：1px = 25.4/300 mm */
const DRAWING_MM_PER_PX = 25.4 / 300;

/** W × D × H 尺寸行（只組出有值的部分） */
function formatDims(v: VariantRow): string {
  const parts: string[] = [];
  if (v.dimension_w != null) parts.push(`W${formatCm(v.dimension_w)}`);
  if (v.dimension_d != null) parts.push(`D${formatCm(v.dimension_d)}`);
  if (v.dimension_h != null) parts.push(`H${formatCm(v.dimension_h)}`);
  return parts.join(" × ");
}

export default function SeriesIntroPrintPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = use(params);
  // 官網「下載 PDF」按鈕會帶 ?autoprint=1，載入完成後自動開啟列印（存成 PDF）對話框
  const [autoPrint, setAutoPrint] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [swatches, setSwatches] = useState<SheetSwatch[]>([]);
  const [lang, setLang] = useState<SheetLang>("zh");
  /** 木種代號清單（option_values wood 軸），讀不到時用預設；線圖格顯示代碼會跳過這些段 */
  const [woodCodes, setWoodCodes] = useState<string[]>(DEFAULT_WOOD_CODES);

  /** 切換語言：同步網址參數，方便直接分享英文版連結 */
  const switchLang = useCallback((target: SheetLang) => {
    setLang(target);
    const params = new URLSearchParams(window.location.search);
    if (target === "en") params.set("lang", "en");
    else params.delete("lang");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

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

    // 完整欄位與 fallback 欄位集合不同（fallback 少 arm_height_cm），故放寬型別
    type LooseRes = { data: unknown[] | null; error: { message: string } | null };
    let variantsRes: LooseRes = await supabase
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

    // 木種代號清單（線圖格顯示代碼要跳過的段）；讀不到時沿用預設
    const woodCodeRes = await supabase
      .from("option_values")
      .select("code, option_types!inner(code)")
      .eq("option_types.code", "wood");
    if (!woodCodeRes.error && woodCodeRes.data) {
      const fetched = (woodCodeRes.data as { code: string }[]).map((r) => String(r.code)).filter(Boolean);
      setWoodCodes([...new Set([...fetched, ...DEFAULT_WOOD_CODES])]);
    }

    // 介紹表色樣（依系列勾選順序；讀不到不阻擋頁面，色樣區整段不渲染）
    const swatchRes = await supabase
      .from(TABLE_SERIES_SWATCHES)
      .select("sort_order, material_swatches(id, category, name, name_en, image_url)")
      .eq("series_id", seriesId)
      .order("sort_order", { ascending: true });

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
    const swatchRows: SheetSwatch[] = [];
    for (const row of (swatchRes.data ?? []) as unknown as Record<string, unknown>[]) {
      const s = row.material_swatches as Record<string, unknown> | null;
      if (!s || !s.image_url) continue;
      swatchRows.push({
        id: String(s.id),
        category:
          s.category === "fabric" || s.category === "door" || s.category === "cloth"
            ? (s.category as "fabric" | "door" | "cloth")
            : "wood",
        name: String(s.name ?? ""),
        name_en: s.name_en != null ? String(s.name_en) : null,
        image_url: String(s.image_url),
      });
    }
    setSwatches(swatchRows);
    setLoading(false);
  }, [seriesId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") === "1") setAutoPrint(true);
    if (params.get("lang") === "en") setLang("en");
  }, []);

  useEffect(() => {
    if (series?.name) document.title = `產品介紹表_${series.name}`;
  }, [series?.name]);

  useEffect(() => {
    if (!autoPrint || loading || loadError || !series) return;
    // 等圖片載入完再列印，避免 PDF 缺圖
    const timer = setTimeout(() => window.print(), 800);
    return () => clearTimeout(timer);
  }, [autoPrint, loading, loadError, series]);

  /** 介紹表規格：勾選 show_on_sheet 且非訂製款，依產品代碼排序 */
  const sheetVariants = useMemo(
    () =>
      variants
        .filter((v) => v.show_on_sheet === true && !v.is_custom_order)
        .sort((a, b) => (a.product_code || "").localeCompare(b.product_code || "")),
    [variants]
  );

  /**
   * 線圖格：顯示代碼跳過木種代號（線稿展示不出木種），同款不同木種去重，
   * 優先保留有線圖的那筆；報價表仍列完整代碼（各木種價格可能不同）。
   */
  const sheetCells = useMemo(() => {
    const map = new Map<string, VariantRow & { displayCode: string }>();
    for (const v of sheetVariants) {
      const displayCode = stripWoodCode(v.product_code || "", woodCodes);
      const key = `${displayCode}|${v.dimension_w}|${v.dimension_d}|${v.dimension_h}|${v.seat_height_cm}|${v.arm_height_cm}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...v, displayCode });
      } else if (!existing.dimension_drawing_url?.trim() && v.dimension_drawing_url?.trim()) {
        map.set(key, { ...v, displayCode });
      }
    }
    return [...map.values()];
  }, [sheetVariants, woodCodes]);

  /** 分群順序：材種 → 門片 → 座墊 → 布樣（各群內依勾選順序） */
  const woodSwatches = useMemo(() => swatches.filter((s) => s.category === "wood"), [swatches]);
  const doorSwatches = useMemo(() => swatches.filter((s) => s.category === "door"), [swatches]);
  const fabricSwatches = useMemo(() => swatches.filter((s) => s.category === "fabric"), [swatches]);
  const clothSwatches = useMemo(() => swatches.filter((s) => s.category === "cloth"), [swatches]);

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

  const showPrice = series.show_price_on_sheet === true && sheetVariants.length > 0;
  const photos = [series.image_url, series.detail_image_urls?.[0]].filter(Boolean) as string[];
  const gridCols = showPrice ? 3 : 4;
  // 英文版：系列名／設計理念／客製與保養取英文欄位，留空 fallback 中文
  const displayName = (lang === "en" && series.name_en?.trim()) || series.name || "—";
  const displayConcept =
    (lang === "en" && series.design_concept_en?.trim()) || series.design_concept || "";
  const displayCustomization =
    (lang === "en" && series.customization_rules_en?.trim()) || series.customization_rules || "";
  const unitNote = lang === "en" ? "Unit: cm" : "尺寸單位: cm";
  // 類別＋交期（原第一頁頁尾）：移到第二頁與尺寸說明並列
  const specFootnote = [
    ...(lang === "en"
      ? [
          series.category?.trim() ? categoryLabel(series.category, "en") : null,
          series.production_time?.trim()
            ? `Lead time approx. ${series.production_time} weeks`
            : null,
        ]
      : [
          series.category?.trim() ? `類別 ${series.category}` : null,
          series.production_time?.trim() ? `交期約 ${series.production_time} 週` : null,
        ]),
    unitNote,
  ]
    .filter(Boolean)
    .join("　·　");

  return (
    <div className="sheet-root">
      <style>{`
        @page {
          size: A4 landscape;
          margin: 0;
        }
        .sheet-root {
          min-height: 100vh;
          background: #e9e7e2;
          padding: 1.5rem 0.75rem 3rem;
        }
        .sheet-page {
          position: relative;
          width: 297mm;
          background: #fff;
          color: #1c1c1c;
          margin: 0 auto;
          padding: 15mm;
          box-shadow: 0 2px 14px rgba(0, 0, 0, 0.12);
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
          box-sizing: border-box;
        }
        .sheet-page-1 {
          height: 210mm;
          overflow: hidden;
        }
        .sheet-page-2 {
          min-height: 210mm;
          margin-top: 1.25rem;
          display: flex;
          flex-direction: column;
        }
        .sheet-brand {
          font-size: 10pt;
          letter-spacing: 0.32em;
          color: #1c1c1c;
          white-space: nowrap;
        }
        .sheet-en {
          letter-spacing: 0.04em;
        }
        @media print {
          .sheet-root {
            background: #fff;
            padding: 0;
          }
          .sheet-toolbar {
            display: none;
          }
          .sheet-page {
            box-shadow: none;
            margin: 0;
          }
          /* 高度略小於 210mm：避免捨入誤差讓內容溢出、多印一張空白頁 */
          .sheet-page-1 {
            height: 209mm;
            page-break-after: always;
          }
          .sheet-page-2 {
            margin-top: 0;
            min-height: 208mm;
          }
        }
        @media screen and (max-width: 1140px) {
          .sheet-page {
            transform-origin: top left;
          }
        }
      `}</style>

      {/* 工具列（僅螢幕） */}
      <div className="sheet-toolbar mx-auto mb-4 flex w-full max-w-[297mm] flex-wrap items-center justify-between gap-3">
        <Link href="/print" className="text-xs text-gray-500 hover:text-gray-800">
          ← 列印頁面
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {sheetVariants.length === 0 && (
            <span className="text-xs text-amber-700">
              此系列尚無勾選「顯示於介紹表」的規格，第二頁將為空
            </span>
          )}
          <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs font-medium">
            <button
              type="button"
              onClick={() => switchLang("zh")}
              className={lang === "zh" ? "bg-gray-800 px-3 py-2 text-white" : "px-3 py-2 text-gray-700 hover:bg-gray-50"}
            >
              中文
            </button>
            <button
              type="button"
              onClick={() => switchLang("en")}
              className={lang === "en" ? "bg-gray-800 px-3 py-2 text-white" : "px-3 py-2 text-gray-700 hover:bg-gray-50"}
            >
              English
            </button>
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

      {/* ── 第一頁：產品照片＋設計理念 ── */}
      <section className="sheet-page sheet-page-1">
        {/* logo 右上，小 */}
        <div className="flex justify-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Føre Furniture" style={{ height: "18mm" }} className="w-auto object-contain" />
        </div>

        <div className="flex" style={{ height: "143mm", marginTop: "6mm" }}>
          {/* 左：產品照片（最多 2 張垂直堆疊） */}
          <div
            className="flex flex-col justify-center"
            style={{ width: "58%", gap: "6mm", paddingTop: photos.length <= 1 ? "0" : undefined }}
          >
            {photos.length === 0 ? null : (
              photos.slice(0, 2).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={series.name || "產品照片"}
                  className="w-auto max-w-full object-contain"
                  style={{ maxHeight: photos.length > 1 ? "71mm" : "140mm", margin: "0 auto" }}
                />
              ))
            )}
          </div>

          {/* 中間留白 */}
          <div style={{ width: "10%" }} />

          {/* 右：產品名稱＋設計理念 */}
          <div className="flex flex-col" style={{ width: "32%", paddingTop: "18mm" }}>
            <h1 style={{ fontSize: "12pt", fontWeight: 600, letterSpacing: "0.06em" }}>
              {displayName}
            </h1>
            {displayConcept.trim() && (
              <div style={{ marginTop: "7mm", display: "flex", flexDirection: "column", gap: "4mm" }}>
                {displayConcept
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p
                      key={i}
                      style={{
                        fontSize: "9pt",
                        lineHeight: 1.95,
                        color: "#2e2e2e",
                        textAlign: "justify",
                      }}
                    >
                      {p}
                    </p>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* 頁尾：左下聯絡資訊、右下類別／交期／製表日期 */}
        <div
          className="flex items-end justify-between"
          style={{ position: "absolute", left: "15mm", right: "15mm", bottom: "12mm" }}
        >
          <p style={{ fontSize: "6.5pt", color: "#8a8a8a", letterSpacing: "0.02em" }}>
            {footerContact(lang)}
          </p>
        </div>
      </section>

      {/* ── 第二頁：規格＋色樣 ── */}
      <section className="sheet-page sheet-page-2">
        <div className="flex items-start justify-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Føre Furniture" style={{ height: "18mm" }} className="w-auto object-contain" />
        </div>

        {/* flex:1 撐滿到頁面下緣（padding 15mm），讓色樣區能貼齊下邊距 */}
        <div className="flex" style={{ marginTop: "6mm", flex: 1 }}>
          {/* 左區：線圖 grid＋客製與保養＋色樣 */}
          <div className="flex flex-col" style={{ width: showPrice ? "70%" : "100%" }}>
            {sheetVariants.length === 0 ? (
              <p style={{ fontSize: "9pt", color: "#9a9a9a", marginTop: "20mm" }}>
                {lang === "en" ? "No items selected for this sheet." : "尚無勾選「顯示於介紹表」的規格。"}
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  // minmax(0, 1fr)：欄寬固定均分，不被格內寬圖撐開（寬圖改用跨欄處理）
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                  columnGap: "8mm",
                  rowGap: "10mm",
                }}
              >
                {sheetCells.map((v) => {
                  const drawingUrl = v.dimension_drawing_url?.trim() || null;
                  const drawingSize = drawingUrl ? parseDrawingSize(drawingUrl) : null;
                  return (
                  <div key={v.id} className="flex flex-col">
                    {/* 線圖區：固定比例（300DPI）時各圖高矮不一、底對齊，列高隨最高者長；無線圖時留白 */}
                    <div
                      className="flex items-end"
                      style={{ minHeight: "33mm", marginBottom: "3mm" }}
                    >
                      {drawingUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={drawingUrl}
                          alt={`${v.displayCode} 尺寸線圖`}
                          className="object-contain"
                          style={
                            drawingSize
                              ? {
                                  // 300DPI 定寬、上限＝格寬；高度不限制（列高隨圖長）。想放大就提高匯出 DPI
                                  width: `${(drawingSize.w * DRAWING_MM_PER_PX).toFixed(2)}mm`,
                                  maxWidth: "100%",
                                }
                              : { maxHeight: "33mm", maxWidth: "100%" }
                          }
                        />
                      )}
                    </div>
                    {/* 線稿展示不出木種：代碼跳過木種代號、不標木種名 */}
                    <p className="sheet-en" style={{ fontSize: "9pt", color: "#1c1c1c" }}>
                      {v.displayCode}
                    </p>
                    <p className="sheet-en" style={{ fontSize: "8pt", color: "#777", marginTop: "1mm" }}>
                      {formatDims(v) || "—"}
                    </p>
                    {(v.seat_height_cm != null || v.arm_height_cm != null) && (
                      <p className="sheet-en" style={{ fontSize: "8pt", color: "#777" }}>
                        {[
                          v.seat_height_cm != null ? `SH${formatCm(v.seat_height_cm)}` : null,
                          // 扶手高度未填寫者不出現
                          v.arm_height_cm != null ? `AH${formatCm(v.arm_height_cm)}` : null,
                        ]
                          .filter(Boolean)
                          .join("　")}
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {/* 客製與保養：固定在色樣區上方 */}
            {displayCustomization.trim() && (swatches.length > 0 || sheetVariants.length > 0) && (
              <p
                style={{
                  fontSize: "6.5pt",
                  lineHeight: 1.8,
                  color: "#8a8a8a",
                  whiteSpace: "pre-wrap",
                  marginTop: "auto",
                  paddingTop: "10mm",
                }}
              >
                {displayCustomization}
              </p>
            )}

            {/* 底部列：色樣（材種 → 門片 → 座墊 → 布樣）貼齊頁面下緣，右側並列類別／交期／尺寸單位 */}
            {(swatches.length > 0 || (!showPrice && sheetVariants.length > 0)) && (
              <div
                className="flex items-end"
                style={{
                  gap: "8mm",
                  marginTop: displayCustomization.trim() ? "5mm" : "auto",
                  paddingTop: displayCustomization.trim() ? undefined : "10mm",
                }}
              >
                <div className="flex flex-wrap items-start" style={{ gap: "8mm", flex: 1 }}>
                  {[woodSwatches, doorSwatches, fabricSwatches, clothSwatches]
                    .filter((group) => group.length > 0)
                    .map((group, gi) => (
                      <div key={gi} className="flex flex-wrap" style={{ gap: "4mm" }}>
                        {group.map((s) => (
                          <div key={s.id} className="flex flex-col" style={{ width: "32mm" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.image_url}
                              alt={s.name}
                              style={{ width: "32mm", height: "32mm", objectFit: "cover" }}
                            />
                            {lang === "en" ? (
                              <p className="sheet-en" style={{ fontSize: "7pt", color: "#444", marginTop: "1.5mm", lineHeight: 1.4 }}>
                                {s.name_en?.trim() || s.name.replace(/^\[DEMO\]\s*/, "")}
                              </p>
                            ) : (
                              <>
                                <p style={{ fontSize: "7pt", color: "#444", marginTop: "1.5mm", lineHeight: 1.4 }}>
                                  {s.name.replace(/^\[DEMO\]\s*/, "")}
                                </p>
                                {s.name_en?.trim() && (
                                  <p className="sheet-en" style={{ fontSize: "6.5pt", color: "#999", lineHeight: 1.4 }}>
                                    {s.name_en}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
                {!showPrice && sheetVariants.length > 0 && (
                  <p
                    className="sheet-en"
                    style={{ fontSize: "6.5pt", color: "#999", whiteSpace: "nowrap" }}
                  >
                    {specFootnote}
                  </p>
                )}
              </div>
            )}
          </div>

          {showPrice && (
            <>
              {/* 中間留白 */}
              <div style={{ width: "5%" }} />

              {/* 右區：報價表欄 */}
              <div className="flex flex-col" style={{ width: "25%" }}>
                <div>
                  {sheetVariants.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-baseline justify-between"
                      style={{
                        borderBottom: "0.25pt solid #d8d8d8",
                        padding: "2.2mm 0",
                      }}
                    >
                      <span className="sheet-en" style={{ fontSize: "7.5pt", color: "#1c1c1c" }}>
                        {v.product_code}
                      </span>
                      <span className="sheet-en" style={{ fontSize: "7.5pt", color: "#1c1c1c" }}>
                        {v.base_price != null ? `NT$ ${v.base_price.toLocaleString()}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="sheet-en" style={{ fontSize: "6.5pt", color: "#999", marginTop: "5mm" }}>
                  {specFootnote}
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
