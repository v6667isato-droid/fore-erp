"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

/** 單一訂單明細列 */
type ChairRow = {
  id: string;
  /** 產品系列名稱（product_series.series_name） */
  seriesName: string;
  /** 第一欄合併區塊：CH03 或 CH03A */
  chairFamily: "CH03" | "CH03A";
  /** 客戶名稱 */
  customerName: string;
  /** 訂單收貨聯絡人（僅通路訂單顯示於客戶下方、淺灰） */
  contactName: string;
  /** 客戶屬於通路（customers.channel_id 有值） */
  isChannelOrder: boolean;
  /** 明細備註（與規格主文不同時另起一行） */
  itemNotesLine: string;
  eta: string;
  walnut: [string, string, string];
  oak: [string, string, string];
};

/** 未出貨：與生產工單相同，排除尚未確認與已結／已出貨 */
const EXCLUDED_ORDER_STATUSES = new Set(["已出貨", "結案", "報價中"]);

/** 工單工序已達「成品」或之後者，不列入椅子生產表 */
const EXCLUDED_WORK_STAGES_FOR_CHAIR_PRINT = new Set(["成品", "已出貨"]);

function workStageFromOrderItem(raw: { work_orders?: unknown }): string | null {
  const wo = raw.work_orders as { stage?: string } | { stage?: string }[] | null | undefined;
  if (!wo) return null;
  const row = Array.isArray(wo) ? wo[0] : wo;
  const s = row?.stage;
  if (s == null || String(s).trim() === "") return null;
  return String(s).trim();
}

/** CH03 vs CH03A（含 CH03A／CH03-A 無連字號與子規格） */
function chairModelFromCode(productCode: string | null | undefined): boolean {
  const c = (productCode ?? "").trim();
  if (!c) return false;
  if (
    c === "CH03A" ||
    c.startsWith("CH03A-") ||
    c === "CH03-A" ||
    c.startsWith("CH03-A-")
  ) {
    return true;
  }
  if (c === "CH03" || (c.startsWith("CH03-") && !c.startsWith("CH03-A") && !c.startsWith("CH03A"))) {
    return true;
  }
  return false;
}

/** CH03A 家族（含 CH03-A）與其餘 CH03 家族，供第一欄合併 */
function chairFamilyFromCode(productCode: string | null | undefined): "CH03" | "CH03A" {
  const c = (productCode ?? "").trim();
  if (
    c === "CH03A" ||
    c.startsWith("CH03A-") ||
    c === "CH03-A" ||
    c.startsWith("CH03-A-")
  ) {
    return "CH03A";
  }
  return "CH03";
}

/** 第一欄依 chairFamily 垂直合併：僅首列顯示儲存格 */
function seriesFirstColumnMergeInfo(
  rows: ChairRow[]
): { rowSpan: number; showSeriesCol: boolean }[] {
  const infos: { rowSpan: number; showSeriesCol: boolean }[] = new Array(rows.length);
  let i = 0;
  while (i < rows.length) {
    const fam = rows[i].chairFamily;
    let j = i + 1;
    while (j < rows.length && rows[j].chairFamily === fam) j++;
    const span = j - i;
    infos[i] = { rowSpan: span, showSeriesCol: true };
    for (let k = i + 1; k < j; k++) infos[k] = { rowSpan: span, showSeriesCol: false };
    i = j;
  }
  return infos;
}

function formatEtaMd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function customerNameFromOrder(order: { customers?: unknown }): string {
  const rel = order?.customers as { name?: string } | { name?: string }[] | null | undefined;
  if (rel && typeof rel === "object" && !Array.isArray(rel)) {
    return String((rel as { name?: string }).name ?? "").trim();
  }
  if (Array.isArray(rel) && rel[0]?.name) return String(rel[0].name).trim();
  return "";
}

/** 通路訂單：客戶有綁定 channel_id */
function isChannelOrderFromCustomers(order: { customers?: unknown }): boolean {
  const rel = order?.customers as
    | { channel_id?: string | null }
    | { channel_id?: string | null }[]
    | null
    | undefined;
  if (!rel) return false;
  const row = Array.isArray(rel) ? rel[0] : rel;
  const id = row?.channel_id;
  return id != null && String(id).trim() !== "";
}

