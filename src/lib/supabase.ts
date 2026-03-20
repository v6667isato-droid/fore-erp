import { createClient } from "@supabase/supabase-js";

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
 * 初始檢查請優先使用 auth.getSession()，僅讀本地 storage、不會觸發此類錯誤。
 */
export function isAuthSessionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AuthSessionMissingError") return true;
  const m = typeof e.message === "string" ? e.message : "";
  return /auth session missing|session missing/i.test(m);
}
