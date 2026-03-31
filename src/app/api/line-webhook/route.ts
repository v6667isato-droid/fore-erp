import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateSignature } from "@line/bot-sdk";

export const runtime = "nodejs";

type LineMessageEvent = {
  type?: string;
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

async function resolveCustomerId(
  supabase: SupabaseClient,
  lineUserId: string
): Promise<string | null> {
  type IdRow = { id: string };

  const { data: byLineUserId, error: e1 } = await supabase
    .from("customers")
    .select("id")
    .eq("line_user_id", lineUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (e1) {
    console.error("[line-webhook] customers line_user_id lookup:", e1);
    return null;
  }
  const row1 = byLineUserId as IdRow | null;
  if (row1?.id) return row1.id;

  const { data: byLineId, error: e2 } = await supabase
    .from("customers")
    .select("id")
    .eq("line_id", lineUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (e2) {
    console.error("[line-webhook] customers line_id lookup:", e2);
    return null;
  }
  const row2 = byLineId as IdRow | null;
  return row2?.id ?? null;
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

    const events = Array.isArray(payload.events) ? payload.events : [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const text = typeof event.message.text === "string" ? event.message.text : "";
      const userId = typeof event.source?.userId === "string" ? event.source.userId : "";
      if (!userId || !text) continue;

      const customerId = await resolveCustomerId(supabase, userId);

      const { error: insertError } = await supabase.from("line_messages").insert({
        line_user_id: userId,
        text,
        customer_id: customerId,
      });

      if (insertError) {
        console.error("[line-webhook] insert line_messages:", insertError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[line-webhook] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
