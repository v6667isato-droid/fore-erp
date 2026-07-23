import jsQR from "jsqr";
import { parseEInvoiceQr, type EInvoiceQrData } from "@/lib/e-invoice-qr";

export type QrDecodeResult =
  /** 成功解出左 QR 並通過結構驗證 */
  | { status: "decoded"; data: EInvoiceQrData }
  /** 圖片可讀但掃不到可解析的左 QR（照片模糊、非電子發票證明聯等） */
  | { status: "not_found" }
  /** PDF 等不支援的格式，維持 OCR 流程 */
  | { status: "unsupported" }
  /** 圖片下載或解碼過程出錯 */
  | { status: "error"; message: string };

/** 掃描區域（相對整張圖的比例；QR 位於證明聯左下方，優先掃下半與左半） */
const SCAN_REGIONS: { x: number; y: number; w: number; h: number }[] = [
  { x: 0, y: 0, w: 1, h: 1 },
  { x: 0, y: 0.35, w: 0.65, h: 0.65 }, // 左下（左 QR 最常見位置）
  { x: 0, y: 0, w: 0.65, h: 1 }, // 左半
  { x: 0, y: 0.35, w: 1, h: 0.65 }, // 下半
  { x: 0.35, y: 0.35, w: 0.65, h: 0.65 }, // 右下（照片顛倒或裁切偏移時）
];

/** 依長邊上限縮放；QR 太小掃不到、太大又慢，兩檔嘗試 */
const SCAN_MAX_SIDES = [1600, 2400];

function drawRegion(
  bitmap: ImageBitmap,
  region: { x: number; y: number; w: number; h: number },
  maxSide: number,
): ImageData | null {
  const sx = Math.floor(bitmap.width * region.x);
  const sy = Math.floor(bitmap.height * region.y);
  const sw = Math.floor(bitmap.width * region.w);
  const sh = Math.floor(bitmap.height * region.h);
  if (sw < 20 || sh < 20) return null;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh);
}

/**
 * 從發票照片 URL 解碼左側 QR：抓 blob → 多區域、多解析度掃描 → 結構驗證。
 * 只在瀏覽器執行（用到 canvas / createImageBitmap）。
 */
export async function decodeEInvoiceQrFromUrl(
  url: string,
  mediaType?: string | null,
): Promise<QrDecodeResult> {
  if ((mediaType ?? "").includes("pdf") || url.split("?")[0].toLowerCase().endsWith(".pdf")) {
    return { status: "unsupported" };
  }
  let bitmap: ImageBitmap;
  try {
    const res = await fetch(url);
    if (!res.ok) return { status: "error", message: `照片下載失敗（${res.status}）` };
    const blob = await res.blob();
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    console.error("QR 解碼：載入照片失敗", err);
    return { status: "error", message: "照片載入失敗，無法解碼 QR" };
  }

  try {
    for (const maxSide of SCAN_MAX_SIDES) {
      for (const region of SCAN_REGIONS) {
        const imageData = drawRegion(bitmap, region, maxSide);
        if (!imageData) continue;
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (!code?.data) continue;
        const parsed = parseEInvoiceQr(code.data);
        if (parsed) return { status: "decoded", data: parsed };
        // 掃到的是右 QR 或無法解析的內容：換下一個區域繼續找左 QR
      }
    }
    return { status: "not_found" };
  } finally {
    bitmap.close();
  }
}
