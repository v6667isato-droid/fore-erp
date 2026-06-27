import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseSession, isAuthSessionMissingError } from "@/lib/supabase";

/**
 * 這些頁面（通路訂單查詢、各類列印頁）原本沒有登入檢查，靠網址中的 ID 當作唯一防線，
 * 且資料庫的對應表已改為僅 authenticated 可讀。未登入時導去 /login，避免畫面卡在無資料的空白頁。
 */
export function useRequireAuth(): { ready: boolean } {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data: { session }, error } = await getSupabaseSession();
      if (cancelled) return;
      if ((error && !isAuthSessionMissingError(error)) || !session?.user) {
        router.replace("/login");
        return;
      }
      setReady(true);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { ready };
}
