"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { WOOD_TYPE_OPTIONS } from "@/lib/products-db";

/**
 * 木種建議清單：撈選項軸（option_types.code='wood'）的 option_values 名稱，
 * 依 sort_order 排序；讀取失敗或尚無資料時退回內建 WOOD_TYPE_OPTIONS。
 * 在選項設定新增木種後，各處木種 datalist 會自動出現新值。
 */
export function useWoodTypeOptions(enabled: boolean): string[] {
  const [names, setNames] = useState<string[]>([...WOOD_TYPE_OPTIONS]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("option_values")
        .select("name_zh, sort_order, option_types!inner(code)")
        .eq("option_types.code", "wood")
        .order("sort_order");
      if (cancelled || error || !data || data.length === 0) return;
      const fromDb = data.map((r) => r.name_zh);
      setNames([...fromDb, ...WOOD_TYPE_OPTIONS.filter((n) => !fromDb.includes(n))]);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return names;
}
