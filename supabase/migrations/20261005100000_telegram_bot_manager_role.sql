-- Telegram bot 新增「管理者」角色:admin=老闆(全功能)、manager=管理者、staff=員工。
-- manager 目前權限與 staff 相同(由 fore-telegram-bot 程式判斷,未知角色一律視為 staff),之後可個別調整。
-- 角色顯示名稱與權限說明表在 src/components/telegram-bot-users-page.tsx。

ALTER TABLE public.telegram_bot_users
  DROP CONSTRAINT IF EXISTS telegram_bot_users_role_check;
ALTER TABLE public.telegram_bot_users
  ADD CONSTRAINT telegram_bot_users_role_check CHECK (role IN ('admin', 'manager', 'staff'));

ALTER TABLE public.telegram_bot_invites
  DROP CONSTRAINT IF EXISTS telegram_bot_invites_role_check;
ALTER TABLE public.telegram_bot_invites
  ADD CONSTRAINT telegram_bot_invites_role_check CHECK (role IN ('admin', 'manager', 'staff'));
