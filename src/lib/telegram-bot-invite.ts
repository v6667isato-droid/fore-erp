/** app_settings：Telegram bot 帳號（username，不含 @），用來產生邀請碼的一鍵加入連結 */
export const TELEGRAM_BOT_USERNAME_KEY = "telegram_bot_username";

/**
 * 正規化 bot 帳號：接受「@fore_bot」「fore_bot」「https://t.me/fore_bot」等寫法，回傳不含 @ 的帳號。
 * 不符合 Telegram bot 帳號規則（5–32 字、英文字母開頭、僅英數與底線、以 bot 結尾）時回傳 null。
 */
export function normalizeBotUsername(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
  return /^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(s) ? s : null;
}

/** bot 對話連結 */
export function botChatLink(username: string): string {
  return `https://t.me/${username}`;
}

/** 一鍵加入連結：員工點開後按 START，Telegram 會自動送出「/start 邀請碼」完成註冊 */
export function botInviteLink(username: string, code: string): string {
  return `${botChatLink(username)}?start=${encodeURIComponent(code)}`;
}
