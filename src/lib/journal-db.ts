/**
 * 日誌（官網 Journal）資料庫設定：journal_posts 表
 * published = true 時官網 /api/journal 讀取；內文為區塊式 jsonb 陣列
 */

/** Supabase 表名 */
export const TABLE_JOURNAL_POSTS = "journal_posts";

/** journal_posts 查詢欄位 */
export const JOURNAL_POST_SELECT =
  "id, post_code, tag, title_zh, title_en, excerpt_zh, excerpt_en, post_date, content_zh, content_en, image_url, object_position, published, sort_order, notes, created_at, updated_at";

export type JournalTag = "customer" | "work" | "studio";

/** 內文區塊：官網依 type 對應排版元件渲染 */
export type JournalBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "quote"; text: string }
  | { type: "image"; url: string; caption?: string };

export interface JournalPostRow {
  id: string;
  post_code: string;
  tag: JournalTag;
  title_zh: string;
  title_en: string | null;
  excerpt_zh: string | null;
  excerpt_en: string | null;
  post_date: string;
  content_zh: JournalBlock[];
  content_en: JournalBlock[];
  image_url: string | null;
  object_position: string | null;
  published: boolean;
  sort_order: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** 把 jsonb 內容整理成合法的區塊陣列（忽略未知 type 或缺欄位的區塊） */
export function sanitizeJournalBlocks(value: unknown): JournalBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: JournalBlock[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (r.type === "image") {
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!url) continue;
      const caption = typeof r.caption === "string" && r.caption.trim() ? r.caption.trim() : undefined;
      blocks.push(caption ? { type: "image", url, caption } : { type: "image", url });
    } else if (r.type === "paragraph" || r.type === "heading" || r.type === "quote") {
      const text = typeof r.text === "string" ? r.text : "";
      blocks.push({ type: r.type, text });
    }
  }
  return blocks;
}

export function mapJournalPost(r: Record<string, unknown>): JournalPostRow {
  return {
    id: String(r.id),
    post_code: String(r.post_code ?? ""),
    tag: r.tag === "customer" || r.tag === "studio" ? r.tag : "work",
    title_zh: String(r.title_zh ?? ""),
    title_en: r.title_en != null ? String(r.title_en) : null,
    excerpt_zh: r.excerpt_zh != null ? String(r.excerpt_zh) : null,
    excerpt_en: r.excerpt_en != null ? String(r.excerpt_en) : null,
    post_date: String(r.post_date ?? ""),
    content_zh: sanitizeJournalBlocks(r.content_zh),
    content_en: sanitizeJournalBlocks(r.content_en),
    image_url: r.image_url != null ? String(r.image_url) : null,
    object_position: r.object_position != null ? String(r.object_position) : null,
    published: r.published === true,
    sort_order: r.sort_order != null ? Number(r.sort_order) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: r.created_at != null ? String(r.created_at) : null,
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export const JOURNAL_TAG_LABEL: Record<JournalTag, string> = {
  customer: "客戶故事",
  work: "作品記錄",
  studio: "工坊生活",
};

export const JOURNAL_TAG_OPTIONS: JournalTag[] = ["customer", "work", "studio"];
