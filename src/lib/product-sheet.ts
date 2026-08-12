/**
 * 產品介紹表／價目表共用：中英版本文案與產品代碼顯示規則。
 * 英文版（?lang=en）配合官網雙語內容；系列層級英文欄位留空時 fallback 中文。
 */

export type SheetLang = "zh" | "en";

/** 從列印頁 URL 讀取語言（?lang=en）；預設中文 */
export function parseSheetLang(get: (key: string) => string | null): SheetLang {
  return get("lang") === "en" ? "en" : "zh";
}

/** 木種中→英（價目表英文版用；查無對應時原樣顯示） */
const WOOD_NAME_EN: Record<string, string> = {
  白橡木: "Oak",
  煙燻白橡木: "Smoked oak",
  胡桃木: "Walnut",
  柚木: "Teak",
  雞翅木: "Wenge",
};

export function woodTypeLabel(name: string, lang: SheetLang): string {
  if (lang === "zh") return name;
  return WOOD_NAME_EN[name.trim()] ?? name;
}

/** 產品類別中→英（頁尾／組標題小字用） */
const CATEGORY_EN: Record<string, string> = {
  桌: "Table",
  椅: "Chair",
  凳: "Stool",
  櫃: "Cabinet",
  層架: "Shelf",
  小木器: "Objects",
  其他: "Others",
};

export function categoryLabel(name: string, lang: SheetLang): string {
  if (lang === "zh") return name;
  return CATEGORY_EN[name.trim()] ?? name;
}

/** 頁尾聯絡資訊（兩張表共用；無「電話」「上班日」字樣） */
export function footerContact(lang: SheetLang): string {
  return lang === "en"
    ? "06-2302861　|　No. 125, Dingcuo St., Guiren Dist., Tainan, Taiwan　|　9:00–18:00　|　fore-furniture.com"
    : "06-2302861　|　台南市歸仁區丁厝街125號　|　9:00–18:00　|　fore-furniture.com";
}

/**
 * 木種代號（option_values wood 軸的 code）預設清單；
 * 頁面會另從資料庫讀最新清單合併，讀不到時以此為準。
 */
export const DEFAULT_WOOD_CODES = ["O", "SO", "W", "T", "Wenge"];

/**
 * 介紹表線圖格的顯示代碼：跳過木種代號段（線稿展示不出木種）。
 * 規則：以 - 分段，移除第一個完全等於木種代號的段（首段為系列碼不移除）。
 * 例：CB01-O → CB01、CB05-W-180 → CB05-180、CH03-O-P → CH03-P。
 */
export function stripWoodCode(productCode: string, woodCodes: string[] = DEFAULT_WOOD_CODES): string {
  const tokens = productCode.split("-");
  const idx = tokens.findIndex((t, i) => i > 0 && woodCodes.includes(t));
  if (idx < 0) return productCode;
  tokens.splice(idx, 1);
  return tokens.join("-");
}
