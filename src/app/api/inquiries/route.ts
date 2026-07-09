import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 官網（fore-furniture.com）會從瀏覽器端直接 POST 過來，需放行跨網域請求
const ALLOWED_ORIGIN = process.env.WEBSITE_ORIGIN ?? "https://fore-furniture.com";

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const contact = typeof body?.contact === "string" ? body.contact.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : null;
  const message = typeof body?.message === "string" ? body.message.trim() : null;

  if (!name || !contact) {
    return withCors(
      NextResponse.json({ success: false, error: "請填寫姓名與聯絡方式" }, { status: 400 })
    );
  }

  const { error } = await supabase.from("inquiries").insert({
    name,
    contact,
    type,
    message,
    status: "new",
  });

  if (error) {
    console.error("POST /api/inquiries error:", error);
    return withCors(
      NextResponse.json({ success: false, error: "送出失敗，請稍後再試" }, { status: 500 })
    );
  }

  return withCors(NextResponse.json({ success: true }));
}
