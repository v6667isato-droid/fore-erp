import imageCompression from "browser-image-compression";

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
