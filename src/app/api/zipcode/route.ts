import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 15;

const TZIP33_URL = "https://33wsp.post.gov.tw/LZWZIP/TZIP33.asmx";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 台灣 3+3 郵遞區號查詢（需登入）。POST body：{ address }
 * 透過中華郵政公開 Web Service（TZIP33）查詢：
 * - 完整地址（含門牌號）回 6 碼；只到路名回 3 碼；查不到 zipcode 為 null
 * - 一併回傳中華郵政正規化後的地址（台→臺等）
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase 未設定" }, { status: 500 });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "未授權" }, { status: 401 });
  const {
    data: { user },
    error: userErr,
  } = await createClient(url, anonKey).auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: "登入已失效" }, { status: 401 });

  let body: { address?: unknown };
  try {
    body = (await request.json()) as { address?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address || address.length > 200) {
    return NextResponse.json({ error: "請提供地址" }, { status: 400 });
  }

  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetZipCode xmlns="http://tempuri.org/"><addrStr>${escapeXml(address)}</addrStr></GetZipCode></soap:Body></soap:Envelope>`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(TZIP33_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"http://tempuri.org/GetZipCode"',
      },
      body: envelope,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({ error: `郵遞區號查詢失敗（HTTP ${res.status}）` }, { status: 502 });
    }
    const xml = await res.text();
    const zipcode = /<GetZipCodeResult>(\d{3,6})<\/GetZipCodeResult>/.exec(xml)?.[1] ?? null;
    const normalized = /<address>([^<]*)<\/address>/.exec(xml)?.[1] ?? null;
    return NextResponse.json({ ok: true, zipcode, address: normalized });
  } catch {
    return NextResponse.json({ error: "郵遞區號查詢逾時，請稍後再試" }, { status: 502 });
  }
}