/** 去掉規格中的 -P、-R、-W、-F 等英文後綴（含 * 前） */
function stripSpecSuffixCodes(text: string): string {
  let s = text.trim();
  if (!s) return "";
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/(?:[-－](?:P|R|W|F))+$/gi, "").trim();
  }
  s = s.replace(/(?:[-－](?:P|R|W|F))+(?=\s*\*)/gi, "");
  return s.trim();
}

/** 去掉「木(姓名)」等前綴，名字後方不顯示木種標記 */
function sanitizeCustomerDisplayName(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const paren = s.match(/^木\(([^)]+)\)|^木（([^）]+)）/);
  if (paren) return (paren[1] || paren[2] || "").trim();
  return s;
}

/** 編織／實木／布墊 — 對應 [編織, 實木, 布墊] */
type Triple = [string, string, string];

const emptyTriple = (): Triple => ["", "", ""];

/** 若字串已含 *數量 則不重複附加（例：藍*4、紙編*2） */
function formatSpecTimesQty(label: string, qty: number): string {
  const t = label.trim();
  if (!t) return qty >= 1 ? `×${qty}` : "";
  if (/\*\s*\d+/.test(t)) return t;
  return `${t}*${qty}`;
}

/** 紙繩、藤編等 → 編織(0)；布墊類 → 布墊(2)；其餘 → 實木(1) */
function specColumnIndex(text: string): 0 | 1 | 2 {
  const t = text;
  if (/布墊|座墊|布藝|棉布|亞麻|藍\s*\*|^藍[\d*]|藍色/.test(t)) return 2;
  if (
    /紙繩|藤編|紙編|煙燻|[Rr]attan|藤(?!椅)|繩\s*\*|繩\*|紙\s*\*/.test(t)
  ) {
    return 0;
  }
  return 1;
}

/** 顯示在規格欄的主文：優先 spec1，其次非泛用木種字、再備註 */
function pickSpecBaseLabel(
  spec1: string | null | undefined,
  woodType: string | null | undefined,
  customNotes: string | null | undefined
): string {
  const s = stripSpecSuffixCodes((spec1 ?? "").trim());
  if (s) return s;
  const w = stripSpecSuffixCodes((woodType ?? "").trim());
  if (w && !/^(胡桃木|白橡木|胡桃|白橡)$/.test(w)) return w;
  return stripSpecSuffixCodes((customNotes ?? "").trim());
}

/**
 * 依關鍵字分欄（編織／實木／布墊），胡桃／白橡擇一區塊；格式為 規格*數量。
 * 分欄僅依 spec／備註，不把「胡桃木／白橡木」等木種字串拿來判斷欄位。
 */
