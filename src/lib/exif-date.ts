/**
 * 從 JPEG 的 EXIF 讀出拍攝日期（YYYY-MM-DD），上傳完工照片時預設帶入「完工日期」。
 * 只認 JPEG；經 LINE 傳過的照片通常已被去掉 EXIF，讀不到就回 null 由呼叫端用當天日期。
 * 依序找 DateTimeOriginal（0x9003）→ DateTimeDigitized（0x9004）→ IFD0 DateTime（0x0132）。
 */

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TAG_DATE_TIME = 0x0132;
const TYPE_ASCII = 2;

/** 只需讀檔頭：EXIF 位於 APP1，一般在前 64KB 內 */
export const EXIF_SCAN_BYTES = 128 * 1024;

export function readJpegExifDate(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    // SOS／EOI 之後就是影像資料，不會再有 EXIF
    if (marker === 0xda || marker === 0xd9) return null;
    const segmentLength = view.getUint16(pos + 2);
    if (segmentLength < 2) return null;
    const dataStart = pos + 4;
    if (marker === 0xe1 && isExifHeader(bytes, dataStart)) {
      return readTiffDate(view, dataStart + 6, Math.min(pos + 2 + segmentLength, bytes.length));
    }
    pos += 2 + segmentLength;
  }
  return null;
}

function isExifHeader(bytes: Uint8Array, at: number): boolean {
  // "Exif\0\0"
  return (
    at + 6 <= bytes.length &&
    bytes[at] === 0x45 &&
    bytes[at + 1] === 0x78 &&
    bytes[at + 2] === 0x69 &&
    bytes[at + 3] === 0x66 &&
    bytes[at + 4] === 0 &&
    bytes[at + 5] === 0
  );
}

function readTiffDate(view: DataView, tiff: number, end: number): string | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  let little: boolean;
  if (order === 0x4949) little = true;
  else if (order === 0x4d4d) little = false;
  else return null;
  if (view.getUint16(tiff + 2, little) !== 42) return null;

  const u16 = (at: number) => (at + 2 <= end ? view.getUint16(at, little) : null);
  const u32 = (at: number) => (at + 4 <= end ? view.getUint32(at, little) : null);

  /** 讀一個 IFD 的 tag → 實際位置（值在 entry 內或指向的偏移） */
  const readIfd = (offset: number): Map<number, { type: number; count: number; valueAt: number }> => {
    const tags = new Map<number, { type: number; count: number; valueAt: number }>();
    const start = tiff + offset;
    const n = u16(start);
    if (n == null) return tags;
    for (let i = 0; i < n; i++) {
      const entry = start + 2 + i * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      if (tag == null || type == null || count == null) break;
      // ASCII 超過 4 bytes 時存的是偏移，否則就在 entry 內
      const pointer = u32(entry + 8);
      if (pointer == null) break;
      const valueAt = type === TYPE_ASCII && count > 4 ? tiff + pointer : entry + 8;
      tags.set(tag, { type, count, valueAt });
    }
    return tags;
  };

  const readDate = (entry: { type: number; count: number; valueAt: number } | undefined) => {
    if (!entry || entry.type !== TYPE_ASCII || entry.count < 10) return null;
    if (entry.valueAt + 10 > end) return null;
    let s = "";
    for (let i = 0; i < 10; i++) s += String.fromCharCode(view.getUint8(entry.valueAt + i));
    const m = /^(\d{4}):(\d{2}):(\d{2})$/.exec(s);
    if (!m || m[1] === "0000") return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  };

  const ifd0Offset = u32(tiff + 4);
  if (ifd0Offset == null) return null;
  const ifd0 = readIfd(ifd0Offset);

  const exifPointer = ifd0.get(TAG_EXIF_IFD_POINTER);
  if (exifPointer) {
    const exifOffset = u32(exifPointer.valueAt);
    if (exifOffset != null) {
      const exif = readIfd(exifOffset);
      const date =
        readDate(exif.get(TAG_DATE_TIME_ORIGINAL)) ?? readDate(exif.get(TAG_DATE_TIME_DIGITIZED));
      if (date) return date;
    }
  }
  return readDate(ifd0.get(TAG_DATE_TIME));
}

/** 讀檔案開頭判斷 EXIF 拍攝日期；非 JPEG 或讀不到回 null */
export async function readExifDateFromFile(file: Blob): Promise<string | null> {
  if (file.type && file.type !== "image/jpeg") return null;
  try {
    const buf = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
    return readJpegExifDate(new Uint8Array(buf));
  } catch {
    return null;
  }
}
