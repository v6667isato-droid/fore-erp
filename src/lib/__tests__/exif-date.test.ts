import { describe, expect, it } from "vitest";
import { readJpegExifDate } from "@/lib/exif-date";

interface Entry {
  tag: number;
  type: number;
  /** LONG 值，或 ASCII 字串（含結尾 \0） */
  value: number | string;
}

/** 組一個最小的 JPEG：SOI + APP1(EXIF) + SOS；IFD0 可帶 Exif IFD 指標 */
function buildJpeg(
  ifd0: Entry[],
  exif: Entry[] | null,
  little = true,
  { prefixApp0 = false }: { prefixApp0?: boolean } = {},
): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + ifdSize(ifd0);
  const dataOffset = exifOffset + (exif ? ifdSize(exif) : 0);

  const strings: number[] = [];
  const writeIfd = (entries: Entry[]) => {
    tiff.push(...u16(entries.length));
    for (const e of entries) {
      tiff.push(...u16(e.tag), ...u16(e.type));
      if (typeof e.value === "string") {
        tiff.push(...u32(e.value.length));
        tiff.push(...u32(dataOffset + strings.length));
        for (const ch of e.value) strings.push(ch.charCodeAt(0));
      } else {
        tiff.push(...u32(1), ...u32(e.tag === 0x8769 ? exifOffset : e.value));
      }
    }
    tiff.push(...u32(0));
  };

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0Offset));
  writeIfd(ifd0);
  if (exif) writeIfd(exif);
  tiff.push(...strings);

  const app1Data = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, (app1Data.length + 2) >> 8, (app1Data.length + 2) & 0xff, ...app1Data];
  const app0 = prefixApp0 ? [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00] : [];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, 0x00, 0x02]);
}

const ASCII = 2;
const LONG = 4;

describe("readJpegExifDate", () => {
  it("讀 Exif IFD 的 DateTimeOriginal（little endian）", () => {
    const jpeg = buildJpeg(
      [{ tag: 0x8769, type: LONG, value: 0 }],
      [{ tag: 0x9003, type: ASCII, value: "2026:09:30 14:22:05\0" }],
    );
    expect(readJpegExifDate(jpeg)).toBe("2026-09-30");
  });

  it("big endian、前面有 APP0 也讀得到", () => {
    const jpeg = buildJpeg(
      [{ tag: 0x8769, type: LONG, value: 0 }],
      [{ tag: 0x9003, type: ASCII, value: "2025:12:01 08:00:00\0" }],
      false,
      { prefixApp0: true },
    );
    expect(readJpegExifDate(jpeg)).toBe("2025-12-01");
  });

  it("沒有 DateTimeOriginal 時退回 IFD0 DateTime", () => {
    const jpeg = buildJpeg([{ tag: 0x0132, type: ASCII, value: "2024:02:29 23:59:59\0" }], null);
    expect(readJpegExifDate(jpeg)).toBe("2024-02-29");
  });

  it("日期為 0000:00:00（相機未設定）回 null", () => {
    const jpeg = buildJpeg(
      [{ tag: 0x8769, type: LONG, value: 0 }],
      [{ tag: 0x9003, type: ASCII, value: "0000:00:00 00:00:00\0" }],
    );
    expect(readJpegExifDate(jpeg)).toBeNull();
  });

  it("非 JPEG、沒有 EXIF、或資料截斷都回 null", () => {
    expect(readJpegExifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
    const full = buildJpeg(
      [{ tag: 0x8769, type: LONG, value: 0 }],
      [{ tag: 0x9003, type: ASCII, value: "2026:09:30 14:22:05\0" }],
    );
    expect(readJpegExifDate(full.slice(0, 30))).toBeNull();
  });
});