function woodSpecColumns(
  woodType: string | null | undefined,
  spec1: string | null | undefined,
  customNotes: string | null | undefined,
  quantity: number
): { walnut: Triple; oak: Triple } {
  const w = (woodType ?? "").trim();
  const spec = stripSpecSuffixCodes((spec1 ?? "").trim());
  const notes = stripSpecSuffixCodes((customNotes ?? "").trim());
  const classifyText = [spec, notes].filter(Boolean).join(" ");
  const qty = Math.max(1, quantity);

  const walnut = emptyTriple();
  const oak = emptyTriple();

  const baseLabel = pickSpecBaseLabel(spec1, woodType, customNotes);
  if (!classifyText && !baseLabel) {
    const cell = formatSpecTimesQty("", qty);
    if (w.includes("白橡")) oak[1] = cell;
    else walnut[1] = cell;
    return { walnut, oak };
  }

  const col = specColumnIndex(classifyText || baseLabel);
  const cell = formatSpecTimesQty(baseLabel, qty);

  if (w.includes("胡桃")) {
    walnut[col] = cell;
  } else if (w.includes("白橡")) {
    oak[col] = cell;
  } else {
    walnut[col] = cell;
  }

  return { walnut, oak };
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function seriesNameFromVariant(variant: unknown): string {
  const v = variant as {
    product_series?: { series_name?: string } | { series_name?: string }[] | null;
  };
  const rel = v?.product_series;
  if (!rel) return "";
  if (Array.isArray(rel)) return String(rel[0]?.series_name ?? "").trim();
  return String(rel.series_name ?? "").trim();
}

export default function ChairProductionPrintPage() {
  const [sheetDate, setSheetDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flatRows, setFlatRows] = useState<ChairRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from("order_items").select(
        `
          id,
          quantity,
          wood_type,
          custom_notes,
          variant_id,
          orders!inner (
            id,
            status,
            shipping_contact_name,
            expected_delivery_date,
            customers (name, alias, channel_id)
          ),
          product_variants!inner (
            product_code,
            wood_type,
            spec1,
            product_series (
              series_name
            )
          ),
          work_orders (
            stage
          )
        `
      );

      if (error) throw new Error(error.message || "讀取訂單明細失敗");

      const list = (data ?? []) as any[];
      const out: ChairRow[] = [];

      for (const raw of list) {
        const status = raw.orders?.status as string | null | undefined;
        if (!status || EXCLUDED_ORDER_STATUSES.has(status)) continue;

        const code = raw.product_variants?.product_code as string | undefined;
        if (!chairModelFromCode(code)) continue;

        const workStage = workStageFromOrderItem(raw);
        if (
          workStage != null &&
          EXCLUDED_WORK_STAGES_FOR_CHAIR_PRINT.has(workStage)
        ) {
          continue;
        }

        const qty = Math.max(1, Number(raw.quantity ?? 1));
        const itemWood = raw.wood_type as string | null | undefined;
        const varWood = raw.product_variants?.wood_type as string | null | undefined;
        const spec1 = raw.product_variants?.spec1 as string | null | undefined;
        const woodMerged = (itemWood && String(itemWood).trim()) || (varWood && String(varWood).trim()) || "";

        const customer = customerNameFromOrder(raw.orders);
        const contactName = String(raw.orders?.shipping_contact_name ?? "").trim();
        const notes = raw.custom_notes as string | null | undefined;
        const notesTrim = notes && String(notes).trim() ? String(notes).trim() : "";
        const notesStripped = stripSpecSuffixCodes(notesTrim);
        const spec1Stripped = stripSpecSuffixCodes(String(spec1 ?? "").trim());

        const { walnut, oak } = woodSpecColumns(
          woodMerged || varWood,
          spec1Stripped,
          notesStripped,
          qty
        );

        const baseLabel = pickSpecBaseLabel(spec1, woodMerged || varWood, notes);
        const displayName = sanitizeCustomerDisplayName(customer);
        const itemNotesLine =
          notesStripped && notesStripped !== baseLabel ? notesStripped : "";
        const isChannelOrder = isChannelOrderFromCustomers(raw.orders);

        const seriesName =
          seriesNameFromVariant(raw.product_variants) ||
          (code ? String(code) : "");
        const chairFamily = chairFamilyFromCode(code);

        out.push({
          id: String(raw.id),
          seriesName,
          chairFamily,
          customerName: displayName,
          contactName,
          isChannelOrder,
          itemNotesLine,
          eta: formatEtaMd(raw.orders?.expected_delivery_date ?? null),
          walnut,
          oak,
        });
      }

      out.sort((a, b) => {
        const fam = a.chairFamily.localeCompare(b.chairFamily);
        if (fam !== 0) return fam;
        const s = a.seriesName.localeCompare(b.seriesName, "zh-Hant");
        if (s !== 0) return s;
        const ea = a.eta || "";
        const eb = b.eta || "";
        if (ea !== eb) return ea.localeCompare(eb, undefined, { numeric: true });
        return a.customerName.localeCompare(b.customerName, "zh-Hant");
      });

      setFlatRows(out);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "載入失敗");
      setFlatRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSheetDate(todayYmd());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = `椅子生產管理表_${sheetDate || todayYmd()}`;
  }, [sheetDate]);

  const seriesMerge = useMemo(() => seriesFirstColumnMergeInfo(flatRows), [flatRows]);

  return (
    <>
      <style>{`
        @page {
          size: A4 portrait;
          margin: 8mm 10mm;
        }
        .chair-customer-cell {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .chair-print-table tbody tr.chair-data-row {
          min-height: 60px;
          height: 60px;
        }
        .chair-print-table tbody tr.chair-data-row > td.chair-body-td {
          box-sizing: border-box;
          height: 60px;
          max-height: 60px;
          overflow: hidden;
          vertical-align: middle;
        }
        .chair-print-table tbody tr.chair-data-row > td.chair-body-td.chair-series-merge-cell {
          height: auto;
          max-height: none;
          overflow: visible;
          vertical-align: middle;
        }
        .chair-print-table tbody tr.chair-data-row > td.chair-body-td.chair-series-merge-cell.chair-series-merge-span {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
        .chair-print-table tbody td.chair-customer-cell.chair-body-td {
          vertical-align: top;
        }
        @media screen {
          .chair-print-preview {
            transform: scale(1.06);
            transform-origin: top center;
            margin-bottom: 2rem;
          }
        }
        @media print {
          .chair-print-toolbar {
            display: none !important;
          }
          .chair-print-preview {
            transform: none !important;
            margin-bottom: 0 !important;
          }
          .chair-print-root {
            background: #fff !important;
            color: #000 !important;
            padding: 0 !important;
            min-height: auto !important;
          }
          .chair-print-table {
            font-size: 13.5px !important;
            line-height: 1.4 !important;
          }
          .chair-spec-cell {
            font-size: 13.5px !important;
            line-height: 1.4 !important;
          }
          .chair-print-table tbody tr.chair-data-row {
            min-height: 16.5mm !important;
            height: 16.5mm !important;
          }
          .chair-print-table tbody tr.chair-data-row > td.chair-body-td {
            height: 16.5mm !important;
            max-height: 16.5mm !important;
            overflow: hidden !important;
          }
          .chair-print-table tbody tr.chair-data-row > td.chair-body-td.chair-series-merge-cell {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .chair-print-table tbody tr.chair-data-row > td.chair-body-td.chair-series-merge-cell.chair-series-merge-span {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
        }
      `}</style>

      <div className="chair-print-root min-h-screen bg-zinc-100 text-zinc-900 print:bg-white print:p-0">
        <div className="chair-print-toolbar sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-zinc-700">椅子生產管理表（CH03／CH03A・未出貨・A4 直式）</span>
            <label className="flex items-center gap-2 text-zinc-600">
              製表日期
              <input
                type="text"
                value={sheetDate}
                onChange={(e) => setSheetDate(e.target.value)}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 w-36"
                placeholder="YYYY/MM/DD"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              重新載入
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
            >
              列印
            </button>
            <Link
              href="/print"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              列印首頁
            </Link>
            <Link href="/" className="text-sm font-medium text-primary hover:underline">
              返回 ERP
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[210mm] px-3 py-5 print:max-w-none print:px-0 print:py-0">
          <div className="mb-2 flex items-baseline gap-2 text-sm print:mb-1">
            <span className="font-medium">製表日期：</span>
            <span className="min-w-[8em] border-b border-zinc-800 print:border-black">
              {sheetDate || "　　　　"}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-zinc-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              讀取未出貨 CH03／CH03A 品項…
            </div>
          ) : loadError ? (
            <p className="py-8 text-sm text-red-600">{loadError}</p>
          ) : (
            <>
              <div className="chair-print-preview overflow-x-auto print:overflow-visible">
                <table className="chair-print-table w-full min-w-[190mm] table-fixed border-collapse border border-black text-[15px] leading-snug print:leading-snug">
                  <colgroup>
                    <col style={{ width: "4%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "4%" }} />
                    <col style={{ width: "4%" }} />
                    <col style={{ width: "4%" }} />
                    <col style={{ width: "4%" }} />
                    <col style={{ width: "5.8%" }} />
                    <col style={{ width: "5.8%" }} />
                    <col style={{ width: "5.8%" }} />
                    <col style={{ width: "5.8%" }} />
                    <col style={{ width: "5.8%" }} />
                    <col style={{ width: "5.8%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={2}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold print:bg-emerald-100"
                      >
                        木材／坐墊
                      </th>
                      <th
                        rowSpan={2}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold w-[6%] print:bg-emerald-100"
                      >
                        預計交期
                      </th>
                      <th
                        colSpan={2}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold print:bg-emerald-100"
                      >
                        組立
                      </th>
                      <th
                        rowSpan={2}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold w-[5%] print:bg-emerald-100"
                      >
                        噴漆階段
                      </th>
                      <th
                        rowSpan={2}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold w-[5%] print:bg-emerald-100"
                      >
                        完成日期
                      </th>
                      <th
                        colSpan={3}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold print:bg-emerald-100"
                      >
                        胡桃
                      </th>
                      <th
                        colSpan={3}
                        className="border border-black bg-emerald-100 px-0.5 py-0.5 font-semibold print:bg-emerald-100"
                      >
                        白橡
                      </th>
                    </tr>
                    <tr>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        系列
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0 whitespace-normal break-words text-left">
                        客戶／聯絡人
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium w-[4%] print:bg-emerald-100">
                        側邊
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium w-[4%] print:bg-emerald-100">
                        整張
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        編織
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        實木
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        布墊
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        編織
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        實木
                      </th>
                      <th className="border border-black bg-emerald-100 px-0.5 py-0.5 font-medium print:bg-emerald-100 min-w-0">
                        布墊
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="border border-black bg-white px-2 py-6 text-center text-[16.5px] text-zinc-600"
                        >
                          目前沒有符合條件的品項（未出貨訂單、規格品 CH03／CH03A 系列）。
                        </td>
                      </tr>
                    ) : (
                      flatRows.map((row, idx) => {
                        const merge = seriesMerge[idx];
                        const span = merge?.rowSpan ?? 1;
                        const showCol = merge?.showSeriesCol ?? true;
                        return (
                        <tr key={row.id} className="chair-data-row">
                          {showCol ? (
                            <td
                              rowSpan={span}
                              className={`chair-body-td chair-series-merge-cell border border-black bg-amber-50 px-0.5 py-0.5 text-center font-semibold print:bg-amber-50 break-words min-w-0 max-w-[14mm] ${
                                span > 1 ? "chair-series-merge-span" : ""
                              }`}
                            >
                              {row.chairFamily}
                            </td>
                          ) : null}
                          <td className="chair-customer-cell chair-body-td border border-black bg-amber-50 px-0.5 py-0.5 print:bg-amber-50 min-w-0 text-left whitespace-normal break-words [overflow-wrap:anywhere]">
                            <div className="flex max-w-full flex-col gap-0.5 leading-snug">
                              <span className="font-medium text-zinc-900 print:text-black break-words">
                                {row.customerName || "—"}
                              </span>
                              {row.isChannelOrder && row.contactName ? (
                                <span className="text-[0.92em] font-normal text-zinc-400 print:text-zinc-600 break-words">
                                  {row.contactName}
                                </span>
                              ) : null}
                              {row.itemNotesLine ? (
                                <span className="text-[0.95em] text-zinc-800 print:text-black break-words">
                                  {row.itemNotesLine}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="chair-body-td border border-black bg-amber-50 text-center px-0.5 py-0.5 print:bg-amber-50">
                            {row.eta}
                          </td>
                          <CheckCell />
                          <CheckCell />
                          <CheckCell />
                          <CheckCell />
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.walnut[0]}
                          </td>
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.walnut[1]}
                          </td>
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.walnut[2]}
                          </td>
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.oak[0]}
                          </td>
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.oak[1]}
                          </td>
                          <td className="chair-body-td chair-spec-cell border border-black bg-white px-0.5 py-0.5 text-center min-w-0 break-words">
                            {row.oak[2]}
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[15px] text-zinc-500 print:mt-2 print:text-[12px] print:text-zinc-600">
                資料來源：訂單狀態非「已出貨／結案／報價中」，產品代碼為 CH03／CH03A／CH03-A
                系列；工單工序為「成品」或「已出貨」者不列入。第一欄依 CH03／CH03A 合併；通路訂單時第二欄下為收貨聯絡人（淺色）；規格略去 -P/-R/-W/-F 等後綴。右側依訂單木種分胡桃／白橡區。組立與噴漆請現場勾選。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CheckCell() {
  return (
    <td className="chair-body-td border border-black bg-amber-50 w-[3%] min-w-[3mm] p-0 print:bg-amber-50 align-middle">
      <span className="sr-only">勾選</span>
    </td>
  );
}
