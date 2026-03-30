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

/**
 * 與 SDK 預設的 `sb-<ref>-auth-token` 分開，避免舊的無效 refresh 在 GoTrue 初始化
 * `_recoverAndRefresh` 時先打 refresh API、觸發無法關閉的 `console.error(AuthApiError)`。
 * 首次上線此設定後使用者需重新登入一次（舊鍵不再讀取）。
 */
function browserAuthStorageKey(url: string): string | undefined {
  if (typeof window === "undefined" || !/^https?:\/\//i.test(url)) return undefined;
  try {
    return `fore-erp.${new URL(url).hostname}.auth`;
  } catch {
    return undefined;
  }
}

const resolvedSupabaseUrl = isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co";
const resolvedAnonKey = isSupabaseConfigured
  ? supabaseAnonKey
  : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

const authStorageKey = browserAuthStorageKey(resolvedSupabaseUrl);

/** Refresh token 已撤銷、輪替或與目前專案不符時，GoTrue 會回此錯；應清除本地 session。 */
export function isInvalidRefreshTokenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; code?: string; name?: string };
  const m = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (/invalid refresh token|refresh token not found|refresh token.*already used|already used/.test(m))
    return true;
  const c = typeof e.code === "string" ? e.code.toLowerCase() : "";
  if (c === "refresh_token_not_found") return true;
  return e.name === "AuthApiError" && /refresh token/i.test(m);
}

function consoleArgsIncludeInvalidRefresh(args: unknown[]): boolean {
  for (const a of args) {
    if (isInvalidRefreshTokenError(a)) return true;
  }
  return false;
}

const CONSOLE_PATCH_KEY = "__foreErpSupabaseAuthConsolePatch__";

/** 未設定時仍建立 client，避免 import 時崩潰；請先以 isSupabaseConfigured 判斷再發請求 */
export const supabase = createClient(resolvedSupabaseUrl, resolvedAnonKey, {
  auth: {
    ...(authStorageKey ? { storageKey: authStorageKey } : {}),
  },
});

/**
 * auth-js 在 _recoverAndRefresh／auto refresh 失敗時會先 console.error(AuthApiError)，無法關閉。
 * 在 createClient 之後立刻攔截，改為本機 signOut，避免主控台紅字與重複報錯。
 */
if (typeof window !== "undefined" && isSupabaseConfigured) {
  const g = globalThis as Record<string, unknown>;
  if (!g[CONSOLE_PATCH_KEY]) {
    g[CONSOLE_PATCH_KEY] = true;
    const orig = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      if (consoleArgsIncludeInvalidRefresh(args)) {
        void supabase.auth.signOut({ scope: "local" });
        return;
      }
      orig(...args);
    };
  }
}

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

if (typeof window !== "undefined" && isSupabaseConfigured) {
  void getSupabaseSession();
}
