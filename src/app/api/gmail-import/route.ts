import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";

export const maxDuration = 60;

/**
 * 從 Gmail 撈取發票信件附件，存入 accounting-invoices bucket 並建立佇列紀錄（source=gmail）。
 * 需登入（Authorization: Bearer <supabase access token>）。
 * 環境變數：GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET、GMAIL_REFRESH_TOKEN；
 * 搜尋條件可用 GMAIL_INVOICE_QUERY 覆寫。
 */

const DEFAULT_QUERY = "has:attachment (發票 OR 電子發票 OR invoice) newer_than:60d";
/** 單次最多處理的信件數（避免超過 Vercel 60 秒上限） */
const MAX_MESSAGES = 20;
/** 圖片附件小於此大小視為信件簽名檔／logo，略過 */
const MIN_IMAGE_BYTES = 20 * 1024;

const EXT_MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface AttachmentRef {
  attachmentId: string;
  filename: string;
  mediaType: string;
  ext: string;
  size: number;
}

/** 由 MIME type 或副檔名判斷附件格式；不支援的格式回傳 null */
function resolveAttachment(part: GmailPart): Omit<AttachmentRef, "attachmentId" | "size"> | null {
  const filename = (part.filename ?? "").trim();
  if (!filename) return null;
  // Gmail 把無檔名的內嵌圖（信件內文圖片）命名為 noname，不是發票附件
  if (/^noname(\.\w+)?$/i.test(filename)) return null;
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const mime = (part.mimeType ?? "").toLowerCase();
  // 優先信 MIME type；octet-stream 等泛用型別退用副檔名
  if (mime === "application/pdf") return { filename, mediaType: mime, ext: "pdf" };
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
    return { filename, mediaType: mime, ext: mime.slice(6) === "jpeg" ? "jpg" : mime.slice(6) };
  }
  const byExt = EXT_MEDIA_TYPES[ext];
  if (byExt) return { filename, mediaType: byExt, ext: ext === "jpeg" ? "jpg" : ext };
  return null;
}

/** 遞迴走訪 MIME tree 收集可匯入的附件 */
function collectAttachments(part: GmailPart | undefined, out: AttachmentRef[]): void {
  if (!part) return;
  const resolved = resolveAttachment(part);
  const attachmentId = part.body?.attachmentId;
  if (resolved && attachmentId) {
    const size = part.body?.size ?? 0;
    // 小圖片幾乎都是簽名檔或 logo，不是發票
    if (!(resolved.mediaType.startsWith("image/") && size < MIN_IMAGE_BYTES)) {
      out.push({ ...resolved, attachmentId, size });
    }
  }
  for (const child of part.parts ?? []) collectAttachments(child, out);
}

/**
 * 同一封信同時附「發票證明聯」與「發票明細（示意圖）」時，只留正式的證明聯。
 * 台灣 tradevan 等開立通知常見此組合，明細只是示意圖不必入帳。
 */
function dropRedundantDetailSheets(attachments: AttachmentRef[]): AttachmentRef[] {
  const hasProof = attachments.some((a) => a.filename.includes("證明聯"));
  if (!hasProof) return attachments;
  return attachments.filter((a) => !a.filename.includes("明細"));
}

