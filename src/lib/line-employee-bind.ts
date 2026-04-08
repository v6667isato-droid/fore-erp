import type { Client } from "@line/bot-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

type EmployeeBindRow = {
  id: string;
  line_user_id: string | null;
  line_bind_code: string | null;
};

/**
 * 若訊息內容與某員工未使用之 line_bind_code 相符，則寫入 line_user_id、清空驗證碼、連結職人 Rich Menu，並（若有 replyToken）回覆文字。
 * 若不相符任何驗證碼則不做事。
 */
export async function tryBindEmployeeByVerificationCode(
  supabase: SupabaseClient,
  lineClient: Client | null,
  args: { lineUserId: string; text: string; replyToken?: string | null }
): Promise<void> {
  const code = args.text.trim();
  if (!code) return;

  const { data: raw, error } = await supabase
    .from("employees")
    .select("id, line_user_id, line_bind_code")
    .eq("line_bind_code", code)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[line-webhook] employee bind code lookup:", error);
    return;
  }

  const employee = raw as EmployeeBindRow | null;
  if (!employee?.id) return;

  const richMenuCraftsmanId = (process.env.LINE_RICH_MENU_CRAFTSMAN_ID ?? "").trim();

  const reply = async (t: string) => {
    if (!args.replyToken || !lineClient) return;
    try {
      await lineClient.replyMessage(args.replyToken, [{ type: "text", text: t }]);
    } catch (e) {
      console.error("[line-webhook] replyMessage:", e);
    }
  };

  if (employee.line_user_id === args.lineUserId) {
    await reply("您已成功綁定此 LINE 帳號，無需重複操作。");
    return;
  }

  if (employee.line_user_id && employee.line_user_id !== args.lineUserId) {
    await reply("此員工資料已綁定其他 LINE，請洽人資處理。");
    return;
  }

  const { data: conflictRaw } = await supabase
    .from("employees")
    .select("id")
    .eq("line_user_id", args.lineUserId)
    .is("deleted_at", null)
    .maybeSingle();

  const conflict = conflictRaw as { id: string } | null;
  if (conflict && conflict.id !== employee.id) {
    await reply("此 LINE 帳號已綁定其他員工，請洽人資。");
    return;
  }

  const { error: updErr } = await supabase
    .from("employees")
    .update({ line_user_id: args.lineUserId, line_bind_code: null })
    .eq("id", employee.id)
    .is("deleted_at", null);

  if (updErr) {
    console.error("[line-webhook] employee bind update:", updErr);
    await reply("綁定失敗，請稍後再試或洽人資。");
    return;
  }

  if (lineClient && richMenuCraftsmanId) {
    try {
      await lineClient.linkRichMenuToUser(args.lineUserId, richMenuCraftsmanId);
    } catch (e) {
      console.error("[line-webhook] linkRichMenuToUser:", e);
    }
  } else if (!richMenuCraftsmanId) {
    console.warn("[line-webhook] LINE_RICH_MENU_CRAFTSMAN_ID not set; skip Rich Menu link");
  }

  await reply("綁定成功，已為您切換為職人專用選單。");
}
