-- 使用回饋：新增完成日期欄位
ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN user_feedback.completed_at IS '完成日期（問題解決時填寫）';