function headerValue(headers: { name?: string; value?: string }[] | undefined, name: string): string | null {
  const h = headers?.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Gmail 授權更新失敗（${detail}）。refresh token 可能已失效，請重新取得。`);
  }
  return json.access_token as string;
}

async function gmailGet(accessToken: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { error?: { message?: string } } | null)?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gmail API 讀取失敗（${detail}）`);
  }
  return json as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ success: false, error: "未授權" }, { status: 401 });
  const supabaseAnon = createClient(url, anonKey);
  const {
    data: { user },
    error: userErr,
  } = await supabaseAnon.auth.getUser(token);
  if (userErr || !user) {
    return NextResponse.json({ success: false, error: "登入已失效，請重新登入" }, { status: 401 });
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json(
      {
        success: false,
        not_configured: true,
        error:
          "尚未設定 Gmail 連線。請在環境變數加入 GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET、GMAIL_REFRESH_TOKEN（詳見 .env.example）。",
      },
      { status: 501 },
    );
  }

  const body = await request.json().catch(() => null);
  const query =
    (typeof body?.query === "string" && body.query.trim()) ||
    process.env.GMAIL_INVOICE_QUERY ||
    DEFAULT_QUERY;

  const admin = createClient(url, serviceKey ?? anonKey);

  try {
    const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);

    const list = await gmailGet(
      accessToken,
      `messages?q=${encodeURIComponent(query)}&maxResults=${MAX_MESSAGES}`,
    );
    const messageIds: string[] = ((list.messages as { id: string }[] | undefined) ?? []).map((m) => m.id);
    if (messageIds.length === 0) {
      return NextResponse.json({ success: true, imported: 0, skipped: 0, no_attachment: 0, ids: [], query });
    }

    // 防重複匯入：含已刪除紀錄，刪過的信不再重抓
    const { data: existing, error: existErr } = await admin
      .from("accounting_invoices")
      .select("gmail_message_id")
      .in("gmail_message_id", messageIds);
    if (existErr) throw new Error(`資料庫查詢失敗：${existErr.message}`);
    const imported = new Set((existing ?? []).map((r) => r.gmail_message_id as string));

    const insertedIds: string[] = [];
    let skipped = 0;
    let noAttachment = 0;
    let duplicates = 0;
    /** 本次執行內已收的附件內容雜湊（同批信件互相去重） */
    const seenHashes = new Set<string>();

    for (const mid of messageIds) {
      if (imported.has(mid)) {
        skipped += 1;
        continue;
      }
      const message = await gmailGet(accessToken, `messages/${mid}?format=full`);
      const payload = message.payload as GmailPart | undefined;
      const headers = (message.payload as { headers?: { name?: string; value?: string }[] } | undefined)?.headers;
      const subject = headerValue(headers, "Subject");
      const from = headerValue(headers, "From");

      const collected: AttachmentRef[] = [];
      collectAttachments(payload, collected);
      const attachments = dropRedundantDetailSheets(collected);
      if (attachments.length === 0) {
        noAttachment += 1;
        continue;
      }

      for (const att of attachments) {
        const attData = await gmailGet(accessToken, `messages/${mid}/attachments/${att.attachmentId}`);
        const data = attData.data as string | undefined;
        if (!data) continue;
        const bytes = Buffer.from(data, "base64url");

        // 內容雜湊去重：轉寄信的附件位元組相同，本批與資料庫（含已刪除）都比對
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (seenHashes.has(hash)) {
          duplicates += 1;
          continue;
        }
        const { data: dupRows, error: dupErr } = await admin
          .from("accounting_invoices")
          .select("id")
          .eq("file_hash", hash)
          .limit(1);
        if (dupErr) throw new Error(`資料庫查詢失敗：${dupErr.message}`);
        if ((dupRows ?? []).length > 0) {
          seenHashes.add(hash);
          duplicates += 1;
          continue;
        }
        seenHashes.add(hash);

        const path = `inbox/${randomUUID()}.${att.ext}`;
        const { data: up, error: upErr } = await admin.storage
          .from("accounting-invoices")
          .upload(path, bytes, { cacheControl: "3600", contentType: att.mediaType, upsert: false });
        if (upErr) throw new Error(`附件上傳失敗：${upErr.message}`);
        const {
          data: { publicUrl },
        } = admin.storage.from("accounting-invoices").getPublicUrl(up.path);

        const { data: row, error: insErr } = await admin
          .from("accounting_invoices")
          .insert({
            file_path: up.path,
            file_url: publicUrl,
            file_name: att.filename,
            media_type: att.mediaType,
            status: "pending",
            source: "gmail",
            file_hash: hash,
            gmail_message_id: mid,
            gmail_subject: subject,
            gmail_from: from,
          })
          .select("id")
          .single();
        if (insErr || !row) throw new Error(`佇列紀錄建立失敗：${insErr?.message ?? "unknown"}`);
        insertedIds.push((row as { id: string }).id);
      }
    }

    return NextResponse.json({
      success: true,
      imported: insertedIds.length,
      skipped,
      duplicates,
      no_attachment: noAttachment,
      ids: insertedIds,
      query,
    });
  } catch (err) {
    console.error("gmail-import error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Gmail 匯入失敗，請稍後再試" },
      { status: 502 },
    );
  }
}
