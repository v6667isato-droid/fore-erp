import { createClient, type AuthError, type Session } from "@supabase/supabase-js";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/** 建置時寫入；若缺漏，所有 Supabase 請求都會失敗（瀏覽器常顯示 Failed to fetch） */
export const isSupabaseConfigured =
  supabaseUrl.length > 0 &&
  supabaseAnonKey.length > 0 &&
  /^https?:\/\//i.test(supabaseUrl);

export const SUPABASE_CONFIG_HELP =
  "Supabase 尚未正確設定：請在專案根目錄建立或編輯 .env.local，填入 NEXT_PUBLIC_SUPABASE_URL（需為 https 網址）與 NEXT_PUBLIC_SUPABASE_ANON_KEY，然後重新啟動 dev server（npm run dev）。";

if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && !isSupabaseConfigured) {
  console.warn(`[fore-erp] ${SUPABASE_CONFIG_HELP}`);
}

/** 未設定時仍建立 client，避免 import 時崩潰；請先以 isSupabaseConfigured 判斷再發請求 */
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co",
  isSupabaseConfigured ? supabaseAnonKey : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder"
);

export function isLikelySupabaseNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|network|fetch/i.test(msg);
}

/**
 * 未登入或本地尚無 session 時，auth.getUser() 等可能回傳此錯誤。
 * 請使用 {@link getSupabaseSession} 做初始檢查（會一併處理失效的 refresh token）。
 */
export function isAuthSessionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AuthSessionMissingError") return true;
  const m = typeof e.message === "string" ? e.message : "";
  return /auth session missing|session missing/i.test(m);
}

/** Refresh token 已撤銷、輪替或與目前專案不符時，GoTrue 會回此錯；應清除本地 session。 */
export function isInvalidRefreshTokenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; code?: string };
  const m = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (/invalid refresh token|refresh token not found/.test(m)) return true;
  const c = typeof e.code === "string" ? e.code.toLowerCase() : "";
  return c === "refresh_token_not_found";
}

/**
 * 等同 auth.getSession()，但若偵測到無效的 refresh token，會先 signOut({ scope: 'local' })
 * 再回傳無 session，避免主控台反覆出現 AuthApiError 並讓使用者卡在錯誤狀態。
 */
export async function getSupabaseSession(): Promise<{
  data: { session: Session | null };
  error: AuthError | null;
}> {
  const { data, error } = await supabase.auth.getSession();
  if (error && isInvalidRefreshTokenError(error)) {
    await supabase.auth.signOut({ scope: "local" });
    return { data: { session: null }, error: null };
  }
  return { data, error };
}
