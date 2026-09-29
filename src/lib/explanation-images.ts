export type ExplanationImage = { url: string; title?: string | null };

/** 將 DB 的 explanation_image_url 解析為圖片資料（相容舊版 URL 字串/字串陣列，以及新版 {url,title} 陣列） */
export function parseExplanationImages(raw: string | null | undefined): ExplanationImage[] {
  if (raw == null || raw === "") return [];
  const normalizeUrl = (u: unknown): string | null => {
    if (typeof u !== "string") return null;
    const s = u.trim();
    return s ? s : null;
  };
  const normalizeTitle = (t: unknown): string | null => {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s ? s : null;
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed.every((x) => typeof x === "string")) {
        return (parsed as string[])
          .map((u) => normalizeUrl(u))
          .filter((u): u is string => Boolean(u))
          .map((url) => ({ url }));
      }
      return (parsed as { url?: unknown; title?: unknown }[])
        .map((x): ExplanationImage | null => {
          const url = normalizeUrl(x?.url);
          if (!url) return null;
          const title = normalizeTitle(x?.title);
          return { url, title };
        })
        .filter((x): x is ExplanationImage => x != null);
    }
    if (typeof parsed === "string") {
      const url = normalizeUrl(parsed);
      return url ? [{ url }] : [];
    }
    return [];
  } catch {
    const url = normalizeUrl(raw);
    return url ? [{ url }] : [];
  }
}

/** 訂單說明圖／通路製作圖共用的 Storage bucket（寫入 orders.explanation_image_url） */
export const ORDER_EXPLANATION_BUCKET = "order-explanations";

/** 單張訂單最多幾張說明圖（通路 API 以此擋異常請求） */
export const MAX_EXPLANATION_IMAGES = 20;

/** 將圖片清單序列化為 orders.explanation_image_url；空清單存 null */
export function serializeExplanationImages(images: ExplanationImage[]): string | null {
  if (images.length === 0) return null;
  return JSON.stringify(images.map((img) => ({ url: img.url, title: img.title ?? null })));
}
