-- Telegram Bot 使用者白名單與邀請碼(取代 bot 的 TELEGRAM_ALLOWED_CHAT_IDS 環境變數)
-- bot 以 service role 讀寫;ERP 後台(員工管理 > Telegram Bot)以 authenticated 管理

CREATE TABLE IF NOT EXISTS telegram_bot_users (
  chat_id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE telegram_bot_users IS 'Telegram bot 可用帳號:admin 全功能;staff 不可用銷售/成本統計、請假審核與交辦';
COMMENT ON COLUMN telegram_bot_users.chat_id IS 'Telegram chat_id(私訊時等於 user id)';
COMMENT ON COLUMN telegram_bot_users.role IS 'admin=管理者(全功能);staff=員工(僅查詢類)';
COMMENT ON COLUMN telegram_bot_users.employee_id IS '對應 ERP 員工(選填,保留給日後「只看自己的工單」等功能)';
COMMENT ON COLUMN telegram_bot_users.is_active IS 'false=停用(離職/暫停),bot 立即拒絕';

CREATE OR REPLACE FUNCTION public.telegram_bot_users_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telegram_bot_users_set_updated_at ON public.telegram_bot_users;
CREATE TRIGGER telegram_bot_users_set_updated_at
  BEFORE UPDATE ON public.telegram_bot_users
  FOR EACH ROW
  EXECUTE PROCEDURE public.telegram_bot_users_set_updated_at();

CREATE TABLE IF NOT EXISTS telegram_bot_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at timestamptz,
  used_by_chat_id text
);

COMMENT ON TABLE telegram_bot_invites IS 'Telegram bot 邀請碼:員工對 bot 輸入 /start <code> 自動註冊,一次性';
COMMENT ON COLUMN telegram_bot_invites.name IS '預先指定顯示名稱(選填,空白則用員工的 Telegram 名字)';
COMMENT ON COLUMN telegram_bot_invites.expires_at IS '有效期限,預設 7 天';
COMMENT ON COLUMN telegram_bot_invites.used_at IS '已使用時間;非空即失效';

ALTER TABLE telegram_bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_bot_invites ENABLE ROW LEVEL SECURITY;

-- ERP 後台(登入使用者)可完整管理;頁面本身僅 admin 角色可見(dashboard-shell 既有慣例)
CREATE POLICY "telegram_bot_users_all_authenticated"
  ON telegram_bot_users FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "telegram_bot_invites_all_authenticated"
  ON telegram_bot_invites FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
