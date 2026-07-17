/**
 * 配件表資料庫設定：產品資料頁「配件表」分頁使用
 * 以 category 分類（門框、坐墊、坐墊布料…），僅內部使用、不對官網公開
 */

/** Supabase 表名 */
export const TABLE_PRODUCT_ACCESSORIES = "product_accessories";

/** product_accessories 查詢欄位 */
export const PRODUCT_ACCESSORY_SELECT =
  "id, category, name, spec, material, price, image_url, notes, sort_order, created_at";

export interface ProductAccessoryRow {
  id: string;
  category: string;
  name: string;
  spec: string | null;
  material: string | null;
  price: number | null;
  image_url: string | null;
  notes: string | null;
  sort_order: number | null;
  created_at: string | null;
}

export function mapProductAccessory(r: Record<string, unknown>): ProductAccessoryRow {
  return {
    id: String(r.id),
    category: String(r.category ?? ""),
    name: String(r.name ?? ""),
    spec: r.spec != null ? String(r.spec) : null,
    material: r.material != null ? String(r.material) : null,
    price: r.price != null ? Number(r.price) : null,
    image_url: r.image_url != null ? String(r.image_url) : null,
    notes: r.notes != null ? String(r.notes) : null,
    sort_order: r.sort_order != null ? Number(r.sort_order) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
  };
}

/** 分類大項建議選項（可自由輸入其他分類） */
export const PRODUCT_ACCESSORY_CATEGORY_OPTIONS = ["門框", "坐墊", "坐墊布料", "其他"];
