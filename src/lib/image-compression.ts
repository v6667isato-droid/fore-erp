/**
 * 圖片上傳壓縮參數（browser-image-compression）。
 *
 * 產品介紹表／官網走的是瀏覽器原生列印與原圖輸出，成品畫質完全取決於「上傳當下壓縮後」的
 * 解析度，之後無法補救，因此依用途分兩檔：
 * - standard：只會在畫面上看的縮圖／附件，維持小檔案以利載入。
 * - print：會印在 A4 橫式介紹表或放上官網的產品照。介紹表第一頁主圖寬約 172mm(6.8in)、
 *   高約 140mm(5.5in)，要達 300dpi 需約 2040×1650px，故長邊上限取 2048px 並提高品質，
 *   讓 maxSizeMB 幾乎不會觸發二次降質。
 */

export type ImageQualityPreset = "standard" | "print";

export const STANDARD_IMAGE_COMPRESSION = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
} as const;

export const PRINT_IMAGE_COMPRESSION = {
  maxSizeMB: 3,
  maxWidthOrHeight: 2048,
  initialQuality: 0.92,
  useWebWorker: true,
} as const;

export function compressionOptionsFor(preset: ImageQualityPreset) {
  return preset === "print" ? PRINT_IMAGE_COMPRESSION : STANDARD_IMAGE_COMPRESSION;
}

/** 上傳區塊的說明文字，讓使用者知道該準備多大的原圖 */
export function compressionHintFor(preset: ImageQualityPreset): string {
  return preset === "print"
    ? "建議上傳原始高解析度照片，將自動壓縮至長邊 2048px 以內"
    : "建議 1920px 內，將自動壓縮至 500KB 以內";
}
