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

function supabaseKeyMode(): "service_role" | "anon_fallback" | "missing" {
  const sr = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (sr.length > 0) return "service_role";
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (anon.length > 0) return "anon_fallback";
  return "missing";
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
        "[line-webhook] Using anon key for inserts — if line_messages stays empty, set SUPABASE_SERVICE_ROLE_KEY (service_role) in Vercel and redeploy."
      );
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const typeSummary = events.map((e) => e.type ?? "?").join(",");
    console.log("[line-webhook] events count:", events.length, typeSummary ? `types:[${typeSummary}]` : "");

    let textInserts = 0;
    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const text = typeof event.message.text === "string" ? event.message.text : "";
      const userId = typeof event.source?.userId === "string" ? event.source.userId : "";
      if (!userId || !text) continue;

      const customerId = await resolveCustomerId(supabase, userId);

      const { error: insertError } = await supabase.from("line_messages").insert({
        line_user_id: userId,
        content: text,
        message_type: "text",
        customer_id: customerId,
      });

      if (insertError) {
        console.error("[line-webhook] insert line_messages:", JSON.stringify(insertError));
        const code = String((insertError as { code?: string }).code ?? "");
        if (code === "PGRST204") {
          console.error(
            "[line-webhook] PGRST204 = table/column not in PostgREST schema cache (new table/column). In Supabase → SQL Editor run: NOTIFY pgrst, 'reload schema'; then resend a LINE text. See: https://supabase.com/docs/guides/troubleshooting/postgrest-not-recognizing-new-columns-or-functions-bd75f5"
          );
        }
        const msg = String(insertError.message ?? "");
        if (/permission denied|rls|new row violates row-level security/i.test(msg)) {
          console.error(
            "[line-webhook] Insert blocked: use SUPABASE_SERVICE_ROLE_KEY from Supabase → Settings → API (service_role secret), not the anon key."
          );
        }
        if (/relation|does not exist/i.test(msg)) {
          console.error(
            "[line-webhook] Table missing: run migration 20250401000000_line_messages_and_customers_line_user_id.sql in Supabase SQL Editor."
          );
        }
      } else {
        textInserts += 1;
        console.log("[line-webhook] inserted text message ok, count this batch:", textInserts);
      }
    }

    if (events.length > 0 && textInserts === 0) {
      console.log(
        "[line-webhook] No text message inserted (need type=message + message.type=text + source.userId; stickers/images are skipped)."
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[line-webhook] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
