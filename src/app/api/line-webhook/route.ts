import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateSignature } from "@line/bot-sdk";
import { getLineMessagingClient } from "@/lib/line-factory";
import { tryBindEmployeeByVerificationCode } from "@/lib/line-employee-bind";

export const runtime = "nodejs";

type LineMessageEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { type?: string; userId?: string };
};

type LineWebhookPayload = {
  events?: LineMessageEvent[];
};

function getServiceSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function supabaseKeyMode(): "service_role" | "anon_fallback" | "missing" {
  const sr = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (sr.length > 0) return "service_role";
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (anon.length > 0) return "anon_fallback";
  return "missing";
}

export async function POST(request: NextRequest) {
  try {
    const channelSecret = (process.env.LINE_CHANNEL_SECRET ?? "").trim();
    if (!channelSecret) {
      console.error("[line-webhook] LINE_CHANNEL_SECRET is missing (set it in Vercel → Environment Variables → Production)");
      return NextResponse.json({ error: "LINE_CHANNEL_SECRET not configured" }, { status: 500 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-line-signature") ?? "";

    let signatureOk = false;
    try {
      signatureOk = validateSignature(rawBody, channelSecret, signature);
    } catch (sigErr) {
      console.error("[line-webhook] validateSignature threw:", sigErr);
      return NextResponse.json({ error: "Signature validation failed" }, { status: 500 });
    }

    if (!signatureOk) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: LineWebhookPayload;
    try {
      payload = (rawBody.trim() === "" ? {} : JSON.parse(rawBody)) as LineWebhookPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    if (!supabase) {
      console.error(
        "[line-webhook] Supabase env missing: NEXT_PUBLIC_SUPABASE_URL and a key (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
      );
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const keyMode = supabaseKeyMode();
    try {
      const host = url ? new URL(url).hostname : "(no url)";
      console.log("[line-webhook] supabase host:", host, "| key:", keyMode);
    } catch {
      console.log("[line-webhook] key:", keyMode);
    }
    if (keyMode === "anon_fallback") {
      console.warn(
        "[line-webhook] Using anon key — 若員工 LINE 綁定更新失敗，請在部署環境設定 SUPABASE_SERVICE_ROLE_KEY（service_role）。"
      );
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const typeSummary = events.map((e) => e.type ?? "?").join(",");
    console.log("[line-webhook] events count:", events.length, typeSummary ? `types:[${typeSummary}]` : "");

    const lineClient = getLineMessagingClient();
    if (!lineClient) {
      console.warn(
        "[line-webhook] LINE_CHANNEL_ACCESS_TOKEN missing: 綁定驗證碼的自動回覆與 Rich Menu 將無法送出（資料庫綁定仍可能寫入）。"
      );
    }

    let textEvents = 0;
    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const text = typeof event.message.text === "string" ? event.message.text : "";
      const userId = typeof event.source?.userId === "string" ? event.source.userId : "";
      if (!userId || !text) continue;

      textEvents += 1;
      await tryBindEmployeeByVerificationCode(supabase, lineClient, {
        lineUserId: userId,
        text,
        replyToken: typeof event.replyToken === "string" ? event.replyToken : undefined,
      });
    }

    if (events.length > 0 && textEvents === 0) {
      console.log(
        "[line-webhook] No text messages to process (need type=message + message.type=text + source.userId; stickers/images are skipped)."
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[line-webhook] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
