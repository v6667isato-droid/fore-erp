import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";
import { ORDER_EXPLANATION_BUCKET } from "@/lib/explanation-images";

/** 訂單說明／尺寸圖需保留線條與文字可讀性，比品項縮圖寬鬆 */
const ORDER_EXPLANATION_COMPRESSION_OPTIONS = {
  maxSizeMB: 3,
  maxWidthOrHeight: 2880,
  initialQuality: 0.95,
  useWebWorker: true,
} as const;

/**
 * 壓縮後上傳到訂單說明圖 bucket，回傳公開網址。
 * ERP 訂單「訂單說明圖」與通路下單「製作圖」共用同一套流程。
 */
export async function uploadExplanationImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("請選擇圖片檔案");
  }
  const compressed = await imageCompression(file, ORDER_EXPLANATION_COMPRESSION_OPTIONS);
  const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
  const filename = `${crypto.randomUUID()}.${safeExt}`;
  const { data, error } = await supabase.storage
    .from(ORDER_EXPLANATION_BUCKET)
    .upload(filename, compressed, {
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(ORDER_EXPLANATION_BUCKET).getPublicUrl(data.path);
  return publicUrl;
}
