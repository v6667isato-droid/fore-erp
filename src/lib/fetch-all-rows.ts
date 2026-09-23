import { supabase } from "@/lib/supabase";

/** Supabase 預設單次最多回 1000 筆；分頁抓齊全部資料 */
export async function fetchAllRows<T>(
  table: "orders" | "order_items" | "product_variants" | "product_series" | "customers",
  columns: string,
): Promise<{ rows: T[]; error: string | null }> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) return { rows: [], error: error.message };
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { rows, error: null };
}
