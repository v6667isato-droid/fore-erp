-- 使用回饋（暫時性功能）：夥伴回報使用 ERP 時遇到的問題，方便逐筆處理
CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL,
  status text NOT NULL DEFAULT '待處理',
  priority text,
  reporter text,
  internal_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE user_feedback IS '使用回饋／問題回報（暫時性功能）';
COMMENT ON COLUMN user_feedback.title IS '主旨';
COMMENT ON COLUMN user_feedback.description IS '問題描述';
COMMENT ON COLUMN user_feedback.category IS '類別（對應左側功能）';
COMMENT ON COLUMN user_feedback.status IS '狀態：待處理、處理中、已解決、暫緩';
COMMENT ON COLUMN user_feedback.priority IS '優先級：低、中、高';
COMMENT ON COLUMN user_feedback.reporter IS '回報人（email 或名稱）';
COMMENT ON COLUMN user_feedback.internal_notes IS '內部備註（處理方式等）';
