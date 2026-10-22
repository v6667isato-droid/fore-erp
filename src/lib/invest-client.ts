import { createClient } from "@supabase/supabase-js";

/**
 * 個人投資用的第二個 Supabase client：連到擁有者自己的獨立專案（不是公司資料庫），
 * 用另一組帳號登入。設定步驟見 supabase-invest/README.md。
 */
const investUrl = (process.env.NEXT_PUBLIC_INVEST_SUPABASE_URL ?? "").trim();
const investAnonKey = (process.env.NEXT_PUBLIC_INVEST_SUPABASE_ANON_KEY ?? "").trim();

/** 只有這個 fore-erp 帳號（auth user id）的選單會出現「我的投資」 */
export const INVEST_OWNER_USER_ID = (process.env.NEXT_PUBLIC_INVEST_OWNER_USER_ID ?? "").trim();

export const isInvestConfigured =
  investUrl.length > 0 && investAnonKey.length > 0 && /^https?:\/\//i.test(investUrl);

export function isInvestOwner(userId: string | null | undefined): boolean {
  return isInvestConfigured && INVEST_OWNER_USER_ID.length > 0 && userId === INVEST_OWNER_USER_ID;
}

const resolvedUrl = isInvestConfigured ? investUrl : "https://placeholder.supabase.co";
const resolvedKey = isInvestConfigured
  ? investAnonKey
  : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

function storageKey(url: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    // 與 fore-erp 主 client 的 `fore-erp.<host>.auth` 分開，兩邊登入狀態互不影響
    return `fore-invest.${new URL(url).hostname}.auth`;
  } catch {
    return undefined;
  }
}

const key = storageKey(resolvedUrl);

/** 未設定時仍建立 client，避免 import 時崩潰；請先以 isInvestConfigured 判斷再發請求 */
export const investDb = createClient(resolvedUrl, resolvedKey, {
  auth: {
    ...(key ? { storageKey: key } : {}),
    // 只用帳密登入；不要去解析網址上的 token（那是 ERP 主 client 的登入回呼）
    detectSessionInUrl: false,
  },
});
