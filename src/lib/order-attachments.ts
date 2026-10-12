import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";

/** 訂單履歷附件的 private bucket：照片可能拍到客戶住家，不給公開網址，顯示時才簽短效網址 */
export const ORDER_RECORDS_BUCKET = "order-records";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** 原圖：完工紀錄要看得清楚木紋與細節，比品項縮圖寬鬆 */
const PHOTO_COMPRESSION = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 2400,
  initialQuality: 0.9,
  useWebWorker: true,
} as const;

/** 縮圖：列表、時間軸用 */
const THUMB_COMPRESSION = {
  maxSizeMB: 0.08,
  maxWidthOrHeight: 480,
  useWebWorker: true,
} as const;

const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp"];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface OrderAttachment {
  id: string;
  order_id: string;
  order_item_id: string | null;
  category: string;
  storage_path: string;
  thumb_path: string | null;
  file_name: string | null;
  caption: string | null;
  /** 拍攝／完工日期 YYYY-MM-DD */
  taken_on: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const ATTACHMENT_SELECT =
  "id, order_id, order_item_id, category, storage_path, thumb_path, file_name, caption, taken_on, uploaded_by, created_at";

export async function fetchOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
  const { data, error } = await supabase
    .from("order_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("taken_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderAttachment[];
}

/** 各訂單的完工照片張數（訂單列表的履歷按鈕標色用） */
export async function fetchOrderPhotoCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const pageSize = 1000;
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("order_attachments")
      .select("order_id")
      .is("deleted_at", null)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error("完工照片統計讀取失敗:", error.message);
      return counts;
    }
    const rows = (data ?? []) as { order_id: string }[];
    for (const r of rows) counts[r.order_id] = (counts[r.order_id] ?? 0) + 1;
    if (rows.length < pageSize) return counts;
  }
}

/** Windows 上 HEIC 的 file.type 常是空字串，改看副檔名 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
}

function extensionOf(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/jpeg") return "jpg";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ALLOWED_EXT.includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "jpg";
}

/**
 * 壓縮（原圖＋縮圖）後上傳並建立附件紀錄；任何一步失敗都清掉已上傳的檔案。
 * @param takenOn 拍攝／完工日期 YYYY-MM-DD
 */
export async function uploadCompletionPhoto({
  orderId,
  orderItemId,
  file,
  takenOn,
}: {
  orderId: string;
  orderItemId: string | null;
  file: File;
  takenOn: string | null;
}): Promise<OrderAttachment> {
  if (!isImageFile(file)) {
    throw new Error(`${file.name} 不是圖片檔`);
  }
  // HEIC 等格式（Safari 解得開）一律轉成 JPEG，bucket 只收 JPEG／PNG／WebP
  const fileType = ALLOWED_TYPES.includes(file.type) ? undefined : "image/jpeg";
  let photo: File;
  let thumb: File;
  try {
    photo = await imageCompression(file, { ...PHOTO_COMPRESSION, fileType });
    thumb = await imageCompression(file, { ...THUMB_COMPRESSION, fileType });
  } catch {
    // 多半是 iPhone 的 HEIC：Chrome／Edge 無法解碼
    throw new Error(`${file.name} 無法讀取，請先轉成 JPG 再上傳`);
  }

  const id = crypto.randomUUID();
  const ext = extensionOf(photo);
  const folder = `${orderId}/${orderItemId ?? "order"}`;
  const storagePath = `${folder}/${id}.${ext}`;
  const thumbPath = `${folder}/${id}_thumb.${extensionOf(thumb)}`;
  const bucket = supabase.storage.from(ORDER_RECORDS_BUCKET);
  const uploaded: string[] = [];

  try {
    for (const [path, blob] of [
      [storagePath, photo],
      [thumbPath, thumb],
    ] as const) {
      const { error } = await bucket.upload(path, blob, {
        cacheControl: "31536000",
        contentType: blob.type || undefined,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      uploaded.push(path);
    }
    const { data, error } = await supabase
      .from("order_attachments")
      .insert({
        id,
        order_id: orderId,
        order_item_id: orderItemId,
        category: "completion",
        storage_path: storagePath,
        thumb_path: thumbPath,
        file_name: file.name,
        taken_on: takenOn,
      })
      .select(ATTACHMENT_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return data as OrderAttachment;
  } catch (e) {
    if (uploaded.length > 0) await bucket.remove(uploaded);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** 軟刪除：檔案保留在 bucket，需要時可還原 */
export async function softDeleteOrderAttachment(id: string): Promise<void> {
  const { error } = await supabase
    .from("order_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 批次簽短效網址：storage path → URL（簽不到的不在結果內） */
export async function signOrderRecordUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(ORDER_RECORDS_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  }
  return map;
}
