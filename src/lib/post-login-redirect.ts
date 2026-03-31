import { supabase } from "@/lib/supabase";

/**
 * 讀取 user_profiles.role，小寫去空白；無資料時為空字串。
 * 先 user_id，再嘗試 id（與 dashboard-shell 一致）。
 */
export async function fetchNormalizedUserProfileRole(userId: string): Promise<string> {
  let { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    const second = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", userId)
      .single();
    profile = second.data;
  }

  return ((profile?.role as string) ?? "").trim().toLowerCase();
}

export function isAdminOrManagerRole(normalizedRole: string): boolean {
  const r = normalizedRole.trim().toLowerCase();
  return r === "admin" || r === "manager";
}

export function isAdminRole(normalizedRole: string): boolean {
  return normalizedRole.trim().toLowerCase() === "admin";
}

/**
 * 登入後導向：admin / manager → ERP 首頁，其餘（含 staff、空值）→ 員工儀表板。
 */
export async function getPathAfterLogin(userId: string): Promise<string> {
  const raw = await fetchNormalizedUserProfileRole(userId);
  if (isAdminOrManagerRole(raw)) {
    return "/";
  }
  return "/employee/dashboard";
}
