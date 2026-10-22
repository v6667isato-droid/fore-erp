import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";

/** 請款單附件入庫前壓縮：圖片縮至長邊 2400px／約 1.2MB（手機照片常 3～10MB）；PDF 等原樣保留 */
export async function compressInvoiceFileForStorage(
  file: File,
): Promise<{ blob: Blob; ext: string }> {
  if (!file.type.startsWith("image/")) {
    return { blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "bin" };
  }
  const compressed = await imageCompression(file, {
    maxSizeMB: 1.2,
    maxWidthOrHeight: 2400,
    useWebWorker: true,
  });
  const subtype = compressed.type.split("/")[1] || "jpeg";
  return { blob: compressed, ext: subtype === "jpeg" ? "jpg" : subtype };
}

/** 會計發票（進項）附件 bucket */
export const ACCOUNTING_INVOICE_BUCKET = "accounting-invoices";
/** 採購請款單／發票掃描附件 bucket */
export const PURCHASE_INVOICE_BUCKET = "purchase-invoices";
export type InvoiceBucket = typeof ACCOUNTING_INVOICE_BUCKET | typeof PURCHASE_INVOICE_BUCKET;

/**
 * 發票檔案不公開（bucket 為 private）：顯示、開新分頁、下載都改用登入後產生的限時網址，
 * 不再使用資料表裡存的 file_url（舊的公開網址）。
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 12;

/** 批次產生限時網址；回傳 path → url（產生失敗的路徑不在結果內） */
export async function signInvoiceFileUrls(
  bucket: InvoiceBucket,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("發票附件網址產生失敗:", error?.message);
    return out;
  }
  for (const row of data) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** 下載發票檔案（重新辨識用） */
export async function downloadInvoiceFile(bucket: InvoiceBucket, path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.error("發票附件下載失敗:", error?.message);
    return null;
  }
  return data;
}
