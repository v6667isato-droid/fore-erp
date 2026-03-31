-- 與 Webhook / ERP 對齊：訊息本文用 content，類型用 message_type
-- 若曾執行舊版 migration（欄名為 text），改為 content
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'line_messages' AND column_name = 'text'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'line_messages' AND column_name = 'content'
  ) THEN
    ALTER TABLE line_messages RENAME COLUMN text TO content;
  END IF;
END $$;

ALTER TABLE line_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';

COMMENT ON COLUMN line_messages.content IS '訊息本文（LINE 文字訊息）';
COMMENT ON COLUMN line_messages.message_type IS '例如 text、image（Webhook 文字訊息寫入 text）';
