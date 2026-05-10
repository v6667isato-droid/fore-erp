import { createHmac, timingSafeEqual } from "crypto";

/**
 * 通路入口非 Supabase Auth：用簽章 token 讓 API 以 service role 代查 work_orders 等受 RLS 限制之資料。
 * 生產環境請設定 PORTAL_TOKEN_SECRET（長隨機字串）；未設定時會退回 SERVICE ROLE（僅建議本機）。
 */
function getPortalTokenSecret(): string {
  const a = process.env.PORTAL_TOKEN_SECRET?.trim();
  if (a) return a;
  const b = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (b) return b;
  return "fore-erp-portal-dev-token-unsafe";
}

export function signPortalSession(customerId: string, channelId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const payload = Buffer.from(
    JSON.stringify({ sub: customerId, ch: channelId, exp }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", getPortalTokenSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPortalSession(
  token: string | undefined | null
): { customer_id: string; channel_id: string } | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const dot = token.indexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", getPortalTokenSecret()).update(payload).digest("base64url");
  try {
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      ch?: string;
      exp?: number;
    };
    if (!json.sub || !json.ch || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return { customer_id: json.sub, channel_id: json.ch };
  } catch {
    return null;
  }
}
