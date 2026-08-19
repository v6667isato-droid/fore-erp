/**
 * 訂製案例／加工區資料庫設定：統一使用 custom_cases 表名與欄位
 * kind = 'custom' 訂製案例（published = true 時供官網顯示）
 * kind = 'processing' 加工區（維修保養項目，僅內部使用，官網 RLS 擋下 anon 讀取）
 */

import { PRODUCT_CATEGORY_OPTIONS } from "@/lib/products-db";

/** Supabase 表名：訂製案例與加工區共用 */
export const TABLE_CUSTOM_CASES = "custom_cases";

/** custom_cases 查詢欄位 */
export const CUSTOM_CASE_SELECT =
  "id, kind, case_code, name_zh, name_en, category, material, dimension_w, dimension_d, dimension_h, dimensions_note, completed_year, story_zh, story_en, image_url, object_position, process_image_urls, published, sort_order, order_id, notes, base_price, created_at";

export type CustomCaseKind = "custom" | "processing";

export interface CustomCaseRow {
  id: string;
  kind: CustomCaseKind;
  case_code: string | null;
  name_zh: string;
  name_en: string | null;
  category: string | null;
  material: string | null;
  dimension_w: number | null;
  dimension_d: number | null;
  dimension_h: number | null;
  dimensions_note: string | null;
  completed_year: string | null;
  story_zh: string | null;
  story_en: string | null;
  image_url: string | null;
  object_position: string | null;
  process_image_urls: string[];
  published: boolean;
  sort_order: number | null;
  order_id: string | null;
  notes: string | null;
  /** 定價（加工區服務項目用；不對官網公開） */
  base_price: number | null;
  created_at: string | null;
}

export function mapCustomCase(r: Record<string, unknown>): CustomCaseRow {
  return {
    id: String(r.id),
    kind: r.kind === "processing" ? "processing" : "custom",
    case_code: r.case_code != null ? String(r.case_code) : null,
    name_zh: String(r.name_zh ?? ""),
    name_en: r.name_en != null ? String(r.name_en) : null,
    category: r.category != null ? String(r.category) : null,
    material: r.material != null ? String(r.material) : null,
    dimension_w: r.dimension_w != null ? Number(r.dimension_w) : null,
    dimension_d: r.dimension_d != null ? Number(r.dimension_d) : null,
    dimension_h: r.dimension_h != null ? Number(r.dimension_h) : null,
    dimensions_note: r.dimensions_note != null ? String(r.dimensions_note) : null,
    completed_year: r.completed_year != null ? String(r.completed_year) : null,
    story_zh: r.story_zh != null ? String(r.story_zh) : null,
    story_en: r.story_en != null ? String(r.story_en) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
    object_position: r.object_position != null ? String(r.object_position) : null,
    process_image_urls: Array.isArray(r.process_image_urls)
      ? (r.process_image_urls as unknown[]).map((u) => String(u)).filter(Boolean)
      : [],
    published: r.published === true,
    sort_order: r.sort_order != null ? Number(r.sort_order) : null,
    order_id: r.order_id != null ? String(r.order_id) : null,
    notes: r.notes != null ? String(r.notes) : null,
    base_price: r.base_price != null ? Number(r.base_price) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
  };
}

/** 尺寸顯示：優先尺寸補充說明，否則組 W x D x H */
export function formatCaseDimensions(row: CustomCaseRow): string {
  if (row.dimensions_note?.trim()) return row.dimensions_note.trim();
  const parts = [row.dimension_w, row.dimension_d, row.dimension_h];
  if (parts.every((p) => p == null)) return "—";
  const fmt = (v: number | null) => (v != null ? String(v) : "—");
  return `W:${fmt(row.dimension_w)} x D:${fmt(row.dimension_d)} x H:${fmt(row.dimension_h)}`;
}

/** 各分頁的類別建議選項：訂製案例直接沿用產品區類別；加工區固定四大類（表單以下拉單選） */
export const CUSTOM_CASE_CATEGORY_OPTIONS: Record<CustomCaseKind, string[]> = {
  custom: PRODUCT_CATEGORY_OPTIONS,
  processing: ["加工", "保養", "維修", "CNC"],
};

export const CUSTOM_CASE_KIND_LABEL: Record<CustomCaseKind, string> = {
  custom: "訂製案例",
  processing: "加工區",
};
